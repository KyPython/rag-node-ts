/**
 * Request ID Middleware
 * 
 * Generates a unique request ID (UUID) for each incoming HTTP request.
 * This ID is:
 * - Attached to the request object for use throughout the request lifecycle
 * - Included in all log entries
 * - Returned in response headers as X-Request-Id
 * - Included in error responses for traceability
 */

import { randomUUID } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';

// Extend Express Request type to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Middleware that generates and attaches a request ID to each request
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate a unique request ID (UUID v4)
  const requestId = randomUUID();

  // Attach to request object for use in routes and error handlers
  req.requestId = requestId;

  // Add X-Request-Id header to response for client-side tracing
  res.setHeader('X-Request-Id', requestId);

  next();
}

