ARG NODE_VERSION=22.12.0
FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV production

WORKDIR /usr/src/app

# Install system dependencies (FFmpeg and build tools)
# 'musl' and 'libstdc++' are often needed for Essentia/FFmpeg on Alpine
# Add this to your Dockerfile to ensure Essentia.js runs on Alpine
RUN apk add --no-cache \
    ffmpeg \
    libstdc++ \
    gcompat \
    musl

# Copy package files
COPY package.json package-lock.json ./

# Install node dependencies
RUN npm ci --omit=dev

# Copy the rest of your source code
COPY . .

# Ensure the 'node' user owns the files
RUN chown -R node:node /usr/src/app

USER node

EXPOSE 3000

CMD ["npm", "start"]