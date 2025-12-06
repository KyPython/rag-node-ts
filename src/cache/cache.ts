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
import { logger } from '../utils/logger.js';

/**
 * Cache interface for storing and retrieving cached responses
 */
export interface Cache {
  /**
   * Get a value from cache by key
   * @returns Cached value or null if not found/expired
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value in cache with optional TTL
   * @param key Cache key
   * @param value Value to cache (must be JSON-serializable)
   * @param ttlSeconds Time to live in seconds (optional)
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

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

  async get(key: string): Promise<string | null> {
    try {
      const value = await this.client.get(key);
      return value;
    } catch (error) {
      logger.error('Redis cache get error', {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      // On error, return null (cache miss) rather than failing the request
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error('Redis cache set error', {
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

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const entry: { value: string; expiresAt?: number } = { value };

    if (ttlSeconds) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }

    this.cache.set(key, entry);

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
 * Generate cache key from query parameters
 * Ensures consistent keys for identical queries
 */
export function generateCacheKey(query: string, topK: number, mode: string): string {
  // Normalize query (trim, lowercase) for better cache hit rate
  const normalizedQuery = query.trim().toLowerCase();
  return `rag:query:${mode}:${topK}:${Buffer.from(normalizedQuery).toString('base64')}`;
}

