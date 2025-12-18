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
export class RagClientError extends Error {
    status;
    code;
    constructor(message, status, code = 'UNKNOWN_ERROR') {
        super(message);
        this.name = 'RagClientError';
        this.status = status;
        this.code = code;
    }
}
export class RagClient {
    apiKey;
    baseUrl;
    timeout;
    constructor(config) {
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
    async request(method, path, body, queryParams) {
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
                throw new RagClientError(data.message || data.error || 'Request failed', response.status, data.code);
            }
            return data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof RagClientError) {
                throw error;
            }
            if (error.name === 'AbortError') {
                throw new RagClientError('Request timeout', 408, 'TIMEOUT');
            }
            throw new RagClientError(error.message || 'Network error', 0, 'NETWORK_ERROR');
        }
    }
    /**
     * Query the RAG system for an answer
     */
    async query(question, options = {}) {
        const response = await this.request('POST', '/query', { query: question, topK: options.topK || 5 }, {
            mode: options.mode || 'answer',
            cacheMode: options.cacheMode || 'on',
        });
        return {
            ...response.data,
            cached: response._cached,
        };
    }
    /**
     * Retrieve relevant passages without generating an answer
     */
    async retrieve(question, options = {}) {
        const response = await this.request('POST', '/query', { query: question, topK: options.topK || 5 }, { mode: 'retrieval' });
        return response.data;
    }
    /**
     * Ingest text content into the knowledge base
     */
    async ingest(text, source, metadata) {
        const response = await this.request('POST', '/ingest/text', { text, source, metadata });
        return response.data;
    }
    /**
     * Batch ingest multiple documents
     */
    async ingestBatch(documents) {
        const response = await this.request('POST', '/ingest/batch', { documents });
        return response.data;
    }
    /**
     * Delete all documents (re-index)
     */
    async clearNamespace() {
        await this.request('DELETE', '/ingest/namespace');
    }
    /**
     * Health check
     */
    async healthCheck() {
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
//# sourceMappingURL=rag-client.js.map