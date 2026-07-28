#!/bin/bash
set -uo pipefail

# Load environment variables if .env exists
if [ -f /opt/watch-together/.env ]; then
  set -a
  source /opt/watch-together/.env
  set +a
fi

DOMAIN="${DOMAIN:-kino.barasek.net}"
TOKEN="${REALITY_TOKEN:-your_reality_token_here}"
DEST="127.0.0.1:8443"
LOG="/var/log/reality-selfsteal.log"
PATCH_JS="/opt/watch-together/patch-reality.js"

log() { echo "$(date -Is) $*" | tee -a "$LOG"; }

is_patched() {
  docker exec remnanode sh -c "ps w 2>/dev/null | grep -v grep | grep rw-core | grep -q rw-patched-config"
}

apply() {
  # copy patch script and run inside container
  docker cp "$PATCH_JS" remnanode:/tmp/patch-reality.js
  if ! docker exec -e TOKEN="$TOKEN" -e DOMAIN="$DOMAIN" -e DEST="$DEST" remnanode node /tmp/patch-reality.js; then
    log "patch script failed"
    return 1
  fi
  # stop current rw-core
  docker exec remnanode sh -c 'pkill -f /usr/local/bin/rw-core || true'
  sleep 1
  # start patched
  docker exec -d remnanode sh -c 'nohup /usr/local/bin/rw-core -config /tmp/rw-patched-config.json -format json >>/tmp/rw-core.log 2>&1 &'
  sleep 2
  if ss -tlnp | grep -q ':443'; then
    log "443 listening"
    return 0
  fi
  log "443 not up; last log:"; docker exec remnanode tail -5 /tmp/rw-core.log 2>/dev/null || true
  return 1
}

log "watcher start"
# ensure stock node is up first
if ! docker ps --format '{{.Names}}' | grep -qx remnanode; then
  log "starting remnanode"
  cd /opt/remnanode && docker compose up -d
  sleep 5
fi

while true; do
  if ! docker ps --format '{{.Names}}' | grep -qx remnanode; then
    log "remnanode missing — docker compose up"
    (cd /opt/remnanode && docker compose up -d) || true
    sleep 8
    continue
  fi

  if is_patched && ss -tlnp | grep -q ':443'; then
    sleep 30
    continue
  fi

  log "need patch/restart"
  if apply; then
    log "selfsteal OK"
  else
    log "apply failed — restore stock remnanode"
    (cd /opt/remnanode && docker compose restart) || true
    sleep 8
  fi
  sleep 12
done
