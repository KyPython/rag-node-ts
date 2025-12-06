/**
 * Prometheus Metrics Module
 * 
 * Exposes HTTP metrics using prom-client:
 * - HTTP request count by route and status code
 * - Request duration histogram
 * 
 * Metrics are exposed at /metrics endpoint in Prometheus format.
 */

import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
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
 * Middleware to record HTTP metrics
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: () => void
): void {
  const startTime = Date.now();
  const route = req.route?.path || req.path || 'unknown';

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

