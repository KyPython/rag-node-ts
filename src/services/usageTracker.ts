/**
 * Usage Tracking Service
 * 
 * Tracks API usage for billing and analytics:
 * - Request counts per tenant
 * - Token usage (embeddings + LLM)
 * - Storage usage
 * - Bandwidth tracking
 * 
 * In production, this would write to a database/analytics service.
 * This implementation stores in-memory and logs for demo purposes.
 */

import { logger } from '../utils/logger.js';

export interface UsageRecord {
  tenantId: string;
  timestamp: Date;
  endpoint: string;
  requestId: string;
  
  // Token metrics
  embeddingTokens?: number;
  llmPromptTokens?: number;
  llmCompletionTokens?: number;
  
  // Performance metrics
  durationMs: number;
  
  // Response metrics
  chunksRetrieved?: number;
  chunksIngested?: number;
  
  // Cost estimation (in millicents)
  estimatedCost?: number;
}

export interface UsageSummary {
  tenantId: string;
  period: string; // e.g., '2024-01', '2024-01-15'
  
  // Counts
  totalRequests: number;
  queryRequests: number;
  ingestRequests: number;
  
  // Token usage
  totalEmbeddingTokens: number;
  totalLlmPromptTokens: number;
  totalLlmCompletionTokens: number;
  
  // Storage
  chunksStored: number;
  
  // Cost
  estimatedCostCents: number;
}

// Cost per 1K tokens (in millicents) - adjust based on OpenAI pricing
const COSTS = {
  embedding: 2, // $0.00002 per 1K tokens = 2 millicents
  llmPrompt: 10, // gpt-4o-mini: $0.00010 per 1K = 10 millicents
  llmCompletion: 30, // gpt-4o-mini: $0.00030 per 1K = 30 millicents
  pineconeRead: 1, // ~$0.00001 per read
  pineconeWrite: 2, // ~$0.00002 per write
};

// In-memory storage (replace with database in production)
const usageRecords: UsageRecord[] = [];
const MAX_RECORDS = 10000; // Keep last 10K records in memory

/**
 * Record a usage event
 */
export function trackUsage(record: UsageRecord): void {
  // Calculate cost
  let costMillicents = 0;
  
  if (record.embeddingTokens) {
    costMillicents += Math.ceil((record.embeddingTokens / 1000) * COSTS.embedding);
  }
  if (record.llmPromptTokens) {
    costMillicents += Math.ceil((record.llmPromptTokens / 1000) * COSTS.llmPrompt);
  }
  if (record.llmCompletionTokens) {
    costMillicents += Math.ceil((record.llmCompletionTokens / 1000) * COSTS.llmCompletion);
  }
  if (record.chunksRetrieved) {
    costMillicents += record.chunksRetrieved * COSTS.pineconeRead;
  }
  if (record.chunksIngested) {
    costMillicents += record.chunksIngested * COSTS.pineconeWrite;
  }
  
  record.estimatedCost = costMillicents;
  
  // Store record
  usageRecords.push(record);
  
  // Trim if over limit
  if (usageRecords.length > MAX_RECORDS) {
    usageRecords.splice(0, usageRecords.length - MAX_RECORDS);
  }
  
  // Log for observability
  logger.info('Usage tracked', {
    tenantId: record.tenantId,
    endpoint: record.endpoint,
    requestId: record.requestId,
    embeddingTokens: record.embeddingTokens,
    llmTokens: (record.llmPromptTokens || 0) + (record.llmCompletionTokens || 0),
    durationMs: record.durationMs,
    estimatedCostMillicents: costMillicents,
  });
}

/**
 * Get usage summary for a tenant
 */
export function getUsageSummary(
  tenantId: string,
  startDate: Date,
  endDate: Date
): UsageSummary {
  const records = usageRecords.filter(
    (r) =>
      r.tenantId === tenantId &&
      r.timestamp >= startDate &&
      r.timestamp <= endDate
  );
  
  const summary: UsageSummary = {
    tenantId,
    period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
    totalRequests: records.length,
    queryRequests: records.filter((r) => r.endpoint.includes('/query')).length,
    ingestRequests: records.filter((r) => r.endpoint.includes('/ingest')).length,
    totalEmbeddingTokens: records.reduce((sum, r) => sum + (r.embeddingTokens || 0), 0),
    totalLlmPromptTokens: records.reduce((sum, r) => sum + (r.llmPromptTokens || 0), 0),
    totalLlmCompletionTokens: records.reduce((sum, r) => sum + (r.llmCompletionTokens || 0), 0),
    chunksStored: records.reduce((sum, r) => sum + (r.chunksIngested || 0), 0),
    estimatedCostCents: Math.ceil(
      records.reduce((sum, r) => sum + (r.estimatedCost || 0), 0) / 100
    ),
  };
  
  return summary;
}

/**
 * Get current month usage for a tenant
 */
export function getCurrentMonthUsage(tenantId: string): UsageSummary {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  return getUsageSummary(tenantId, startOfMonth, endOfMonth);
}

/**
 * Get today's usage for a tenant
 */
export function getTodayUsage(tenantId: string): UsageSummary {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  
  return getUsageSummary(tenantId, startOfDay, endOfDay);
}

/**
 * Export usage records for billing (returns last N records)
 */
export function exportUsageRecords(
  tenantId: string,
  limit: number = 1000
): UsageRecord[] {
  return usageRecords
    .filter((r) => r.tenantId === tenantId)
    .slice(-limit);
}

/**
 * Estimate cost for a query (for quota checking)
 */
export function estimateQueryCost(
  topK: number,
  estimatedAnswerTokens: number = 500
): number {
  // Embedding: ~10 tokens per query
  const embeddingCost = Math.ceil((10 / 1000) * COSTS.embedding);
  
  // Retrieval: topK chunks
  const retrievalCost = topK * COSTS.pineconeRead;
  
  // LLM: prompt (context + query) + completion
  const avgContextTokens = topK * 200; // ~200 tokens per chunk
  const promptCost = Math.ceil(((avgContextTokens + 100) / 1000) * COSTS.llmPrompt);
  const completionCost = Math.ceil((estimatedAnswerTokens / 1000) * COSTS.llmCompletion);
  
  return embeddingCost + retrievalCost + promptCost + completionCost;
}

export { COSTS };

