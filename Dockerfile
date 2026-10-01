# syntax=docker/dockerfile:1

# OrbitHub API.
#
# Railway builds this from the repository root, which is the whole monorepo, and
# the API is the only thing that needs to come out of it. The mobile app is never
# copied in: it is Expo and a browser bundle, and nothing in here renders a screen.
#
# The contract and config packages are workspace dependencies that `build.mjs`
# inlines into the bundle, so the runtime image does not have them. What it does
# have is `apps/api/drizzle`, because the server applies the migrations itself on
# boot (see src/index.ts) and a fresh database is useless without them.

# ------------------------------------------------------------------- build --

FROM node:22-slim AS build

WORKDIR /repo
ENV npm_config_update_notifier=false

# The manifests alone, so this layer is only rebuilt when a dependency changes and
# not every time a source file does.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json

# Only the three workspaces the API needs. `apps/mobile` is left out on purpose:
# installing it would pull Expo, Metro and the whole React Native tree into a
# server image that never opens a screen.
RUN npm ci --workspace @orbit-hub/contracts --workspace @orbit-hub/config --workspace @orbit-hub/api

COPY packages/contracts/ packages/contracts/
COPY packages/config/ packages/config/
COPY apps/api/ apps/api/

# Contracts and config first: esbuild reads their `dist`, not their source, so
# building the API against stale packages compiles happily and ships a bundle that
# disagrees with the mobile app at runtime.
RUN npm run build:packages \
 && npm run build --workspace @orbit-hub/api

# ----------------------------------------------------------------- runtime --

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    npm_config_update_notifier=false

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json

# The same three workspaces, production dependencies only. npm links the two local
# packages here; nothing imports them at runtime because esbuild already inlined
# them, so the links are only there to keep `npm ci` honest about the versions.
RUN npm ci --omit=dev --workspace @orbit-hub/contracts --workspace @orbit-hub/config --workspace @orbit-hub/api \
 && npm cache clean --force

COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle

# Railway injects PORT and expects the process to listen on it; src/index.ts reads
# it from the environment and HOST already defaults to 0.0.0.0.
EXPOSE 4000

# The storage driver writes under STORAGE_LOCAL_DIR, which defaults to a relative
# path, and the directory has to exist and belong to the user that will run the
# server. Every line above wrote as root, so without this the app starts, serves
# the health check, and then fails on the first attachment with EACCES — which is
# a long way from the thing that is actually wrong.
RUN mkdir -p /app/.data/attachments && chown -R node:node /app/.data

# Not root: nothing in this server needs the privilege, and the app writes files.
USER node

CMD ["node", "dist/server.js"]