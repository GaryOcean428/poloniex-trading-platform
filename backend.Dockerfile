# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Enable corepack for Yarn
RUN corepack enable

# Copy package files
COPY package.json yarn.lock .yarnrc.yml ./

# Install dependencies with caching and platform-specific handling
RUN --mount=type=cache,target=/root/.yarn \
    YARN_ENABLE_GLOBAL_CACHE=true \
    yarn install --immutable --inline-builds

# Copy application code
COPY server ./server

# Production stage
FROM node:20-alpine

WORKDIR /usr/src/app

# Enable corepack for production
RUN corepack enable

# Copy from builder
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/yarn.lock ./
COPY --from=builder /usr/src/app/.yarnrc.yml ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/server ./server

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Expose the port the app runs on
EXPOSE 3000

# Start command
CMD ["node", "server/index.js"]