#!/usr/bin/env sh
set -e

CHROME_BIN="${CHROME_BIN:-/usr/bin/chromium}"
CHROME_REMOTE_DEBUG_PORT="${CHROME_REMOTE_DEBUG_PORT:-9222}"
CHROME_REMOTE_DEBUG_ADDRESS="${CHROME_REMOTE_DEBUG_ADDRESS:-0.0.0.0}"
CHROME_USER_DATA_DIR="${CHROME_USER_DATA_DIR:-/tmp/chrome-profile}"
CHROME_HEADLESS="${CHROME_HEADLESS:-true}"

if [ -x "$CHROME_BIN" ]; then
  CHROME_FLAGS="--remote-debugging-port=${CHROME_REMOTE_DEBUG_PORT}"
  CHROME_FLAGS="$CHROME_FLAGS --remote-debugging-address=${CHROME_REMOTE_DEBUG_ADDRESS}"
  CHROME_FLAGS="$CHROME_FLAGS --user-data-dir=${CHROME_USER_DATA_DIR}"
  CHROME_FLAGS="$CHROME_FLAGS --no-first-run --no-default-browser-check"
  CHROME_FLAGS="$CHROME_FLAGS --disable-dev-shm-usage --no-sandbox"
  if [ "$CHROME_HEADLESS" = "true" ]; then
    CHROME_FLAGS="$CHROME_FLAGS --headless=new --disable-gpu"
  fi
  "$CHROME_BIN" $CHROME_FLAGS >/tmp/chrome-devtools.log 2>&1 &
else
  echo "Chrome binary not found at $CHROME_BIN" >&2
fi

exec node dist/index.js
