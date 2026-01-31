/**
 * LangSmith tracing helper (lightweight stub)
 * Records simple trace events for request lifecycle: retrievals and LLM calls.
 * Replace with full LangSmith SDK integration in production.
 */
import { logger } from '../utils/logger.js';

export function recordRetrievalTrace(requestId: string | undefined, query: string, passagesCount: number, costUsd?: number) {
  logger.info('LangSmithTrace: retrieval', {
    requestId,
    queryPreview: query.slice(0, 200),
    passagesCount,
    costUsd: costUsd ?? 0,
  });
}

export function recordLLMTrace(requestId: string | undefined, promptSizeTokens: number, completionTokens: number, model?: string, costUsd?: number) {
  logger.info('LangSmithTrace: llm', {
    requestId,
    model: model || 'unknown',
    promptSizeTokens,
    completionTokens,
    costUsd: costUsd ?? 0,
  });
}
