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

build_override_state_file="/app/server/.codeinfo-server-build-override-state.env"
if [ -z "${CODEINFO_SERVER_BUILD_OVERRIDE_STATE:-}" ] && [ -r "$build_override_state_file" ]; then
  file_state="$(sed -n 's/^CODEINFO_SERVER_BUILD_OVERRIDE_STATE=//p' "$build_override_state_file" | head -n 1)"
  if [ -n "$file_state" ]; then
    CODEINFO_SERVER_BUILD_OVERRIDE_STATE="$file_state"
    export CODEINFO_SERVER_BUILD_OVERRIDE_STATE
  fi
fi

build_override_state="${CODEINFO_SERVER_BUILD_OVERRIDE_STATE:-}"
npm_registry_override="off"
pip_index_override="off"
pip_trusted_host_override="off"

if [ -n "$build_override_state" ]; then
  state_npm_segment="${build_override_state#npm=}"
  state_after_npm="${state_npm_segment#*;}"
  state_pip_index_segment="${state_after_npm#pip_index=}"
  state_after_pip_index="${state_pip_index_segment#*;}"
  state_pip_trusted_host_segment="${state_after_pip_index#pip_trusted_host=}"

  if [ "$state_npm_segment" != "$build_override_state" ] && \
    [ "$state_after_npm" != "$state_npm_segment" ] && \
    [ "$state_pip_index_segment" != "$state_after_npm" ] && \
    [ "$state_after_pip_index" != "$state_pip_index_segment" ] && \
    [ "$state_pip_trusted_host_segment" != "$state_after_pip_index" ]; then
    candidate_npm="${state_npm_segment%%;*}"
    candidate_pip_index="${state_pip_index_segment%%;*}"
    candidate_pip_trusted_host="$state_pip_trusted_host_segment"

    case "$candidate_npm" in
      on | off) ;;
      *) candidate_npm="" ;;
    esac
    case "$candidate_pip_index" in
      on | off) ;;
      *) candidate_pip_index="" ;;
    esac
    case "$candidate_pip_trusted_host" in
      on | off) ;;
      *) candidate_pip_trusted_host="" ;;
    esac

    if [ -n "$candidate_npm" ] && [ -n "$candidate_pip_index" ] && [ -n "$candidate_pip_trusted_host" ]; then
      npm_registry_override="$candidate_npm"
      pip_index_override="$candidate_pip_index"
      pip_trusted_host_override="$candidate_pip_trusted_host"
    fi
  fi
fi

echo "[CODEINFO][T03_SERVER_BUILD_OVERRIDE_STATE] npm_registry_override=${npm_registry_override} pip_index_override=${pip_index_override} pip_trusted_host_override=${pip_trusted_host_override}"

refresh_flag_raw="${CODEINFO_REFRESH_CA_CERTS_ON_START:-}"
refresh_flag_trimmed="$(printf '%s' "$refresh_flag_raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
refresh_flag_normalized="$(printf '%s' "$refresh_flag_trimmed" | tr '[:upper:]' '[:lower:]')"
refresh_requested=false
if [ "$refresh_flag_normalized" = "true" ]; then
  refresh_requested=true
fi

node_extra_ca_certs_value="${CODEINFO_NODE_EXTRA_CA_CERTS:-}"
node_extra_ca_certs_source="override"
if [ -z "$node_extra_ca_certs_value" ]; then
  node_extra_ca_certs_value="/etc/ssl/certs/ca-certificates.crt"
  node_extra_ca_certs_source="default"
fi
export NODE_EXTRA_CA_CERTS="$node_extra_ca_certs_value"

echo "[CODEINFO][T05_NODE_EXTRA_CA_CERTS_RESOLVED] value=${NODE_EXTRA_CA_CERTS} source=${node_extra_ca_certs_source} refresh_requested=${refresh_requested}"

exec node dist/index.js
