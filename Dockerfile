# syntax=docker/dockerfile:1

# 1. Use a valid LTS version (22 is current)
ARG NODE_VERSION=22.12.0
FROM node:${NODE_VERSION}-alpine

# Use production environment
ENV NODE_ENV production

WORKDIR /usr/src/app

# 2. Install dependencies
# We copy package files first to leverage Docker layer caching
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# 3. Copy the source code 
# DO THIS BEFORE SWITCHING USERS to ensure permissions are correct
COPY . .

# 4. Fix permissions for the 'node' user
RUN chown -R node:node /usr/src/app

# 5. Switch to non-root user for security
USER node

# 6. Cloud Run usually expects port 8080, but 3000 is fine if configured
EXPOSE 3000

CMD ["npm", "start"]