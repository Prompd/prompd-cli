# Prompd Workflow Engine - Enterprise Docker Container
FROM node:18-alpine

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache \
    tini \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S prompd && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G prompd -g prompd prompd

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force && \
    chown -R prompd:prompd node_modules

# Copy application code
COPY --chown=prompd:prompd . .

# Build TypeScript
RUN npm run build

# Create directories for workflows and temp files with proper permissions
RUN mkdir -p /app/workflows /app/temp /app/logs && \
    chown -R prompd:prompd /app/workflows /app/temp /app/logs && \
    chmod 750 /app/workflows /app/temp /app/logs

# Remove development dependencies and build artifacts
RUN rm -rf src tsconfig.json *.ts && \
    npm prune --production

# Security hardening
RUN chmod -R go-w /app && \
    find /app -type f -executable -exec chmod go-w {} \;

# Switch to non-root user
USER prompd

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node", "dist/server.js"]

# Expose port (configurable via environment)
EXPOSE 3000

# Labels for metadata
LABEL maintainer="Prompd Team" \
      version="0.2.3" \
      description="Enterprise LLM Workflow Execution Engine" \
      security.scan="true" \
      org.opencontainers.image.source="https://github.com/Logikbug/prompd-cli" \
      org.opencontainers.image.documentation="https://docs.prompd.com" \
      org.opencontainers.image.licenses="MIT"

# Environment variables with secure defaults
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info \
    WORKFLOW_TIMEOUT=300000 \
    MAX_CONCURRENT_WORKFLOWS=10 \
    RATE_LIMIT_REQUESTS=100 \
    RATE_LIMIT_WINDOW=60000 \
    JWT_EXPIRES_IN=24h \
    SESSION_MAX_AGE=86400000 \
    BCRYPT_ROUNDS=12 \
    TEMP_DIR=/app/temp \
    WORKFLOWS_DIR=/app/workflows \
    LOGS_DIR=/app/logs