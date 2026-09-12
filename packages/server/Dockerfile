# Build context is the repo root (see docker-compose.yml), since this needs the
# shared and web workspaces too, not just the server.

FROM node:24-slim AS build
WORKDIR /app

# Overridable so a build on a host with poor/blocked access to the default registry (e.g. some
# mainland China networks and registry.npmjs.org) can point at a faster mirror — set NPM_REGISTRY
# in .env and pass it through docker-compose's build.args. Defaults to npm's own registry, so
# this changes nothing unless explicitly overridden.
ARG NPM_REGISTRY=https://registry.npmjs.org

COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm install --registry="${NPM_REGISTRY}"

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/web/dist packages/web/dist

EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
