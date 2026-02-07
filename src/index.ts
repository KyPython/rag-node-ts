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
import multer from 'multer';
import { retrieveRelevantPassages, type RetrievedPassage } from './rag/retriever.js';
import { ingestText, ingestDocuments } from './rag/ingest.js';
import { generateAnswer, type Context } from './llm/answer.js';
import { renderRagPrompts } from './utils/promptLoader.js';
import { recordRetrievalTrace, recordLLMTrace } from './llm/langsmith.js';
import { logger } from './utils/logger.js';
import { loadConfig } from './utils/config.js';
import { countTokens } from './utils/tokenCounter.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { moderationMiddleware } from './middleware/moderation.js';
import { apiKeyAuth, getTenantNamespace } from './middleware/apiKeyAuth.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, AppError, validationError } from './middleware/errorHandler.js';
import { metricsMiddleware, metricsHandler } from './metrics/metrics.js';
import { getCache, generateCacheKey, semanticGet, semanticSet } from './cache/cache.js';
import { truncateContexts } from './utils/truncation.js';
import { trackUsage } from './services/usageTracker.js';
import { adminRouter } from './routes/admin.js';

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

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

// Security: Disable X-Powered-By header to prevent information leakage
app.disable('x-powered-by');

// Initialize cache
const cache = getCache();
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || '300', 10); // Default 5 minutes
const MAX_CONTEXT_LENGTH = parseInt(process.env.MAX_CONTEXT_LENGTH || '8000', 10); // Default 8K chars

// ============================================================================
// MIDDLEWARE (ORDER MATTERS)
// ============================================================================

// 0. Serve static files (demo UI) - before other middleware
app.use(express.static('public'));

// 1. Request ID middleware - must be first to attach requestId to all requests
app.use(requestIdMiddleware);

// 1.5 Moderation gateway - block non-legal intent and adversarial queries early
app.use(moderationMiddleware);

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

// Admin routes (protected by admin key)
app.use('/admin', adminRouter);

