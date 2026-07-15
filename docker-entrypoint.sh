#!/bin/sh
# Ensure data volume is writable by app user (uid 10001) when started as root.
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR/tokens" "$DATA_DIR/images" "$DATA_DIR/canonical"

if [ "$(id -u)" = "0" ]; then
  # Host-mounted ./data is often root-owned after scp/git — fix for app user
  chown -R 10001:10001 "$DATA_DIR" 2>/dev/null || true
  chmod -R u+rwX "$DATA_DIR" 2>/dev/null || true
  # Drop privileges (util-linux setpriv is on Debian slim)
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=10001 --regid=10001 --init-groups -- "$@"
  fi
  if command -v runuser >/dev/null 2>&1; then
    exec runuser -u app -- "$@"
  fi
  exec su app -s /bin/sh -c 'exec "$@"' -- "$@"
fi

exec "$@"