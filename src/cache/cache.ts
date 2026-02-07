/**
 * Cache Module
 * 
 * Provides caching layer to reduce LLM API costs and improve response latency.
 * 
 * Performance Benefits:
 * - Reduces OpenAI API calls (major cost savings)
 * - Faster response times for repeated queries (sub-millisecond vs seconds)
 * - Lower latency for end users
 * - Reduced load on Pinecone vector database
 * 
 * Cost Savings:
 * - Typical LLM API call: $0.01-0.10 per query
 * - Cache hit: $0.00 per query
 * - Even 30% cache hit rate can save significant costs at scale
 * 
 * This module provides two implementations:
 * - RedisCache: Production-ready, distributed, persistent
 * - InMemoryCache: Development/testing, single-instance, process-local
 */

import { Redis, type RedisOptions } from 'ioredis';
import { OpenAIEmbeddings } from '@langchain/openai';
import { logger } from '../utils/logger.js';
import { createVectorClient } from '../utils/factory.js';
import { loadConfig } from '../utils/config.js';
import { cacheHitsCounter, cacheMissesCounter, cacheRequestDuration } from '../metrics/metrics.js';

// Semantic Cache Configuration
export const SEMANTIC_CACHE_CONFIG = {
  // Namespace for semantic cache vectors in Pinecone
  namespace: process.env.PINECONE_CACHE_NAMESPACE || 'semantic-cache',
  // Similarity threshold (0.0-1.0). Higher = more strict matching
  // 0.92-0.95 recommended for semantic cache
  similarityThreshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.92'),
  // TTL for semantic cache entries (in seconds). 1 hour = 3600s
  ttlSeconds: parseInt(process.env.SEMANTIC_CACHE_TTL_SECONDS || '3600', 10),
  // Whether to fail open (proceed without cache) if lookup fails
  failOpen: process.env.SEMANTIC_CACHE_FAIL_OPEN !== 'false',
};

/**
 * Cache interface for storing and retrieving cached responses
 */
export interface Cache {
  /**
   * Get a value from cache by key
   * @returns Cached value or null if not found/expired
   */
  get(key: string, reqLogger?: any): Promise<string | null>;

  /**
   * Set a value in cache with optional TTL
   * @param key Cache key
   * @param value Value to cache (must be JSON-serializable)
   * @param ttlSeconds Time to live in seconds (optional)
   */
  set(key: string, value: string, ttlSeconds?: number, reqLogger?: any): Promise<void>;

  /**
   * Close/disconnect the cache connection (cleanup)
   */
  close?(): Promise<void>;
}

/**
 * Redis-based cache implementation
 * Production-ready, supports distributed caching across multiple instances
 */
class RedisCache implements Cache {
  private client: Redis;

  constructor(redisUrl: string) {
    const options: RedisOptions = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        // Exponential backoff with max delay
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    };

    this.client = new Redis(redisUrl, options);

    this.client.on('error', (err: Error) => {
      logger.error('Redis cache error', { error: err.message });
    });

    this.client.on('connect', () => {
      logger.info('Redis cache connected');
    });

