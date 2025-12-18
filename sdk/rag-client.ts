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
  minute: { count: number; limit: number; remaining: number };
  day: { count: number; limit: number; remaining: number };
}

export class RagClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  
  constructor(message: string, status: number, code: string = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'RagClientError';
    this.status = status;
    this.code = code;
  }
}

export class RagClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  
  constructor(config: RagClientConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    this.timeout = config.timeout || 30000;
  }
  
  /**
   * Make an authenticated request to the API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      });
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new RagClientError(
          data.message || data.error || 'Request failed',
          response.status,
          data.code
        );
      }
      
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof RagClientError) {
        throw error;
      }
      
      if ((error as Error).name === 'AbortError') {
        throw new RagClientError('Request timeout', 408, 'TIMEOUT');
      }
      
      throw new RagClientError(
        (error as Error).message || 'Network error',
        0,
        'NETWORK_ERROR'
      );
    }
  }
  
  /**
   * Query the RAG system for an answer
   */
  async query(question: string, options: QueryOptions = {}): Promise<QueryResult> {
    const response = await this.request<{ data: QueryResult; _cached?: boolean }>(
      'POST',
      '/query',
      { query: question, topK: options.topK || 5 },
      {
        mode: options.mode || 'answer',
        cacheMode: options.cacheMode || 'on',
      }
    );
    
    return {
      ...response.data,
      cached: response._cached,
    };
  }
  
  /**
   * Retrieve relevant passages without generating an answer
   */
  async retrieve(question: string, options: { topK?: number } = {}): Promise<RetrievalResult> {
    const response = await this.request<{ data: RetrievalResult }>(
      'POST',
      '/query',
      { query: question, topK: options.topK || 5 },
      { mode: 'retrieval' }
    );
    
    return response.data;
  }
  
  /**
   * Ingest text content into the knowledge base
   */
  async ingest(
    text: string,
    source: string,
    metadata?: Record<string, unknown>
  ): Promise<IngestResult> {
    const response = await this.request<{ data: IngestResult }>(
      'POST',
      '/ingest/text',
      { text, source, metadata }
    );
    
    return response.data;
  }
  
  /**
   * Batch ingest multiple documents
   */
  async ingestBatch(
    documents: Array<{ text: string; source: string; metadata?: Record<string, unknown> }>
  ): Promise<BatchIngestResult> {
    const response = await this.request<{ data: BatchIngestResult }>(
      'POST',
      '/ingest/batch',
      { documents }
    );
    
    return response.data;
  }
  
  /**
   * Delete all documents (re-index)
   */
  async clearNamespace(): Promise<void> {
    await this.request('DELETE', '/ingest/namespace');
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('GET', '/health');
  }
}

// Default export
export default RagClient;

// CommonJS support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RagClient;
  module.exports.RagClient = RagClient;
  module.exports.RagClientError = RagClientError;
}

