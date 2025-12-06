/**
 * Production RAG HTTP API Server
 * 
 * A production-ready Express server with:
 * - Request ID tracking for all requests
 * - Structured error handling
 * - Prometheus metrics
 * - Comprehensive HTTP logging
 * - RAG query endpoints
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import dotenv from 'dotenv';
import morgan from 'morgan';
import { retrieveRelevantPassages, type RetrievedPassage } from './rag/retriever.js';
import { generateAnswer, type Context } from './llm/answer.js';
import { logger } from './utils/logger.js';
import { loadConfig } from './utils/config.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler, AppError, validationError } from './middleware/errorHandler.js';
import { metricsMiddleware, metricsHandler } from './metrics/metrics.js';

// Load environment variables
dotenv.config();

// Validate configuration on startup
try {
  loadConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE (ORDER MATTERS)
// ============================================================================

// 1. Request ID middleware - must be first to attach requestId to all requests
app.use(requestIdMiddleware);

// 2. Metrics middleware - record metrics for all requests
app.use(metricsMiddleware);

// 3. Body parsing
app.use(express.json());

// 4. HTTP request logging with morgan
// Include requestId in logs using custom token
morgan.token('request-id', (req: Request) => req.requestId);
morgan.token('request-body-size', (req: Request) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    return JSON.stringify(req.body).length.toString();
  }
  return '-';
});

const morganFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" [request-id: :request-id] :response-time ms';
app.use(morgan(morganFormat, {
  stream: {
    write: (message: string) => {
      // Morgan writes to stdout, but we can integrate with our logger if needed
      process.stdout.write(message);
    },
  },
}));

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Root endpoint - API information
 * Fast, no external dependencies
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    requestId: req.requestId,
    service: 'RAG Node.js TypeScript Service',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      query: 'POST /query',
      metrics: 'GET /metrics',
    },
    documentation: 'https://github.com/KyPython/rag-node-ts',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Health check endpoint
 * Fast, no external dependencies - used for load balancer health checks
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    requestId: req.requestId,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Metrics endpoint - Prometheus format
 * Fast, no external dependencies - exposes Prometheus metrics
 */
app.get('/metrics', metricsHandler);

/**
 * Query endpoint for RAG retrieval and answer generation
 * 
 * Supports two modes:
 * - Retrieval-only: ?mode=retrieval
 * - Full RAG answer: default
 */
interface QueryRequest {
  query: string;
  topK?: number;
}

interface QueryParams {
  mode?: 'retrieval' | 'answer';
}

interface RetrievalResponse {
  query: string;
  results: RetrievedPassage[];
}

interface AnswerResponse {
  query: string;
  answer: string;
  citations: {
    index: number;
    text: string;
    score: number;
    metadata: Record<string, unknown>;
  }[];
}

app.post('/query', async (req: Request, res: Response, next: NextFunction) => {
  const requestStartTime = Date.now();
  let retrievalStartTime: number;
  let retrievalDuration: number;
  let answerStartTime: number;
  let answerDuration: number;

  try {
    const body = req.body as QueryRequest;
    const queryParams = req.query as QueryParams;
    const mode = queryParams.mode || 'answer';

    // Validate request body using AppError
    if (!body.query || typeof body.query !== 'string') {
      throw validationError(
        'Request body must contain a "query" field of type string',
        { body: req.body }
      );
    }

    // Validate topK if provided
    const topK = body.topK ?? 5;
    if (typeof topK !== 'number' || topK < 1 || topK > 100) {
      throw validationError(
        'topK must be a number between 1 and 100',
        { topK }
      );
    }

    logger.info('Processing query request', {
      requestId: req.requestId,
      query: body.query,
      queryLength: body.query.length,
      mode,
      topK,
    });

    // Step 1: Retrieve relevant passages
    retrievalStartTime = Date.now();
    const retrievedPassages = await retrieveRelevantPassages(body.query, topK);
    retrievalDuration = Date.now() - retrievalStartTime;

    logger.info('Retrieval completed', {
      requestId: req.requestId,
      query: body.query,
      passagesCount: retrievedPassages.length,
      retrievalDurationMs: retrievalDuration,
    });

    // Step 2: If retrieval-only mode, return early
    if (mode === 'retrieval') {
      const response = {
        requestId: req.requestId,
        data: {
          query: body.query,
          results: retrievedPassages,
        } as RetrievalResponse,
      };

      const totalDuration = Date.now() - requestStartTime;
      logger.info('Query completed (retrieval-only mode)', {
        requestId: req.requestId,
        query: body.query,
        passagesCount: retrievedPassages.length,
        totalDurationMs: totalDuration,
      });

      res.json(response);
      return;
    }

    // Step 3: Generate LLM answer with citations (full RAG mode)
    answerStartTime = Date.now();
    
    // Convert RetrievedPassage[] to Context[] format
    const contexts: Context[] = retrievedPassages.map((passage) => ({
      text: passage.text,
      score: passage.score,
      metadata: passage.metadata,
    }));

    const answerResult = await generateAnswer(body.query, contexts);
    answerDuration = Date.now() - answerStartTime;

    // Step 4: Build citations array from answer result
    const citations = answerResult.citations.map((index) => ({
      index,
      text: retrievedPassages[index]?.text || '',
      score: retrievedPassages[index]?.score || 0,
      metadata: retrievedPassages[index]?.metadata || {},
    }));

    const response = {
      requestId: req.requestId,
      data: {
        query: body.query,
        answer: answerResult.answer,
        citations,
      } as AnswerResponse,
    };

    const totalDuration = Date.now() - requestStartTime;
    logger.info('Query completed (full RAG mode)', {
      requestId: req.requestId,
      query: body.query,
      passagesRetrieved: retrievedPassages.length,
      citationsCount: citations.length,
      answerLength: answerResult.answer.length,
      retrievalDurationMs: retrievalDuration,
      answerGenerationDurationMs: answerDuration,
      totalDurationMs: totalDuration,
    });

    res.json(response);
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
});

// ============================================================================
// ERROR HANDLING (MUST BE LAST)
// ============================================================================

// 404 handler - catches unmatched routes
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(
    `Route ${req.method} ${req.path} not found`,
    404,
    'NOT_FOUND'
  ));
});

// Centralized error handler - must be last
app.use(errorHandler);

// ============================================================================
// SERVER STARTUP
// ============================================================================

app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      root: `http://localhost:${PORT}/`,
      health: `http://localhost:${PORT}/health`,
      query: `http://localhost:${PORT}/query`,
      metrics: `http://localhost:${PORT}/metrics`,
    },
  });
});