    // Connect immediately
    this.client.connect().catch((err: Error) => {
      logger.error('Redis cache connection failed', { error: err.message });
    });
  }

  async get(key: string, reqLogger?: any): Promise<string | null> {
    const log = reqLogger || logger;
    try {
      const start = process.hrtime.bigint();
      const value = await this.client.get(key);
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      cacheRequestDuration.observe({ backend: 'redis', hit: value ? 'true' : 'false' }, durationSec);
      if (value) {
        cacheHitsCounter.inc({ backend: 'redis' });
      } else {
        cacheMissesCounter.inc({ backend: 'redis' });
      }
      return value;
    } catch (error) {
      log.error('Redis cache get error', {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      // On error, return null (cache miss) rather than failing the request
      try {
        cacheRequestDuration.observe({ backend: 'redis', hit: 'false' }, 0);
        cacheMissesCounter.inc({ backend: 'redis' });
      } catch (e) {
        // ignore
      }
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number, reqLogger?: any): Promise<void> {
    const log = reqLogger || logger;
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      log.error('Redis cache set error', {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      // Fail silently - cache errors shouldn't break the API
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * In-memory cache implementation using Map
 * Simple, single-instance cache for development/testing
 * Note: Data is lost on process restart, not suitable for distributed deployments
 */
class InMemoryCache implements Cache {
  private cache: Map<string, { value: string; expiresAt?: number }> = new Map();

  async get(key: string, reqLogger?: any): Promise<string | null> {
    const log = reqLogger || logger;
    const entry = this.cache.get(key);

    const start = process.hrtime.bigint();
    if (!entry) {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      cacheRequestDuration.observe({ backend: 'inmemory', hit: 'false' }, durationSec);
      cacheMissesCounter.inc({ backend: 'inmemory' });
      log.debug('InMemoryCache miss', { key });
      return null;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      cacheRequestDuration.observe({ backend: 'inmemory', hit: 'false' }, durationSec);
      cacheMissesCounter.inc({ backend: 'inmemory' });
      log.debug('InMemoryCache expired', { key });
      return null;
    }

    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    cacheRequestDuration.observe({ backend: 'inmemory', hit: 'true' }, durationSec);
    cacheHitsCounter.inc({ backend: 'inmemory' });
    log.debug('InMemoryCache hit', { key });
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number, reqLogger?: any): Promise<void> {
    const log = reqLogger || logger;
    const entry: { value: string; expiresAt?: number } = { value };

    if (ttlSeconds) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }

    this.cache.set(key, entry);
    log.debug('InMemoryCache set', { key, ttlSeconds });

    // Cleanup expired entries periodically (every 100 sets)
    if (this.cache.size % 100 === 0) {
      this.cleanup();
    }
  }

  /**
   * Remove expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  async close(): Promise<void> {
    this.cache.clear();
  }
}

/**
 * Cache factory
 * Returns RedisCache if REDIS_URL is configured, otherwise InMemoryCache
 */
let cacheInstance: Cache | null = null;

export function getCache(): Cache {
  if (cacheInstance) {
    return cacheInstance;
  }

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    logger.info('Initializing Redis cache', { redisUrl: '***' });
    cacheInstance = new RedisCache(redisUrl);
  } else {
    logger.info('Initializing in-memory cache (Redis not configured)');
    cacheInstance = new InMemoryCache();
  }

  return cacheInstance;
}

/**
 * Semantic cache: use vector DB to store/query previous queries and their responses.
 * Provides quick, embedding-based cache lookups that match similar queries.
 * 
 * Configuration (via environment variables):
 * - PINECONE_CACHE_NAMESPACE: Namespace for cache vectors (default: 'semantic-cache')
 * - SEMANTIC_CACHE_THRESHOLD: Similarity threshold 0.0-1.0 (default: 0.92)
 * - SEMANTIC_CACHE_TTL_SECONDS: Cache TTL in seconds (default: 3600 = 1 hour)
 * - SEMANTIC_CACHE_FAIL_OPEN: 'true' to continue on cache errors (default: true)
 */
export async function semanticGet(
  query: string,
  similarityThreshold = SEMANTIC_CACHE_CONFIG.similarityThreshold,
  reqLogger?: any
): Promise<string | null> {
  const log = reqLogger || logger;
  const { namespace, ttlSeconds, failOpen } = SEMANTIC_CACHE_CONFIG;
  
  try {
    const start = process.hrtime.bigint();
    const config = loadConfig(log);

    const embeddings = new OpenAIEmbeddings({ openAIApiKey: config.openaiApiKey });
    const queryEmbedding = await embeddings.embedQuery(query);

    const vectorClient = createVectorClient(config, log);
    const index = vectorClient.index(config.pineconeIndexName);
    const targetIndex = index.namespace ? index.namespace(namespace) : index;

    const queryResponse = await targetIndex.query({
      vector: queryEmbedding,
      topK: 1,
      includeMetadata: true,
    });

    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    try {
      cacheRequestDuration.observe({ backend: 'vector', hit: queryResponse.matches && queryResponse.matches.length > 0 ? 'true' : 'false' }, durationSec);
      if (queryResponse.matches && queryResponse.matches.length > 0) {
        cacheHitsCounter.inc({ backend: 'vector' });
      } else {
        cacheMissesCounter.inc({ backend: 'vector' });
      }
    } catch (e) {
      // ignore metric errors
    }

    const match = (queryResponse.matches || [])[0];
    if (match && typeof match.score === 'number' && match.score >= similarityThreshold) {
      const metadata = match.metadata || {};
      const cached = (metadata.cachedResponse as string) || (metadata.response as string) || (metadata.answer as string) || null;
      if (cached) {
        // Check if entry is expired based on timestamp
        const timestamp = metadata.timestamp as string | undefined;
        if (timestamp && ttlSeconds > 0) {
          const entryTime = new Date(timestamp).getTime();
          const ageSeconds = (Date.now() - entryTime) / 1000;
          if (ageSeconds > ttlSeconds) {
            log.debug('Semantic cache entry expired', { id: match.id, ageSeconds, ttlSeconds, namespace });
            return null;
          }
        }
        log.info('Semantic cache hit', { similarity: match.score, namespace });
        return cached;
      }
    }

    log.debug('Semantic cache miss', { namespace, threshold: similarityThreshold });
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.warn('Semantic cache lookup failed', { error: errorMsg, failOpen });
    try {
      cacheRequestDuration.observe({ backend: 'vector', hit: 'false' }, 0);
      cacheMissesCounter.inc({ backend: 'vector' });
    } catch (e) {
      // ignore
    }
    // Fail open: return null to proceed without cache
    return null;
  }
}

export async function semanticSet(
  query: string,
  responseData: string,
  reqLogger?: any
): Promise<void> {
  const log = reqLogger || logger;
  const { namespace, ttlSeconds } = SEMANTIC_CACHE_CONFIG;
  
  try {
    const config = loadConfig(log);
    const embeddings = new OpenAIEmbeddings({ openAIApiKey: config.openaiApiKey });
    const queryEmbedding = await embeddings.embedQuery(query);
    const vectorClient = createVectorClient(config, log);
    const index = vectorClient.index(config.pineconeIndexName);
    const targetIndex = index.namespace ? index.namespace(namespace) : index;

    const id = `semantic:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

    // Upsert vector with metadata containing the cached response (JSON string)
    await targetIndex.upsert({
      vectors: [
        {
          id,
          values: queryEmbedding,
          metadata: {
            cachedResponse: responseData,
            timestamp: new Date().toISOString(),
            ttlSeconds, // Store TTL for reference
          },
        },
      ],
    });

    log.info('Semantic cache upserted', { id, namespace, ttlSeconds });
  } catch (error) {
    log.warn('Semantic cache set failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Generate cache key from query parameters
 * Ensures consistent keys for identical queries
 */
export function generateCacheKey(query: string, topK: number, mode: string): string {
  // Normalize query (trim, lowercase) for better cache hit rate
  const normalizedQuery = query.trim().toLowerCase();
  return `rag:query:${mode}:${topK}:${Buffer.from(normalizedQuery).toString('base64')}`;
}

