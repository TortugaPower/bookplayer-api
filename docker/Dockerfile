# =====================================================
# BookPlayer API Dockerfile
# Multi-stage build for optimized production image
# Supports ARM64 (Synology DS923+, DS1522+) and
# AMD64 (Synology DS920+, DS720+) architectures
# =====================================================

# Base image: Node 24 LTS on Alpine, pinned by digest (this is 24.21.0). A digest cannot move, so two builds of the
# same commit produce the same image; bump it deliberately — the multi-arch index digest from
# `docker buildx imagetools inspect node:24-alpine` — and update the version here. Nothing bumps it automatically
# (Dependabot was deferred), so re-pin with each Node 24 security release (roughly monthly) and whenever Alpine ships
# an OpenSSL fix; the node major itself lives in .nvmrc, which the workflows read.
# Stage 1: Dependencies
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS deps
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including dev for building)
RUN yarn install --frozen-lockfile

# Stage 2: Builder
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build TypeScript to JavaScript
RUN yarn build

# Stage 3: Production dependencies only
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS prod-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Stage 4: Production runtime
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS production
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

# Download Apple root certificates for Retention Messaging API verification
RUN mkdir -p ./certs && \
    curl -fsSL https://www.apple.com/certificateauthority/AppleRootCA-G3.cer -o ./certs/AppleRootCA-G3.cer

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
