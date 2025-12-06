/**
 * Centralized Error Handler Middleware
 * 
 * Handles all errors in the application and returns structured JSON responses.
 * Distinguishes between:
 * - Expected errors (validation, client errors) → 4xx status codes
 * - Unexpected errors (server errors) → 500 status code with safe messaging
 * 
 * All errors include the requestId for traceability.
 */

import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Custom error class for expected application errors
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 400,
    code?: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || this.getDefaultCode(statusCode);
    this.details = details;

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  private getDefaultCode(statusCode: number): string {
    if (statusCode >= 400 && statusCode < 500) {
      if (statusCode === 400) return 'BAD_REQUEST';
      if (statusCode === 401) return 'UNAUTHORIZED';
      if (statusCode === 403) return 'FORBIDDEN';
      if (statusCode === 404) return 'NOT_FOUND';
      if (statusCode === 422) return 'VALIDATION_ERROR';
      return 'CLIENT_ERROR';
    }
    return 'INTERNAL_ERROR';
  }
}

/**
 * Centralized error handler middleware
 * Must be registered last in the middleware chain (after all routes)
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId || 'unknown';

  // Determine if this is an expected application error
  const isAppError = err instanceof AppError;

  if (isAppError) {
    // Expected error - return structured response with status code
    const statusCode = err.statusCode;

    logger.warn('Request error (expected)', {
      requestId,
      error: err.message,
      code: err.code,
      statusCode,
      path: req.path,
      method: req.method,
      details: err.details,
    });

    const errorResponse: {
      requestId: string;
      error: {
        message: string;
        code: string;
        details?: unknown;
      };
    } = {
      requestId,
      error: {
        message: err.message,
        code: err.code,
      },
    };

    if (err.details) {
      errorResponse.error.details = err.details;
    }

    res.status(statusCode).json(errorResponse);
    return;
  }

  // Unexpected error - log full details, return safe message
  const statusCode = 500;

  logger.error('Request error (unexpected)', {
    requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
  });

  // In production, don't expose internal error details
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message;

  res.status(statusCode).json({
    requestId,
    error: {
      message,
      code: 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && { details: err.message }),
    },
  });
}

/**
 * Helper to create validation errors
 */
export function validationError(
  message: string,
  details?: unknown
): AppError {
  return new AppError(message, 422, 'VALIDATION_ERROR', details);
}

/**
 * Helper to create not found errors
 */
export function notFoundError(message: string = 'Resource not found'): AppError {
  return new AppError(message, 404, 'NOT_FOUND');
}

