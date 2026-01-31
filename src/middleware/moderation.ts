/**
 * Moderation Gateway / Bouncer
 * - Intent filtering: allow only legal-related queries to reach the LLM
 * - Adversarial defense: detect common jailbreak patterns and block
 */
import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../utils/logger.js';

const LEGAL_KEYWORDS = [
  'contract',
  'agreement',
  'law',
  'statute',
  'compliance',
  'nda',
  'lease',
  'purchase',
  'plaintiff',
  'defendant',
  'litigation',
  'tort',
  'warranty',
  'liability',
  'settlement',
];

const JAILBREAK_PATTERNS = [
  /ignore (previous|all) instructions/i,
  /disregard (previous|all) instructions/i,
  /override (previous|all) instructions/i,
  /jailbreak/i,
  /break out of/i,
  /bypass safety/i,
  /do anything now/i,
];

function looksLikeLegalIntent(query: string): boolean {
  const q = query.toLowerCase();
  return LEGAL_KEYWORDS.some((kw) => q.includes(kw));
}

function containsJailbreakAttempt(query: string): boolean {
  return JAILBREAK_PATTERNS.some((rx) => rx.test(query));
}

export function moderationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply moderation to the primary query endpoint
  if (req.method !== 'POST' || req.path !== '/query') {
    next();
    return;
  }

  const body = req.body as { query?: string } | undefined;
  const query = body?.query;

  if (!query || typeof query !== 'string') {
    // Defer validation to existing request handlers, but log for observability
    logger.warn('Moderation: missing or invalid query in request', { requestId: req.requestId });
    next();
    return;
  }

  // Adversarial check: if jailbreak pattern present, block immediately
  if (containsJailbreakAttempt(query)) {
    logger.warn('Moderation: blocked adversarial/jailbreak attempt', {
      requestId: req.requestId,
      queryPreview: query.slice(0, 200),
      reason: 'JAILBREAK_PATTERN',
    });

    res.status(403).json({
      requestId: req.requestId,
      success: false,
      error: 'Adversarial content detected: request blocked by moderation gateway',
      code: 'JAILBREAK_DETECTED',
    });
    return;
  }

  // Intent filtering: allow only legal-related queries through to the LLM
  if (!looksLikeLegalIntent(query)) {
    logger.info('Moderation: non-legal intent blocked', {
      requestId: req.requestId,
      queryPreview: query.slice(0, 200),
      reason: 'NON_LEGAL_INTENT',
    });

    res.status(403).json({
      requestId: req.requestId,
      success: false,
      error: 'Query appears outside allowed domain (legal). Refuse to process.',
      code: 'NON_LEGAL_INTENT',
    });
    return;
  }

  // Passed moderation checks
  next();
}
