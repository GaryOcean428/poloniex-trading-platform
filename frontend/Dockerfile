# Use an official Node.js runtime as a parent image
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Enable corepack for Yarn 4.9.2
RUN corepack enable && corepack prepare yarn@4.9.2 --activate

# Copy root workspace files
COPY package.json yarn.lock .yarnrc.yml ./

# Copy frontend files
COPY frontend/package.json ./frontend/

# Install dependencies
RUN yarn workspaces focus --all --production

# Copy the rest of the frontend code
COPY frontend/ ./frontend/

# Copy shared code if it exists
COPY shared/ ./shared/ 2>/dev/null || true

# Build-time environment variables for Railway deployment
ARG VITE_BACKEND_URL
ARG VITE_WS_URL
ARG VITE_RAILWAY_PUBLIC_DOMAIN
ARG VITE_RAILWAY_PRIVATE_DOMAIN

# Set environment variables during build
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_RAILWAY_PUBLIC_DOMAIN=$VITE_RAILWAY_PUBLIC_DOMAIN
ENV VITE_RAILWAY_PRIVATE_DOMAIN=$VITE_RAILWAY_PRIVATE_DOMAIN

# Build the frontend application
RUN cd frontend && yarn build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Set proper permissions
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the app
WORKDIR /app/frontend
CMD ["yarn", "start"]