FROM node:20-alpine AS builder

WORKDIR /core

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source files
COPY src ./src

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine AS production

WORKDIR /core

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --only=production && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /core/build ./build

# Install netcat for wait-for-services script
RUN apk add --no-cache netcat-openbsd

# Copy wait-for-services script
COPY scripts/wait-for-services.sh /wait-for-services.sh
RUN chmod +x /wait-for-services.sh

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /core

USER nodejs

EXPOSE 8000

# Health check (simple TCP check since /health requires authentication)
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "const net=require('net');const c=net.createConnection(8000,'localhost');c.on('connect',()=>{c.end();process.exit(0)});c.on('error',()=>process.exit(1))"

# Start the application
CMD ["/wait-for-services.sh", "node", "./build/index.mjs"]
