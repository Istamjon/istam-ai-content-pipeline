#!/usr/bin/env bash
# VDS network + Telegram remediation. Run from app root on the server.
set -euo pipefail

echo "=== VDS remediate $(date -Is 2>/dev/null || date) ==="
echo "PWD=$(pwd)"

upsert() {
  key="$1"; val="$2"
  if [ -z "$val" ]; then return 0; fi
  if [ ! -f .env ]; then
    printf '%s=%s\n' "$key" "$val" > .env
    return 0
  fi
  if grep -q "^${key}=" .env; then
    # portable-ish in-place replace
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^${key}=.*|${key}=${val}|" .env
    else
      sed -i '' "s|^${key}=.*|${key}=${val}|" .env
    fi
  else
    printf '\n%s=%s\n' "$key" "$val" >> .env
  fi
}

echo "=== DNS / reachability ==="
getent ahosts api.telegram.org 2>/dev/null | head -10 || true
getent ahostsv4 api.telegram.org 2>/dev/null | head -5 || true

echo "=== curl -4 api.telegram.org (host) ==="
if command -v curl >/dev/null 2>&1; then
  curl -4 -sS -o /dev/null -w "http=%{http_code} time=%{time_total}\n" \
    --connect-timeout 12 --max-time 20 https://api.telegram.org/ || \
    echo "curl -4 FAILED rc=$?"
  curl -6 -sS -o /dev/null -w "ipv6 http=%{http_code}\n" \
    --connect-timeout 5 --max-time 8 https://api.telegram.org/ 2>/dev/null || \
    echo "curl -6 failed/unavailable (often OK)"
else
  echo "curl not installed on host"
fi

echo "=== Prefer IPv4 in .env + compose ==="
upsert NODE_OPTIONS "--dns-result-order=ipv4first"
# Ensure telegram bot stays on unless explicitly off
if ! grep -q '^TELEGRAM_BOT_INBOUND=' .env 2>/dev/null; then
  upsert TELEGRAM_BOT_INBOUND true
fi

echo "=== docker compose rebuild/restart ==="
docker compose build --pull || docker compose build
# Safe cache clean (do not wipe latest image)
set +e
docker image prune -f 2>/dev/null || true
docker builder prune -f --filter 'until=48h' 2>/dev/null || docker builder prune -f 2>/dev/null || true
docker container prune -f 2>/dev/null || true
set -e
docker compose up -d --force-recreate
sleep 6
docker compose ps -a || true

echo "=== telegram getMe from container ==="
# Extract token without printing it
TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")
if [ -n "${TOKEN:-}" ]; then
  docker compose exec -T pipeline sh -c \
    "node --dns-result-order=ipv4first -e \"
      fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getMe', { signal: AbortSignal.timeout(20000) })
        .then(r => r.json())
        .then(j => console.log('getMe ok=' + j.ok + ' username=' + (j.result && j.result.username)))
        .catch(e => { console.error('getMe FAIL:', e.message); process.exitCode = 1; });
    \"" 2>&1 || {
    # Fallback: pass token via env one-shot (no print)
    docker compose run --rm --no-deps -e TELEGRAM_BOT_TOKEN="$TOKEN" pipeline \
      node --dns-result-order=ipv4first -e "
        fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getMe', { signal: AbortSignal.timeout(20000) })
          .then(r => r.json())
          .then(j => console.log('getMe ok=' + j.ok + ' username=' + (j.result && j.result.username)))
          .catch(e => { console.error('getMe FAIL:', e.message); process.exitCode = 1; });
      " 2>&1 || echo "getMe still failing — host firewall may block Telegram"
  }
else
  echo "WARN: TELEGRAM_BOT_TOKEN missing in .env"
fi

echo "=== recent non-spam logs ==="
docker compose logs --tail=80 2>&1 | grep -vE 'poll error' | tail -40 || \
  docker compose logs --tail=30 2>&1 || true

echo "=== schedule ==="
cat data/daily-schedule.json 2>/dev/null || echo "no schedule"
echo "=== REMEDIATE DONE ==="
