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
# Full install for TypeScript build (devDependencies)
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production node_modules only (dotenv must stay — imported by dist/index.js)
RUN rm -rf node_modules \
  && npm ci --omit=dev \
  && test -d node_modules/dotenv \
  && node --input-type=module -e "import 'dotenv/config'; console.log('dotenv-ok')"

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    DATA_DIR=/app/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 app \
  && useradd --uid 10001 --gid app --shell /bin/sh --create-home app

COPY --from=build --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN mkdir -p /app/data \
  && chown -R app:app /app/data \
  && chmod +x /app/docker-entrypoint.sh

# Start as root so entrypoint can chown host-mounted ./data, then drop to app.
# (Without this, SQLite / image writes fail with EACCES on many VDS deploys.)
USER root

VOLUME ["/app/data"]

# OAuth callback is a separate local process — this image only runs the cron pipeline.
ENTRYPOINT ["tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
