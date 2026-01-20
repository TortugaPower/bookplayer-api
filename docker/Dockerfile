# =====================================================
# BookPlayer API Dockerfile
# Multi-stage build for optimized production image
# Supports ARM64 (Synology DS923+, DS1522+) and
# AMD64 (Synology DS920+, DS720+) architectures
# =====================================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including dev for building)
RUN yarn install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build TypeScript to JavaScript
RUN yarn build

# Stage 3: Production dependencies only
FROM node:20-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Stage 4: Production runtime
FROM node:20-alpine AS production
WORKDIR /app

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S bookplayer -u 1001

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    tini

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Note: Migrations are not copied - database should already be set up
# If you need to run migrations, do it separately before deploying

# Set ownership
RUN chown -R bookplayer:nodejs /app

# Switch to non-root user
USER bookplayer

# Environment defaults
ENV NODE_ENV=production
ENV API_PORT=5003
ENV API_HOST=0.0.0.0

# Expose API port
EXPOSE 5003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${API_PORT}/v1/status || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/main.js"]
