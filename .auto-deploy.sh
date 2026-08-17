#!/bin/bash
# MMM OS — Auto-deploy watcher
# Triggered by launchd when ~/mmm-static/public/index.html (or anything in public/) changes.
# Safety:
#   - Skips deploy if ~/mmm-static/.pause-deploy exists
#   - Skips if file MD5 hasn't actually changed since last deploy
#   - Debounces (waits 3s, re-checks MD5) to avoid mid-write deploys
#   - Lock file prevents overlapping runs
# Logs to: ~/MMM/MMM_SYSTEM_MEMORY/logs/auto-deploy.log

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

PROJECT_DIR="$HOME/mmm-static"
TARGET_FILE="$PROJECT_DIR/public/index.html"
PAUSE_FLAG="$PROJECT_DIR/.pause-deploy"
LAST_MD5_FILE="$PROJECT_DIR/.last-deploy-md5"
LOG_DIR="$HOME/MMM/MMM_SYSTEM_MEMORY/logs"
LOG_FILE="$LOG_DIR/auto-deploy.log"
LOCK_FILE="/tmp/com.mmm.auto-deploy.lock"

mkdir -p "$LOG_DIR"

ts()  { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*" >> "$LOG_FILE"; }

md5_of() {
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | awk '{print $1}'
  else /sbin/md5 -q "$1" 2>/dev/null || md5 -q "$1"; fi
}

# Prevent overlapping runs
exec 9>"$LOCK_FILE" 2>/dev/null
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { log "skip: another deploy already running"; exit 0; }
fi

# Pause flag — manual stop switch
if [ -f "$PAUSE_FLAG" ]; then
  REASON=$(cat "$PAUSE_FLAG" 2>/dev/null || true)
  log "skip: pause flag set ($PAUSE_FLAG) reason=${REASON:-none}"
  exit 0
fi

# Target file must exist
if [ ! -f "$TARGET_FILE" ]; then
  log "skip: target not found ($TARGET_FILE)"
  exit 0
fi

# Debounce — wait 3s, re-MD5 to ensure write completed
CURR_MD5=$(md5_of "$TARGET_FILE")
sleep 3
CURR_MD5_2=$(md5_of "$TARGET_FILE")
if [ "$CURR_MD5" != "$CURR_MD5_2" ]; then
  log "skip: file still being written (md5 changed during debounce: $CURR_MD5 -> $CURR_MD5_2)"
  exit 0
fi

# No-op: same MD5 as last deploy
LAST_MD5=""
[ -f "$LAST_MD5_FILE" ] && LAST_MD5=$(cat "$LAST_MD5_FILE" 2>/dev/null || true)
if [ "$CURR_MD5" = "$LAST_MD5" ] && [ -n "$LAST_MD5" ]; then
  log "skip: no content change (md5=$CURR_MD5)"
  exit 0
fi

log "start: deploying md5=$CURR_MD5 (previous=${LAST_MD5:-none})"

cd "$PROJECT_DIR" || { log "fail: cd $PROJECT_DIR failed"; exit 1; }

DEPLOY_OUT=$(npx --yes vercel --prod --force 2>&1)
DEPLOY_RC=$?

if [ $DEPLOY_RC -eq 0 ]; then
  DEPLOY_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)
  echo "$CURR_MD5" > "$LAST_MD5_FILE"
  log "ok:   deploy succeeded md5=$CURR_MD5 url=${DEPLOY_URL:-unknown}"
else
  log "fail: deploy failed rc=$DEPLOY_RC md5=$CURR_MD5"
  echo "$DEPLOY_OUT" | tail -10 | while IFS= read -r line; do log "       | $line"; done
fi
