# Disney Infinity Community Server - Production Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache \
    postgresql-client \
    curl \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S infinity -u 1001

# Create necessary directories
RUN mkdir -p /tmp/uploads && \
    chown -R infinity:nodejs /tmp/uploads && \
    chown -R infinity:nodejs /app

# Switch to non-root user
USER infinity

# Expose port
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:10000/api/v1/health || exit 1

# Start the application
CMD ["npm", "start"]
