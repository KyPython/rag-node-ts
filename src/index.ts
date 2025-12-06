import express, { type Request, type Response, type NextFunction } from 'express';
import dotenv from 'dotenv';
import { retrieveRelevantPassages, type RetrievedPassage } from './rag/retriever.js';
import { generateAnswer, type Context } from './llm/answer.js';
import { logger } from './utils/logger.js';
import { loadConfig } from './utils/config.js';

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

// Middleware
app.use(express.json());

// Request logger middleware using structured logger
const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ...(req.method === 'POST' && { bodySize: JSON.stringify(req.body).length }),
  });
  
  // Log response status after response is sent
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  
  next();
};

app.use(requestLogger);

// Root endpoint - API information
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'RAG Node.js TypeScript Service',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      query: 'POST /query',
    },
    documentation: 'https://github.com/KyPython/rag-node-ts',
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Query endpoint for RAG retrieval and answer generation
interface QueryRequest {
  query: string;
  topK?: number;
}

// Query parameter: mode can be 'retrieval' or 'answer' (default: 'answer')
interface QueryParams {
  mode?: 'retrieval' | 'answer';
}

// Response for retrieval-only mode
interface RetrievalResponse {
  query: string;
  results: RetrievedPassage[];
}

// Response for full RAG answer mode
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

/**
 * /query endpoint with dual modes:
 * 
 * 1. Retrieval-only mode (?mode=retrieval):
 *    - Returns only retrieved passages without LLM answer generation
 *    - Useful for debugging, testing retrieval quality, or building custom answer pipelines
 * 
 * 2. Full RAG answer mode (default, ?mode=answer or no mode param):
 *    - Retrieves passages, generates LLM answer, and extracts citations
 *    - Returns structured response with answer text and cited passages
 * 
 * Frontend Highlighting Guide:
 * 
 * To visually highlight cited passages in the answer:
 * 
 * 1. Parse the answer text for citation markers [p0], [p1], etc.
 * 2. Replace markers with clickable links or styled spans:
 *    - Example: "[p0]" → "<span class='citation' data-index='0'>[0]</span>"
 *    - Or: "[p0]" → "<a href='#passage-0' class='citation-link'>[0]</a>"
 * 
 * 3. Display cited passages in a separate section:
 *    - Map citation indices to the citations array
 *    - Show passage text, relevance score, and source metadata
 *    - Allow users to click citations to jump to source passages
 * 
 * 4. Optional: Highlight matching query terms in both answer and passages
 *    - Use text highlighting libraries or simple regex replacements
 * 
 * Example frontend rendering:
 * ```
 * <div class="answer">{answerWithHighlightedCitations}</div>
 * <div class="sources">
 *   <h3>Cited Sources ({citations.length})</h3>
 *   {citations.map(citation => (
 *     <div class="passage" id={`passage-${citation.index}`}>
 *       <span class="score">Score: {citation.score}</span>
 *       <p>{citation.text}</p>
 *       <span class="source">{citation.metadata.source}</span>
 *     </div>
 *   ))}
 * </div>
 * ```
 */
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

    // Validate request body
    if (!body.query || typeof body.query !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Request body must contain a "query" field of type string',
      });
      return;
    }

    // Validate topK if provided
    const topK = body.topK ?? 5;
    if (typeof topK !== 'number' || topK < 1 || topK > 100) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'topK must be a number between 1 and 100',
      });
      return;
    }

    logger.info('Processing query request', {
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
      query: body.query,
      passagesCount: retrievedPassages.length,
      retrievalDurationMs: retrievalDuration,
    });

    // Step 2: If retrieval-only mode, return early
    if (mode === 'retrieval') {
      const response: RetrievalResponse = {
        query: body.query,
        results: retrievedPassages,
      };

      const totalDuration = Date.now() - requestStartTime;
      logger.info('Query completed (retrieval-only mode)', {
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

    const response: AnswerResponse = {
      query: body.query,
      answer: answerResult.answer,
      citations,
    };

    const totalDuration = Date.now() - requestStartTime;
    logger.info('Query completed (full RAG mode)', {
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
    const totalDuration = Date.now() - requestStartTime;
    logger.error('Query processing failed', {
      query: req.body?.query,
      error: error instanceof Error ? error.message : String(error),
      totalDurationMs: totalDuration,
    });

    // Pass error to error handling middleware
    next(error);
  }
});

// Error handling middleware
interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
}

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Request error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const errorResponse: ErrorResponse = {
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
  };

  res.status(500).json(errorResponse);
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Start server
app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    healthEndpoint: `http://localhost:${PORT}/health`,
    queryEndpoint: `http://localhost:${PORT}/query`,
  });
});

