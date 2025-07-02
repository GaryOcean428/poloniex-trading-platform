# Use an official Node.js runtime as a parent image
FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Install dependencies
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable yarn
RUN yarn install --immutable

# Copy only the server code
COPY server ./server

# Expose the port the app runs on.
# Railway will automatically set the PORT environment variable.
EXPOSE 3000

# Define the command to run the app
# This will start the server defined in server/index.js
CMD ["node", "server/index.js"]