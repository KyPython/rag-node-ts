FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
# Use npm install if package-lock.json doesn't exist, otherwise use npm ci for faster, reliable builds
# --legacy-peer-deps is needed to handle peer dependency conflicts (e.g., dotenv version mismatch)
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
# --legacy-peer-deps is needed to handle peer dependency conflicts
RUN if [ -f package-lock.json ]; then npm ci --only=production --legacy-peer-deps; else npm install --only=production --legacy-peer-deps; fi

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]

