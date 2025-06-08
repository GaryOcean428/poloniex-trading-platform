# Use an official Node.js runtime as a parent image
FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Install dependencies
COPY package.json yarn.lock ./
RUN corepack enable yarn
# Cache buster: Tue Nov 07 10:00:00 UTC 2023
RUN yarn install --frozen-lockfile

# Copy only the server code
COPY server ./server

# Expose the port the app runs on.
# Railway will automatically set the PORT environment variable.
EXPOSE 3000

# Define the command to run the app
# This will start the server defined in server/index.js
CMD ["node", "server/index.js"]
