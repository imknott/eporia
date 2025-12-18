ARG NODE_VERSION=22.12.0
FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV production

WORKDIR /usr/src/app

# Copy package files separately to leverage caching
COPY package.json package-lock.json ./

# Standard install command (works without BuildKit)
RUN npm ci --omit=dev

# Copy the rest of your source code
COPY . .

# Ensure the 'node' user owns the files
RUN chown -R node:node /usr/src/app

USER node

EXPOSE 3000

CMD ["npm", "start"]