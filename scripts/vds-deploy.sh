#!/usr/bin/env bash
# VDS production deploy — run from app root after git reset --hard origin/main
set -euo pipefail

echo "=== Deploy dir: $(pwd) ==="
echo "=== git ==="
git remote -v || true
git fetch origin main
git checkout main
git reset --hard origin/main
echo "HEAD=$(git rev-parse --short HEAD)"
git log -1 --oneline
echo "--- Dockerfile tail ---"
tail -n 20 Dockerfile || true
echo "--- package.json dotenv ---"
grep -n dotenv package.json || true

echo "=== .env present? ==="
if [ ! -f .env ]; then
  echo "WARN: .env missing — creating from .env.example (fill secrets later)"
  cp -n .env.example .env || cp .env.example .env
fi
ls -la .env data 2>/dev/null || true
mkdir -p data/tokens data/images data/brand
# container runs as uid 10001
chown -R 10001:10001 data 2>/dev/null || true

echo "=== docker diagnostics ==="
docker version --format '{{.Server.Version}}' 2>&1 || docker version 2>&1 || true
docker compose version 2>&1 || true
df -h . /var/lib/docker 2>/dev/null | head -20 || df -h | head -10 || true

echo "=== docker compose build (keep old container until new image ready) ==="
# Do NOT prune builder cache on every deploy — aggressive prune + failed rebuild
# leaves the host with no image and a stopped pipeline.
build_ok=0
set +e
if [ "${BUILD_NO_CACHE:-0}" = "1" ]; then
  docker compose build --no-cache --pull
  rc=$?
else
  docker compose build --pull
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "WARN: build --pull failed (rc=$rc), retry without --pull"
    docker compose build
    rc=$?
  fi
fi
set -e
if [ "$rc" -eq 0 ]; then
  build_ok=1
fi

if [ "$build_ok" != "1" ]; then
  echo "WARN: build failed — recovery prune + rebuild once"
  set +e
  docker builder prune -af
  docker image prune -f
  sleep 2
  docker compose build --pull
  rc=$?
  if [ "$rc" -ne 0 ]; then
    docker compose build
    rc=$?
  fi
  set -e
  if [ "$rc" -eq 0 ]; then
    build_ok=1
  fi
fi

if [ "$build_ok" != "1" ]; then
  echo "WARN: rebuild still failed — try existing image if present"
  if ! docker image inspect istam-ai-content-pipeline:latest >/dev/null 2>&1; then
    echo "ERROR: No image and build failed"
    exit 1
  fi
  echo "Using existing image istam-ai-content-pipeline:latest"
fi

echo "=== safe docker cache cleanup (keep running/latest image) ==="
# Never `docker system prune -af` here — it can delete the image we just built
# if tagging races, and wipes volume-adjacent build cache mid-deploy.
set +e
# Dangling intermediate layers only (untagged)
docker image prune -f 2>/dev/null || true
# Builder cache older than 48h (keeps recent rebuilds fast)
if docker builder prune -f --filter 'until=48h' 2>/dev/null; then
  :
else
  docker builder prune -f 2>/dev/null || true
fi
# Stopped containers / unused networks (not volumes — data/ is a bind mount)
docker container prune -f 2>/dev/null || true
docker network prune -f 2>/dev/null || true
# Old unused images except our production tag
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null | \
  grep -E 'istam-ai|none' | grep -v 'istam-ai-content-pipeline:latest' | \
  awk '{print $2}' | sort -u | while read -r id; do
    [ -n "$id" ] && docker rmi -f "$id" 2>/dev/null || true
  done
df -h /var/lib/docker 2>/dev/null | head -5 || df -h / | head -3 || true
set -e

echo "=== docker compose up ==="
# Stop old only when new image is ready (or fallback image exists)
set +e
docker compose down --remove-orphans
docker rm -f istam-ai-pipeline 2>/dev/null
set -e
docker compose up -d --force-recreate --remove-orphans
sleep 3

STATUS=$(docker inspect -f '{{.State.Status}}' istam-ai-pipeline 2>/dev/null || echo missing)
if [ "$STATUS" != "running" ]; then
  echo "retry up after network race (status=$STATUS)"
  set +e
  docker network prune -f
  docker compose down --remove-orphans
  sleep 2
  set -e
  docker compose up -d --force-recreate
fi

echo "=== wait 15s for crash loops ==="
sleep 15

echo "=== ps ==="
docker compose ps -a || true

STATUS=$(docker inspect -f '{{.State.Status}}' istam-ai-pipeline 2>/dev/null || echo missing)
EXIT=$(docker inspect -f '{{.State.ExitCode}}' istam-ai-pipeline 2>/dev/null || echo na)
RESTART=$(docker inspect -f '{{.RestartCount}}' istam-ai-pipeline 2>/dev/null || echo na)
echo "status=$STATUS exit=$EXIT restarts=$RESTART"

