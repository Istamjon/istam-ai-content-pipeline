# Istam AI content pipeline — production scheduler image
# Build:  docker compose build
# Run:    docker compose up -d

FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 native compile
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    npm_config_update_notifier=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 app \
  && useradd --uid 10001 --gid app --shell /usr/sbin/nologin --create-home app

COPY --from=build --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

RUN mkdir -p /app/data \
  && chown -R app:app /app/data

USER app

VOLUME ["/app/data"]

# OAuth callback is a separate local process — this image only runs the cron pipeline.
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
