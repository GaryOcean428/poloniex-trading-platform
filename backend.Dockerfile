# Use an official Node.js runtime as a parent image
FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Install dependencies
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable yarn && \
    yarn install --immutable && \
    yarn cache clean

# Copy only the server code
COPY server ./server

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs
    
# Change ownership of app directory
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose the port the app runs on.
# Railway will automatically set the PORT environment variable.
EXPOSE 3000

# Define the command to run the app
# This will start the server defined in server/index.js
CMD ["node", "server/index.js"]