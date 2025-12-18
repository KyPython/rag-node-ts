/**
 * Admin API Routes
 * 
 * Internal/admin endpoints for managing the RAG SaaS:
 * - Tenant management
 * - Usage analytics
 * - System health
 * 
 * Protected by admin API key (RAG_ADMIN_KEY env var)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { getTenantUsage, tierLimits } from '../middleware/rateLimiter.js';
import {
  getCurrentMonthUsage,
  getTodayUsage,
  exportUsageRecords,
} from '../services/usageTracker.js';

const router = Router();

// Admin key validation middleware
const ADMIN_KEY = process.env.RAG_ADMIN_KEY;

function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_KEY) {
    logger.warn('Admin API accessed but RAG_ADMIN_KEY not configured');
    return res.status(503).json({
      error: 'Admin API not configured',
      message: 'Set RAG_ADMIN_KEY environment variable to enable admin API',
    });
  }
  
  const providedKey = req.headers['x-admin-key'] || req.query.adminKey;
  
  if (providedKey !== ADMIN_KEY) {
    logger.warn('Invalid admin key attempt', {
      requestId: req.requestId,
      ip: req.ip,
    });
    return res.status(403).json({
      error: 'Invalid admin key',
    });
  }
  
  next();
}

// Apply admin auth to all routes
router.use(adminAuth);

/**
 * GET /admin/health
 * Extended health check with system stats
 */
router.get('/health', async (req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
    },
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
  });
});

/**
 * GET /admin/tiers
 * List available pricing tiers and limits
 */
router.get('/tiers', (req: Request, res: Response) => {
  res.json({
    tiers: Object.entries(tierLimits).map(([name, limits]) => ({
      name,
      ...limits,
    })),
  });
});

/**
 * GET /admin/usage/:tenantId
 * Get usage stats for a specific tenant
 */
router.get('/usage/:tenantId', (req: Request, res: Response) => {
  const tenantId = req.params.tenantId || 'unknown';
  
  const rateLimits = getTenantUsage(tenantId);
  const todayUsage = getTodayUsage(tenantId);
  const monthUsage = getCurrentMonthUsage(tenantId);
  
  res.json({
    tenantId,
    rateLimits,
    today: todayUsage,
    currentMonth: monthUsage,
  });
});

/**
 * GET /admin/usage/:tenantId/export
 * Export usage records for billing
 */
router.get('/usage/:tenantId/export', (req: Request, res: Response) => {
  const tenantId = req.params.tenantId || 'unknown';
  const limit = parseInt(req.query.limit as string) || 1000;
  
  const records = exportUsageRecords(tenantId, limit);
  
  res.json({
    tenantId,
    count: records.length,
    records,
  });
});

/**
 * POST /admin/tenants
 * Create/update tenant configuration
 * 
 * Note: In production, this would write to a database.
 * This implementation just validates the input and logs it.
 */
interface CreateTenantRequest {
  name: string;
  namespace?: string;
  tier?: string;
  contactEmail?: string;
}

router.post('/tenants', (req: Request, res: Response) => {
  const body = req.body as CreateTenantRequest;
  
  if (!body.name) {
    return res.status(400).json({
      error: 'name is required',
    });
  }
  
  // Generate API key
  const apiKey = `sk_rag_${body.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now().toString(36)}`;
  const namespace = body.namespace || body.name.toLowerCase().replace(/\s+/g, '-');
  
  logger.info('Tenant configuration generated', {
    name: body.name,
    namespace,
    tier: body.tier || 'free',
  });
  
  // Return the configuration to add to environment
  res.json({
    success: true,
    tenant: {
      name: body.name,
      namespace,
      apiKey,
      tier: body.tier || 'free',
    },
    envConfig: {
      variable: `RAG_TENANT_${body.name.toUpperCase().replace(/\s+/g, '_')}`,
      value: `${body.name}:${namespace}:${apiKey}`,
      example: `RAG_TENANT_${body.name.toUpperCase().replace(/\s+/g, '_')}="${body.name}:${namespace}:${apiKey}"`,
    },
    instructions: [
      '1. Add the environment variable to your deployment',
      '2. Restart the service to load the new tenant',
      '3. Share the API key with the tenant (keep it secure!)',
    ],
  });
});

/**
 * GET /admin/config
 * Get current service configuration (sanitized)
 */
router.get('/config', (req: Request, res: Response) => {
  res.json({
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
    cacheEnabled: !!process.env.REDIS_URL || true,
    cacheTtl: parseInt(process.env.CACHE_TTL_SECONDS || '300'),
    maxContextLength: parseInt(process.env.MAX_CONTEXT_LENGTH || '8000'),
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    pineconeIndex: process.env.PINECONE_INDEX_NAME || '(not set)',
    features: {
      metricsEnabled: true,
      rateLimitingEnabled: true,
      usageTrackingEnabled: true,
    },
  });
});

export { router as adminRouter };

