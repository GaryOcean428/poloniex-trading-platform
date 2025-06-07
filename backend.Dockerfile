# Use an official Node.js runtime as a parent image

FROM node:20-alpine AS base
WORKDIR /usr/src/app

# Install dependencies
# Copy only package.json and yarn.lock to leverage Docker cache
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on.
# Railway will automatically set the PORT environment variable.
EXPOSE 3000

# Define the command to run the app
# This will start the server defined in server/index.js
CMD ["node", "server/index.js"]
