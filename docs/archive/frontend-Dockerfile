# syntax=docker/dockerfile:1

# Multi-stage Dockerfile for frontend build and runtime
# IMPORTANT: Build context should be the repository root so that `shared/` is available.

########## Builder ##########
FROM node:20-alpine AS builder

WORKDIR /app

# Enable Yarn 4.x via Corepack
RUN corepack enable && corepack prepare yarn@4.9.2 --activate

# Copy root workspace files
COPY package.json yarn.lock .yarnrc.yml ./

# Copy workspace manifests to allow deterministic install
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
# shared is a TS source folder (no package.json); sources are copied later during build

# Install full dependencies (dev + prod) for build
RUN yarn install --immutable

# Copy source
COPY frontend ./frontend
COPY shared ./shared

# Build the frontend
WORKDIR /app/frontend
ENV NODE_ENV=production
RUN yarn build

########## Runtime ##########
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs

ENV NODE_ENV=production
# Default PORT; Railway will inject its own and our server reads $PORT
ENV PORT=5675

# Copy built assets and static server
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/serve.js ./serve.js

USER nodejs

# Expose the app port (aligned with .clinerules)
EXPOSE 5675

# Start static server
CMD ["node", "serve.js"]