echo "=== logs (last 100) ==="
docker compose logs --tail=100 || true

if [ "$STATUS" != "running" ]; then
  echo "ERROR: Container not running after deploy (status=$STATUS)"
  exit 1
fi
if [ "$RESTART" != "0" ] && [ "$RESTART" != "na" ]; then
  if [ "${RESTART:-0}" -gt 0 ] 2>/dev/null; then
    echo "ERROR: Container restarted ${RESTART} times — still crashing"
    exit 1
  fi
fi

# Ensure daily policy keys exist — only fill MISSING keys (never clobber operator limits)
set_env_if_missing() {
  key="$1"; val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$val" >> .env
}
# Align slots (3–6) with per-platform caps (>= max slots so random plan is not wasted)
set_env_if_missing CRON_RANDOM true
set_env_if_missing CRON_SLOTS_MIN 3
set_env_if_missing CRON_SLOTS_MAX 6
set_env_if_missing CRON_SLOTS_PER_DAY 4
set_env_if_missing CRON_WINDOW_START_HOUR 8
set_env_if_missing CRON_WINDOW_END_HOUR 21
set_env_if_missing CRON_MIN_GAP_MINUTES 150
set_env_if_missing CRON_RUN_ON_START false
set_env_if_missing DAILY_LIMIT_TELEGRAM 6
set_env_if_missing DAILY_LIMIT_LINKEDIN 6
set_env_if_missing DAILY_LIMIT_FACEBOOK 6
set_env_if_missing DAILY_LIMIT_INSTAGRAM 6
set_env_if_missing DAILY_LIMIT_THREADS 6
set_env_if_missing DAILY_LIMIT_X 6
set_env_if_missing DAILY_LIMIT_BLOGGER 6
set_env_if_missing THREADS_MAX_PARTS 6
set_env_if_missing DRY_RUN false
set_env_if_missing TZ Asia/Tashkent

# Raise platform caps that are below CRON_SLOTS_MAX (common bug: limit=4 + slots=3–6)
SLOTS_MAX=$(grep -E '^CRON_SLOTS_MAX=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
SLOTS_MAX=${SLOTS_MAX:-6}
align_daily_limit() {
  key="$1"
  cur=$(grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
  if [ -z "$cur" ]; then
    printf '\n%s=%s\n' "$key" "$SLOTS_MAX" >> .env
    return 0
  fi
  case "$cur" in
    ''|*[!0-9]*) return 0 ;;
  esac
  if [ "$cur" -lt "$SLOTS_MAX" ] 2>/dev/null; then
    echo "Align $key: $cur → $SLOTS_MAX (>= CRON_SLOTS_MAX)"
    sed -i "s|^${key}=.*|${key}=${SLOTS_MAX}|" .env
  fi
}
for _p in TELEGRAM LINKEDIN FACEBOOK INSTAGRAM THREADS X BLOGGER; do
  align_daily_limit "DAILY_LIMIT_${_p}"
done
# Blog id auto-resolved at runtime; pin known brand defaults if missing
if ! grep -q '^BLOGGER_URL=.\+' .env 2>/dev/null; then
  upsert_env BLOGGER_URL 'https://istamjon.blogspot.com/'
fi
if ! grep -q '^BLOGGER_BLOG_ID=.\+' .env 2>/dev/null; then
  # Public feed id for istamjon.blogspot.com (auto-discovery fallback)
  upsert_env BLOGGER_BLOG_ID '6041787032258205448'
fi
# Keep blogger in platforms if google client already configured
if grep -q '^GOOGLE_CLIENT_ID=.\+' .env 2>/dev/null; then
  if grep -q '^ENABLED_PLATFORMS=' .env; then
    if ! grep -q 'blogger' .env; then
      sed -i 's/^ENABLED_PLATFORMS=\(.*\)/ENABLED_PLATFORMS=\1,blogger/' .env
      sed -i 's/,,/,/g; s/,$//' .env
    fi
  fi
fi
mkdir -p data/brand data/tokens data/images
chown -R 10001:10001 data 2>/dev/null || true
# Recreate so env changes apply
docker compose up -d --force-recreate
sleep 8

# live probe: dotenv inside image
echo "=== probe dotenv in image ==="
if ! docker compose exec -T pipeline node --input-type=module -e "import 'dotenv/config'; console.log('dotenv-runtime-ok')"; then
  docker run --rm --entrypoint node istam-ai-content-pipeline:latest --input-type=module -e "import 'dotenv/config'; console.log('dotenv-image-ok')"
fi

echo "=== DEPLOY HEALTHY ==="
echo "HEAD=$(git rev-parse --short HEAD)"
