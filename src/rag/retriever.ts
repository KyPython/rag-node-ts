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
import { Pinecone } from '@pinecone-database/pinecone';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

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
  namespace?: string
): Promise<RetrievedPassage[]> {
  const startTime = Date.now();

  try {
    logger.info('Starting retrieval', {
      queryLength: query.length,
      topK,
    });

    // Load configuration
    const config = loadConfig();

    // Initialize embeddings
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openaiApiKey,
    });

    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: config.pineconeApiKey,
      ...(config.pineconeEnvironment && { environment: config.pineconeEnvironment }),
    });

    // Embed the query
    logger.debug('Embedding query', { queryLength: query.length });
    const queryEmbedding = await embeddings.embedQuery(query);
    
    logger.debug('Query embedded', {
      vectorDimensions: queryEmbedding.length,
    });

    // Query Pinecone (with optional namespace for multi-tenancy)
    const index = pinecone.index(config.pineconeIndexName);
    
    logger.debug('Querying Pinecone', {
      indexName: config.pineconeIndexName,
      namespace: namespace || '(default)',
      topK,
    });

    // Use namespace if provided (for tenant isolation)
    const targetIndex = namespace ? index.namespace(namespace) : index;
    
    const queryResponse = await targetIndex.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });

    // Format results
    const passages: RetrievedPassage[] = (queryResponse.matches || []).map((match) => {
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

    const duration = Date.now() - startTime;
    logger.info('Retrieval completed', {
      queryLength: query.length,
      topK,
      namespace: namespace || '(default)',
      resultsCount: passages.length,
      durationMs: duration,
    });

    return passages;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Retrieval failed', {
      query,
      error: errorMessage,
      durationMs: duration,
    });

    throw error;
  }
}
