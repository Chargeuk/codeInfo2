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

corp_certs_mount_source="${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}"
npm_registry_set=false
pip_index_set=false
pip_trusted_host_set=false

if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then
  npm_registry_set=true
fi
if [ -n "${CODEINFO_PIP_INDEX_URL:-}" ]; then
  pip_index_set=true
fi
if [ -n "${CODEINFO_PIP_TRUSTED_HOST:-}" ]; then
  pip_trusted_host_set=true
fi

echo "[CODEINFO][T01_COMPOSE_WIRING_APPLIED] corp_certs_mount_source=${corp_certs_mount_source} npm_registry_set=${npm_registry_set} pip_index_set=${pip_index_set} pip_trusted_host_set=${pip_trusted_host_set}"
echo "[CODEINFO][T02_ENV_SOURCE_RESOLVED] workflow=${CODEINFO_COMPOSE_WORKFLOW:-compose} interpolation_source=${CODEINFO_INTERPOLATION_SOURCE:-server/.env+server/.env.local} runtime_env_file=${CODEINFO_RUNTIME_ENV_FILE_SOURCE:-unchanged}"

exec node dist/index.js
