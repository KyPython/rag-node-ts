/**
 * Prometheus Metrics Module
 * 
 * Exposes HTTP metrics using prom-client:
 * - HTTP request count by route and status code
 * - Request duration histogram
 * 
 * Metrics are exposed at /metrics endpoint in Prometheus format.
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { type Request, type Response } from 'express';

// Create a custom registry
export const register = new Registry();

// Collect default Node.js metrics (CPU, memory, etc.)
collectDefaultMetrics({ register });

/**
 * HTTP request counter
 * Labels: method, route, status_code
 */
export const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/**
 * HTTP request duration histogram
 * Labels: method, route, status_code
 * Buckets: 0.1s, 0.5s, 1s, 2.5s, 5s, 10s
 */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * LLM TTFT and total generation time (seconds)
 * Labels: model
 */
export const llmTTFTHistogram = new Histogram({
  name: 'llm_ttft_seconds',
  help: 'Time to first token for LLM responses in seconds',
  labelNames: ['model'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const llmTotalHistogram = new Histogram({
  name: 'llm_total_generation_seconds',
  help: 'Total LLM generation time in seconds',
  labelNames: ['model'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

/**
 * Retrieval precision gauge (value 0.0 - 1.0)
 * Labels: top_k
 */
export const retrievalPrecisionGauge = new Gauge({
  name: 'retrieval_precision',
  help: 'Retrieval precision@K (fraction of top-K that are relevant)',
  labelNames: ['top_k'],
  registers: [register],
});

/**
 * Cache metrics: hit/miss counters and request duration histogram
 */
export const cacheHitsCounter = new Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['backend'],
  registers: [register],
});

export const cacheMissesCounter = new Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['backend'],
  registers: [register],
});

export const cacheRequestDuration = new Histogram({
  name: 'cache_request_duration_seconds',
  help: 'Cache request duration in seconds',
  labelNames: ['backend', 'hit'],
  buckets: [0.0001, 0.001, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

/**
 * Middleware to record HTTP metrics
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: () => void
): void {
  const startTime = Date.now();
  const route = req.route?.path || req.path || 'unknown';
  const log = (req as any).log;

  // Override res.end to record metrics when response finishes
  const originalEnd = res.end.bind(res);
  res.end = function (
    chunk?: unknown,
    encoding?: BufferEncoding | (() => void),
    cb?: (() => void)
  ) {
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const statusCode = res.statusCode.toString();
    const method = req.method;

    // Record metrics
    httpRequestCounter.inc({
      method,
      route,
      status_code: statusCode,
    });

    httpRequestDuration.observe(
      {
        method,
        route,
        status_code: statusCode,
      },
      duration
    );

    // If a request-scoped logger exists, log a lightweight metrics event for correlation
    if (log && typeof log.debug === 'function') {
      try {
        log.debug('Recorded HTTP metrics', {
          requestId: (req as any).requestId,
          method,
          route,
          statusCode,
          durationSeconds: duration,
        });
      } catch (err) {
        // swallow logging errors to avoid impacting response
      }
    }

    // Call original end with proper typing
    if (typeof encoding === 'function') {
      return originalEnd(chunk, encoding);
    }
    if (typeof cb === 'function') {
      return originalEnd(chunk, encoding as BufferEncoding, cb);
    }
    return originalEnd(chunk, encoding as BufferEncoding);
  };

  next();
}

/**
 * Express handler for /metrics endpoint
 * Returns Prometheus-formatted metrics text
 */
export function metricsHandler(_req: Request, res: Response): void {
  res.set('Content-Type', register.contentType);
  register.metrics().then((metrics) => {
    res.end(metrics);
  });
}

