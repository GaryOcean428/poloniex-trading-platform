# Use an official Node.js runtime as a parent image
FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Enable corepack for Yarn 4.9.2
RUN corepack enable

# Copy root workspace files first for proper workspace resolution
COPY package.json yarn.lock .yarnrc.yml ./

# Copy workspace package.json files
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# Install all workspace dependencies
RUN yarn install --immutable

# Copy frontend source code
COPY frontend/ ./frontend/

# Copy any shared dependencies if they exist
COPY shared/ ./shared/ 2>/dev/null || true

# Build the frontend application
RUN yarn workspace poloniex-frontend build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs
    
# Change ownership of app directory
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose the port the app runs on
EXPOSE 5173

# Define the command to run the app
CMD ["yarn", "workspace", "poloniex-frontend", "start"]