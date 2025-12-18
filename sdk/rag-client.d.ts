/**
 * RAG-as-a-Service Client SDK
 *
 * A TypeScript/JavaScript client for the RAG API.
 * Can be used in Node.js or browser environments.
 *
 * Usage:
 * ```typescript
 * import { RagClient } from '@yourcompany/rag-client';
 *
 * const rag = new RagClient({
 *   apiKey: 'sk_rag_xxx',
 *   baseUrl: 'https://rag.yourcompany.com'
 * });
 *
 * // Query with full RAG answer
 * const answer = await rag.query('What is machine learning?');
 * console.log(answer.answer, answer.citations);
 *
 * // Retrieval only
 * const passages = await rag.retrieve('machine learning', { topK: 10 });
 *
 * // Ingest content
 * await rag.ingest('New knowledge content...', 'source-name');
 * ```
 */
export interface RagClientConfig {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
}
export interface QueryOptions {
    topK?: number;
    mode?: 'answer' | 'retrieval';
    cacheMode?: 'on' | 'off';
}
export interface Citation {
    index: number;
    text: string;
    score: number;
    metadata: Record<string, unknown>;
}
export interface QueryResult {
    query: string;
    answer: string;
    citations: Citation[];
    cached?: boolean;
}
export interface RetrievalResult {
    query: string;
    results: {
        text: string;
        score: number;
        metadata: Record<string, unknown>;
    }[];
}
export interface IngestResult {
    success: boolean;
    source: string;
    chunksProcessed: number;
}
export interface BatchIngestResult {
    success: boolean;
    total: number;
    successful: number;
    failed: number;
    results: IngestResult[];
}
export interface UsageStats {
    minute: {
        count: number;
        limit: number;
        remaining: number;
    };
    day: {
        count: number;
        limit: number;
        remaining: number;
    };
}
export declare class RagClientError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(message: string, status: number, code?: string);
}
export declare class RagClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeout;
    constructor(config: RagClientConfig);
    /**
     * Make an authenticated request to the API
     */
    private request;
    /**
     * Query the RAG system for an answer
     */
    query(question: string, options?: QueryOptions): Promise<QueryResult>;
    /**
     * Retrieve relevant passages without generating an answer
     */
    retrieve(question: string, options?: {
        topK?: number;
    }): Promise<RetrievalResult>;
    /**
     * Ingest text content into the knowledge base
     */
    ingest(text: string, source: string, metadata?: Record<string, unknown>): Promise<IngestResult>;
    /**
     * Batch ingest multiple documents
     */
    ingestBatch(documents: Array<{
        text: string;
        source: string;
        metadata?: Record<string, unknown>;
    }>): Promise<BatchIngestResult>;
    /**
     * Delete all documents (re-index)
     */
    clearNamespace(): Promise<void>;
    /**
     * Health check
     */
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
    }>;
}
export default RagClient;
//# sourceMappingURL=rag-client.d.ts.map