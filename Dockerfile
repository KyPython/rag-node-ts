# ============================================================================
# RAG-as-a-Service Production Dockerfile
# 
# Multi-stage build for optimized production image
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# ============================================================================
# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Create uploads directory with proper permissions
RUN mkdir -p uploads && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]

# ============================================================================
# Environment variable documentation
# ============================================================================
# Required:
#   OPENAI_API_KEY      - OpenAI API key for embeddings and LLM
#   PINECONE_API_KEY    - Pinecone API key
#   PINECONE_INDEX_NAME - Your Pinecone index name
#
# Optional:
#   PORT                - Server port (default: 3000)
#   OPENAI_MODEL        - LLM model (default: gpt-4o-mini)
#   RAG_API_KEY         - Master API key for authentication
#   RAG_ADMIN_KEY       - Admin API key for management endpoints
#   RAG_TENANT_*        - Tenant configurations (format: name:namespace:apiKey)
#   REDIS_URL           - Redis URL for distributed caching
#   CACHE_TTL_SECONDS   - Cache TTL (default: 300)
#   NODE_ENV            - Environment (development/production)
# ============================================================================
