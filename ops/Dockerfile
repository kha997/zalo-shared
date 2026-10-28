# syntax=docker/dockerfile:1
# Builder and runtime are pinned to immutable, CI-verified digests.
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY client ./client
COPY server ./server
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM ${RUNTIME_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/package.json /app/package-lock.json ./
USER 65532:65532
EXPOSE 3100
CMD ["dist/server/main.js"]
