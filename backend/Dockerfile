# Multi-stage build: compile TypeScript, then ship only the production
# runtime - no dev dependencies, no source, no build toolchain.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The Git Repository Service shells out to the real `git` binary
# (via simple-git) - not present in the base alpine image by default.
RUN apk add --no-cache git

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 4000
CMD ["node", "--env-file-if-exists=.env", "dist/server.js"]
