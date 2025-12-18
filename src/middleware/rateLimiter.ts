/**
 * Per-Tenant Rate Limiting Middleware
 * 
 * Implements fair rate limiting for SaaS:
 * - Each tenant gets their own rate limit bucket
 * - Configurable limits per tenant tier
 * - Returns clear headers for client retry logic
 * 
 * Headers returned:
 * - X-RateLimit-Limit: Max requests per window
 * - X-RateLimit-Remaining: Requests remaining
 * - X-RateLimit-Reset: Unix timestamp when limit resets
 * - Retry-After: Seconds until limit resets (only when limited)
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

interface RateLimitBucket {
  count: number;
  resetTime: number;
}

interface TierLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
}

// Free tier limits - guaranteed to always exist
const FREE_TIER_LIMITS: TierLimits = {
  requestsPerMinute: 10,
  requestsPerDay: 100,
  tokensPerDay: 50000,
};

// Default tier limits - override via TIER_LIMITS_* env vars
const DEFAULT_TIER_LIMITS: Record<string, TierLimits> = {
  free: FREE_TIER_LIMITS,
  starter: {
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerDay: 500000,
  },
  pro: {
    requestsPerMinute: 100,
    requestsPerDay: 10000,
    tokensPerDay: 5000000,
  },
  enterprise: {
    requestsPerMinute: 500,
    requestsPerDay: 100000,
    tokensPerDay: 50000000,
  },
};

// In-memory rate limit store (use Redis in production for distributed systems)
const minuteBuckets = new Map<string, RateLimitBucket>();
const dailyBuckets = new Map<string, RateLimitBucket>();

// Load tier limits from environment
function loadTierLimits(): Record<string, TierLimits> {
  const limits = { ...DEFAULT_TIER_LIMITS };
  
  // Override from environment
  // Format: TIER_LIMITS_PRO=100:10000:5000000 (rpm:rpd:tpd)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('TIER_LIMITS_') && value) {
      const tier = key.replace('TIER_LIMITS_', '').toLowerCase();
      const [rpm, rpd, tpd] = value.split(':').map(Number);
      if (rpm && rpd && tpd) {
        limits[tier] = {
          requestsPerMinute: rpm,
          requestsPerDay: rpd,
          tokensPerDay: tpd,
        };
      }
    }
  }
  
  return limits;
}

const tierLimits = loadTierLimits();

/**
 * Get or create a rate limit bucket
 */
function getBucket(
  store: Map<string, RateLimitBucket>,
  key: string,
  windowMs: number
): RateLimitBucket {
  const now = Date.now();
  const existing = store.get(key);
  
  if (existing && existing.resetTime > now) {
    return existing;
  }
  
  // Create new bucket
  const bucket: RateLimitBucket = {
    count: 0,
    resetTime: now + windowMs,
  };
  store.set(key, bucket);
  return bucket;
}

/**
 * Clean up expired buckets (call periodically)
 */
function cleanupBuckets() {
  const now = Date.now();
  
  for (const [key, bucket] of minuteBuckets) {
    if (bucket.resetTime <= now) {
      minuteBuckets.delete(key);
    }
  }
  
  for (const [key, bucket] of dailyBuckets) {
    if (bucket.resetTime <= now) {
      dailyBuckets.delete(key);
    }
  }
}

// Cleanup every minute
setInterval(cleanupBuckets, 60000);

/**
 * Rate limiting middleware
 */
export function rateLimiter() {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenant?.id || 'anonymous';
    const tier = (req.tenant as any)?.tier || 'free';
    // Always fallback to free tier limits - this is guaranteed to exist
    const limits: TierLimits = tierLimits[tier] ?? FREE_TIER_LIMITS;
    
    const now = Date.now();
    
    // Check minute limit
    const minuteKey = `${tenantId}:minute`;
    const minuteBucket = getBucket(minuteBuckets, minuteKey, 60000);
    
    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `${tenantId}:day:${today}`;
    const dailyBucket = getBucket(dailyBuckets, dailyKey, 24 * 60 * 60 * 1000);
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit-Minute', limits.requestsPerMinute);
    res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, limits.requestsPerMinute - minuteBucket.count));
    res.setHeader('X-RateLimit-Reset-Minute', Math.ceil(minuteBucket.resetTime / 1000));
    
    res.setHeader('X-RateLimit-Limit-Day', limits.requestsPerDay);
    res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, limits.requestsPerDay - dailyBucket.count));
    
    // Check if over minute limit
    if (minuteBucket.count >= limits.requestsPerMinute) {
      const retryAfter = Math.ceil((minuteBucket.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      
      logger.warn('Rate limit exceeded (minute)', {
        requestId: req.requestId,
        tenantId,
        tier,
        limit: limits.requestsPerMinute,
        resetIn: retryAfter,
      });
      
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Limit: ${limits.requestsPerMinute}/minute`,
        retryAfter,
        limit: limits.requestsPerMinute,
        window: 'minute',
      });
    }
    
    // Check if over daily limit
    if (dailyBucket.count >= limits.requestsPerDay) {
      const retryAfter = Math.ceil((dailyBucket.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      
      logger.warn('Rate limit exceeded (daily)', {
        requestId: req.requestId,
        tenantId,
        tier,
        limit: limits.requestsPerDay,
      });
      
      return res.status(429).json({
        error: 'Daily rate limit exceeded',
        message: `Daily limit reached. Limit: ${limits.requestsPerDay}/day`,
        retryAfter,
        limit: limits.requestsPerDay,
        window: 'day',
      });
    }
    
    // Increment counters
    minuteBucket.count++;
    dailyBucket.count++;
    
    next();
  };
}

/**
 * Get current usage for a tenant
 */
export function getTenantUsage(tenantId: string): {
  minute: { count: number; limit: number; resetTime: number };
  day: { count: number; limit: number; resetTime: number };
} {
  const tier = 'free'; // Would come from tenant config
  const limits: TierLimits = tierLimits[tier] ?? FREE_TIER_LIMITS;
  
  const minuteKey = `${tenantId}:minute`;
  const minuteBucket = minuteBuckets.get(minuteKey);
  
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `${tenantId}:day:${today}`;
  const dailyBucket = dailyBuckets.get(dailyKey);
  
  return {
    minute: {
      count: minuteBucket?.count || 0,
      limit: limits.requestsPerMinute,
      resetTime: minuteBucket?.resetTime || Date.now() + 60000,
    },
    day: {
      count: dailyBucket?.count || 0,
      limit: limits.requestsPerDay,
      resetTime: dailyBucket?.resetTime || Date.now() + 24 * 60 * 60 * 1000,
    },
  };
}

export { tierLimits, DEFAULT_TIER_LIMITS };