/**
 * Root endpoint - API information
 * Fast, no external dependencies
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    requestId: req.requestId,
    service: 'RAG-as-a-Service',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      query: 'POST /query',
      ingest: 'POST /ingest/text',
      ingestBatch: 'POST /ingest/batch',
      metrics: 'GET /metrics',
      admin: 'GET /admin/* (requires admin key)',
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

// Apply API key auth and rate limiting to query endpoint
app.post('/query', apiKeyAuth({ required: false }), rateLimiter(), async (req: Request, res: Response, next: NextFunction) => {
  const requestStartTime = Date.now();
  const log = (req as any).log || logger;
  let retrievalStartTime: number;
  let retrievalDuration: number;
  let answerStartTime: number;
  let answerDuration: number;
  let cacheHit = false;

  try {
    const body = req.body as QueryRequest;
    const queryParams = req.query as QueryParams;
    const mode = queryParams.mode || 'answer';
    const cacheEnabled = req.query.cacheMode !== 'off';

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

    // Semantic cache lookup (vector-based) when enabled
    if (cacheEnabled) {
      const semanticCached = await semanticGet(body.query, 0.95, log).catch((err) => null);
      if (semanticCached) {
        cacheHit = true;
        const totalDuration = Date.now() - requestStartTime;
        log.info('Query served from semantic cache', {
          requestId: req.requestId,
          query: body.query,
          mode,
          durationMs: totalDuration,
        });

        res.json({
          requestId: req.requestId,
          data: JSON.parse(semanticCached),
          _semantic_cached: true,
        });
        return;
      }

      // Fallback to regular cache (redis/in-memory)
      const cacheKey = generateCacheKey(body.query, topK, mode);
      const cachedResponse = await cache.get(cacheKey, log);

      if (cachedResponse) {
        cacheHit = true;
        const totalDuration = Date.now() - requestStartTime;
        
        log.info('Query served from cache', {
          requestId: req.requestId,
          query: body.query,
          mode,
          cacheKey,
          durationMs: totalDuration,
        });

        res.json({
          requestId: req.requestId,
          data: JSON.parse(cachedResponse),
          _cached: true, // Indicator for testing/debugging
        });
        return;
      }
    }

    log.info('Processing query request (cache miss)', {
      requestId: req.requestId,
      query: body.query,
      queryLength: body.query.length,
      mode,
      topK,
      cacheEnabled,
    });

    log.info('Processing query request', {
      requestId: req.requestId,
      query: body.query,
      queryLength: body.query.length,
      mode,
      topK,
    });

    // Step 1: Retrieve relevant passages (with tenant namespace for multi-tenancy)
    const namespace = getTenantNamespace(req);
    retrievalStartTime = Date.now();
    const retrievedPassages = await retrieveRelevantPassages(body.query, topK, namespace, req.requestId, log);
    retrievalDuration = Date.now() - retrievalStartTime;

    log.info('Retrieval completed', {
      requestId: req.requestId,
      query: body.query,
      passagesCount: retrievedPassages.length,
      retrievalDurationMs: retrievalDuration,
    });

    // Observability: lightweight LangSmith trace for retrieval
    try {
      recordRetrievalTrace(req.requestId, body.query, retrievedPassages.length, 0 /* cost placeholder */);
    } catch (err) {
      log.warn('Failed to record retrieval trace', { requestId: req.requestId });
    }

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
      log.info('Query completed (retrieval-only mode)', {
        requestId: req.requestId,
        query: body.query,
        passagesCount: retrievedPassages.length,
        totalDurationMs: totalDuration,
        cacheHit: false,
      });

      // Cache retrieval-only responses too
      if (cacheEnabled) {
        const cacheKey = generateCacheKey(body.query, topK, mode);
        const responseToCache = JSON.stringify(response.data);
        
        await cache.set(cacheKey, responseToCache, CACHE_TTL_SECONDS, log).catch((err) => {
          log.warn('Failed to cache response', {
            requestId: req.requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      res.json(response);
      return;
    }

    // Step 3: Generate LLM answer with citations (full RAG mode)
    answerStartTime = Date.now();
    
    // Convert RetrievedPassage[] to Context[] format
    let contexts: Context[] = retrievedPassages.map((passage) => ({
      text: passage.text,
      score: passage.score,
      metadata: passage.metadata,
    }));

    // Apply truncation to limit context size and control costs
    // In production, use proper token counting (e.g., tiktoken)
    const contextTexts = contexts.map((ctx) => ctx.text);
    const truncatedTexts = truncateContexts(contextTexts, MAX_CONTEXT_LENGTH);
    
    // Update contexts with truncated texts (preserve metadata)
    contexts = contexts.map((ctx, index) => ({
      ...ctx,
      text: truncatedTexts[index] || ctx.text,
    }));

    // Render production RAG prompt template (system + developer -> systemPrompt, user -> userPrompt)
    const contextSections = contexts.map((ctx, idx) => `[p${idx}]: ${ctx.text}`);
    const { systemPrompt, userPrompt } = await renderRagPrompts(contextSections, body.query);

    const answerResult = await generateAnswer(body.query, contexts, undefined, undefined, req.requestId, log, systemPrompt, userPrompt);
    answerDuration = Date.now() - answerStartTime;

    // Observability: record LLM usage (attempt accurate token counts)
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    try {
      const promptText = contexts.map((c) => c.text).join('\n\n') + '\n' + body.query;
      promptTokens = await countTokens(promptText, process.env.OPENAI_MODEL);
      completionTokens = await countTokens(answerResult.answer, process.env.OPENAI_MODEL);
      totalTokens = promptTokens + completionTokens;

      log.info('LLM token usage for query', {
        requestId: req.requestId,
        promptTokens,
        completionTokens,
        totalTokens,
        model: process.env.OPENAI_MODEL || 'unknown',
      });

      recordLLMTrace(req.requestId, promptTokens, completionTokens, process.env.OPENAI_MODEL || 'unknown', 0 /* cost placeholder */);
    } catch (err) {
      log.warn('Failed to record LLM trace', { requestId: req.requestId });
    }

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
    log.info('Query completed (full RAG mode)', {
      requestId: req.requestId,
      query: body.query,
      passagesRetrieved: retrievedPassages.length,
      citationsCount: citations.length,
      answerLength: answerResult.answer.length,
      retrievalDurationMs: retrievalDuration,
      answerGenerationDurationMs: answerDuration,
      totalDurationMs: totalDuration,
      promptTokens,
      completionTokens,
      tokenCount: totalTokens,
      topK,
      cacheHit: false,
    });

    // Track usage for billing (pass request-scoped logger for correlated usage logs)
    trackUsage({
      tenantId: req.tenant?.id || 'anonymous',
      timestamp: new Date(),
      endpoint: '/query',
      requestId: req.requestId || 'unknown',
      embeddingTokens: Math.ceil(body.query.length / 4),
      llmPromptTokens: promptTokens,
      llmCompletionTokens: completionTokens,
      durationMs: totalDuration,
      chunksRetrieved: retrievedPassages.length,
    }, log);

    // Cache the response if cache is enabled
    if (cacheEnabled) {
      const cacheKey = generateCacheKey(body.query, topK, mode);
      const responseToCache = JSON.stringify(response.data);
      
      // Populate semantic cache (vector) asynchronously, don't block response
      semanticSet(body.query, responseToCache, log).catch(() => {});

      await cache.set(cacheKey, responseToCache, CACHE_TTL_SECONDS, log).catch((err) => {
        // Log but don't fail the request if caching fails
        log.warn('Failed to cache response', {
          requestId: req.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    res.json(response);
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
});

// ============================================================================
// INGEST ENDPOINTS (Multi-tenant)
// ============================================================================

/**
 * Ingest text content directly via API
 * Great for ingesting app knowledge, documentation, etc.
 */
interface IngestTextRequest {
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

app.post('/ingest/text', apiKeyAuth({ required: true }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const log = (req as any).log || logger;
    const body = req.body as IngestTextRequest;
    const namespace = getTenantNamespace(req);

    // Validate request
    if (!body.text || typeof body.text !== 'string') {
      throw validationError('Request body must contain a "text" field of type string', { body: req.body });
    }

    if (!body.source || typeof body.source !== 'string') {
      throw validationError('Request body must contain a "source" field of type string', { body: req.body });
    }

    log.info('Processing text ingestion request', {
      requestId: req.requestId,
      tenantId: req.tenant?.id,
      namespace,
      source: body.source,
      textLength: body.text.length,
    });

    const result = await ingestText(body.text, body.source, namespace, body.metadata || {}, req.requestId, log);

    if (!result.success) {
      return res.status(500).json({
        requestId: req.requestId,
        success: false,
        error: result.error,
      });
    }

    res.json({
      requestId: req.requestId,
      success: true,
      data: {
        source: result.filePath,
        chunksProcessed: result.chunksProcessed,
        namespace: namespace || '(default)',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Batch ingest multiple text documents
 * Useful for ingesting app knowledge bases
 */
interface BatchIngestItem {
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

interface BatchIngestRequest {
  documents: BatchIngestItem[];
}

app.post('/ingest/batch', apiKeyAuth({ required: true }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const log = (req as any).log || logger;
    const body = req.body as BatchIngestRequest;
    const namespace = getTenantNamespace(req);

    // Validate request
    if (!body.documents || !Array.isArray(body.documents)) {
      throw validationError('Request body must contain a "documents" array', { body: req.body });
    }

    if (body.documents.length === 0) {
      throw validationError('Documents array cannot be empty', { body: req.body });
    }

    if (body.documents.length > 100) {
      throw validationError('Maximum 100 documents per batch', { count: body.documents.length });
    }

    log.info('Processing batch ingestion request', {
      requestId: req.requestId,
      tenantId: req.tenant?.id,
      namespace,
      documentCount: body.documents.length,
    });

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const doc of body.documents) {
      if (!doc.text || !doc.source) {
        results.push({
          source: doc.source || 'unknown',
          success: false,
          error: 'Missing text or source field',
        });
        errorCount++;
        continue;
      }

      const result = await ingestText(doc.text, doc.source, namespace, doc.metadata || {}, req.requestId, log);
      results.push({
        source: result.filePath,
        chunksProcessed: result.chunksProcessed,
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        successCount++;
      } else {
        errorCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    res.json({
      requestId: req.requestId,
      success: errorCount === 0,
      data: {
        total: body.documents.length,
        successful: successCount,
        failed: errorCount,
        namespace: namespace || '(default)',
        results,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete all documents in a namespace
 * Useful for re-indexing or cleanup
 */
app.delete('/ingest/namespace', apiKeyAuth({ required: true }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const log = (req as any).log || logger;
    const namespace = getTenantNamespace(req);
    
    if (!namespace) {
      throw validationError('Cannot delete default namespace. Provide a tenant-specific namespace.', {});
    }

    log.info('Processing namespace deletion request', {
      requestId: req.requestId,
      tenantId: req.tenant?.id,
      namespace,
    });

    // Load config and delete namespace
    const config = loadConfig();
    const { Pinecone } = await import('@pinecone-database/pinecone');
    const pinecone = new Pinecone({
      apiKey: config.pineconeApiKey,
    });

    const index = pinecone.index(config.pineconeIndexName);
    await index.namespace(namespace).deleteAll();

    log.info('Namespace deleted successfully', {
      requestId: req.requestId,
      namespace,
    });

    res.json({
      requestId: req.requestId,
      success: true,
      data: {
        namespace,
        message: 'All documents in namespace deleted',
      },
    });
  } catch (error) {
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
