/**
 * API Key Authentication Middleware
 * 
 * For SaaS multi-tenancy:
 * - Validates API keys
 * - Extracts tenant/namespace from the key
 * - Attaches tenant info to request for downstream use
 * 
 * In production, API keys would be stored in a database.
 * This implementation uses environment variables for simplicity.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Extend Express Request to include tenant info
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        name: string;
        namespace: string; // Pinecone namespace for this tenant
      };
    }
  }
}

interface TenantConfig {
  id: string;
  name: string;
  namespace: string;
  apiKey: string;
}

/**
 * Load tenant configurations from environment
 * Format: RAG_TENANT_<ID>=name:namespace:apiKey
 * 
 * Example:
 * RAG_TENANT_EASYFLOW=EasyFlow:easyflow-prod:sk_rag_easyflow_xxx
 * RAG_TENANT_DEMO=Demo:demo:sk_rag_demo_xxx
 */
function loadTenantConfigs(): Map<string, TenantConfig> {
  const tenants = new Map<string, TenantConfig>();
  
  // Add default/demo tenant if configured via environment
  // Never use hardcoded keys - always require explicit configuration
  const demoKey = process.env.RAG_DEMO_API_KEY;
  if (demoKey) {
    tenants.set(demoKey, {
      id: 'demo',
      name: 'Demo',
      namespace: '', // Empty namespace = default
      apiKey: demoKey,
    });
  }
  
  // Load from environment
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('RAG_TENANT_') && value) {
      const tenantId = key.replace('RAG_TENANT_', '').toLowerCase();
      const [name, namespace, apiKey] = value.split(':');
      
      if (name && apiKey) {
        tenants.set(apiKey, {
          id: tenantId,
          name,
          namespace: namespace || tenantId,
          apiKey,
        });
      }
    }
  }
  
  // Also support a single master key for easy setup
  const masterKey = process.env.RAG_API_KEY;
  if (masterKey) {
    tenants.set(masterKey, {
      id: 'master',
      name: 'Master',
      namespace: process.env.RAG_DEFAULT_NAMESPACE || '',
      apiKey: masterKey,
    });
  }
  
  logger.info('Loaded tenant configurations', {
    tenantCount: tenants.size,
    tenantIds: Array.from(tenants.values()).map(t => t.id),
  });
  
  return tenants;
}

// Load tenants at startup
const tenantConfigs = loadTenantConfigs();

/**
 * API Key Authentication Middleware
 * 
 * Looks for API key in:
 * 1. Authorization header: Bearer sk_rag_xxx
 * 2. X-API-Key header: sk_rag_xxx
 * 3. Query param: ?apiKey=sk_rag_xxx
 */
export function apiKeyAuth(options: { required?: boolean } = {}) {
  const { required = true } = options;
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract API key from various sources
    let apiKey: string | undefined;
    
    // 1. Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }
    
    // 2. Check X-API-Key header
    if (!apiKey) {
      apiKey = req.headers['x-api-key'] as string;
    }
    
    // 3. Check query param (for webhooks/simple integrations)
    if (!apiKey) {
      apiKey = req.query.apiKey as string;
    }
    
    // Allow demo access if auth not required
    if (!apiKey && !required) {
      req.tenant = {
        id: 'demo',
        name: 'Demo',
        namespace: '',
      };
      return next();
    }
    
    // Require API key
    if (!apiKey) {
      logger.warn('Missing API key', {
        requestId: req.requestId,
        path: req.path,
      });
      
      return res.status(401).json({
        error: 'API key required',
        message: 'Please provide an API key via Authorization header (Bearer token), X-API-Key header, or apiKey query parameter',
      });
    }
    
    // Validate API key
    const tenant = tenantConfigs.get(apiKey);
    
    if (!tenant) {
      logger.warn('Invalid API key', {
        requestId: req.requestId,
        path: req.path,
        keyPrefix: apiKey.substring(0, 10) + '...',
      });
      
      return res.status(403).json({
        error: 'Invalid API key',
        message: 'The provided API key is not valid',
      });
    }
    
    // Attach tenant to request
    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      namespace: tenant.namespace,
    };
    
    logger.debug('API key authenticated', {
      requestId: req.requestId,
      tenantId: tenant.id,
      tenantName: tenant.name,
    });
    
    next();
  };
}

/**
 * Get namespace for current tenant (for Pinecone queries)
 */
export function getTenantNamespace(req: Request): string {
  return req.tenant?.namespace || '';
}

export default apiKeyAuth;

