/**
 * RAG Data Flow - Retrieval Pipeline
 * 
 * 1. Query Embedding: Convert user query into vector embedding using OpenAI (LangChain)
 * 2. Vector Search: Query Pinecone index for top-k most similar document chunks
 * 3. Result Formatting: Return passages with relevance scores and metadata
 * 
 * The retriever finds semantically similar content even if exact keywords don't match,
 * enabling natural language Q&A over the ingested document corpus.
 * 
 * Future enhancements:
 * - Use LangChain VectorStoreRetriever abstraction for easier DB swapping
 * - Add query expansion/rewriting for better recall
 * - Implement hybrid search (keyword + semantic)
 * - Add filtering by metadata (date ranges, document types, etc.)
 */

import { OpenAIEmbeddings } from '@langchain/openai';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { createVectorClient } from '../utils/factory.js';
import { recordRetrievalTrace } from '../llm/langsmith.js';
import { retrievalPrecisionGauge } from '../metrics/metrics.js';

export interface RetrievedPassage {
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * Retrieves relevant passages from Pinecone based on a query
 * 
 * @param query - The search query string
 * @param topK - Number of passages to retrieve (default: 5)
 * @param namespace - Pinecone namespace for multi-tenant isolation (optional)
 * @returns Array of retrieved passages with scores and metadata
 */
export async function retrieveRelevantPassages(
  query: string,
  topK: number = 5,
  namespace?: string,
  requestId?: string,
  reqLogger?: any
): Promise<RetrievedPassage[]> {
  const startTime = Date.now();
  const log = reqLogger || logger;

  try {
    log.info('Starting retrieval', {
      queryLength: query.length,
      topK,
    });

    // Load configuration
    const config = loadConfig(log);

    // Initialize embeddings
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openaiApiKey,
    });

    // Initialize vector client via factory (pinecone/chroma/azure)
    const vectorClient = createVectorClient(config, log);

    // Embed the query
    log.debug('Embedding query', { queryLength: query.length });
    const queryEmbedding = await embeddings.embedQuery(query);
    
    log.debug('Query embedded', {
      vectorDimensions: queryEmbedding.length,
    });

    // Query Pinecone (with optional namespace for multi-tenancy)
    // Use Pinecone-compatible index API from factory
    const index = vectorClient.index(config.pineconeIndexName);

    log.debug('Querying vector index', {
      indexName: config.pineconeIndexName,
      namespace: namespace || '(default)',
      topK,
      backend: process.env.VECTOR_BACKEND || 'pinecone',
    });

    // Use namespace if provided (for tenant isolation)
    const targetIndex = namespace ? index.namespace(namespace) : index;

    const queryResponse = await targetIndex.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });

    // Format results
    const passages: RetrievedPassage[] = (queryResponse.matches || []).map((match: any) => {
      // Extract text from metadata or use id as fallback
      const text = (match.metadata?.text as string) || match.id || '';
      
      return {
        text,
        score: match.score || 0,
        metadata: {
          ...match.metadata,
          id: match.id,
        },
      };
    });

    // Compute retrieval precision if we can infer relevance
    try {
      // If metadata contains an explicit `relevant` boolean flag, use it
      const relevantFromMetadata = passages.filter((p) => Boolean(p.metadata?.relevant)).length;

      // Compute precision@K using metadata flag when available
      if (relevantFromMetadata > 0) {
        const precision = relevantFromMetadata / topK;
        retrievalPrecisionGauge.set({ top_k: String(topK) }, precision);
        log.info('Computed retrieval precision from metadata', { topK, relevantFromMetadata, precision });
      }
    } catch (err) {
      // ignore metric errors
    }
    const duration = Date.now() - startTime;
    log.info('Retrieval completed', {
      queryLength: query.length,
      topK,
      namespace: namespace || '(default)',
      resultsCount: passages.length,
      durationMs: duration,
    });

    // Record tracing information (LangSmith stub)
    try {
      recordRetrievalTrace(requestId, query, passages.length, 0 /* cost placeholder */);
    } catch (err) {
      log.warn('Failed to record retrieval trace', { requestId });
    }

    return passages;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error('Retrieval failed', {
      query,
      error: errorMessage,
      durationMs: duration,
    });

    throw error;
  }
}
