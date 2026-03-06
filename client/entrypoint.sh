#!/bin/sh
set -e

CONFIG_PATH="/app/client/dist/config.js"

escape_js_string() {
  printf "%s" "$1" | sed "s/'/\\\\'/g"
}

write_config() {
  API_BASE_URL_VALUE="${SERVER_API_URL:-${API_BASE_URL:-}}"
  LEGACY_API_URL_VALUE="${VITE_API_URL:-}"

  if [ -n "$API_BASE_URL_VALUE" ]; then
    SAFE_URL="$(escape_js_string "$API_BASE_URL_VALUE")"
    printf "window.__CODEINFO_CONFIG__ = { apiBaseUrl: '%s' };\n" "$SAFE_URL" > "$CONFIG_PATH"
    return
  fi

  if [ -n "$LEGACY_API_URL_VALUE" ]; then
    SAFE_URL="$(escape_js_string "$LEGACY_API_URL_VALUE")"
    printf "window.__CODEINFO_CONFIG__ = { apiBaseUrl: '%s' };\n" "$SAFE_URL" > "$CONFIG_PATH"
    return
  fi

  printf "window.__CODEINFO_CONFIG__ = window.__CODEINFO_CONFIG__ || {};\n" > "$CONFIG_PATH"
}

if [ -d "/app/client/dist" ]; then
  write_config
fi

build_override_state_file="/app/client/.codeinfo-client-build-override-state.env"
if [ -r "$build_override_state_file" ]; then
  file_state="$(sed -n 's/^CODEINFO_CLIENT_BUILD_OVERRIDE_STATE=//p' "$build_override_state_file" | head -n 1)"
  if [ -n "$file_state" ]; then
    CODEINFO_CLIENT_BUILD_OVERRIDE_STATE="$file_state"
    export CODEINFO_CLIENT_BUILD_OVERRIDE_STATE
  fi
fi

client_npm_registry_override="off"
case "${CODEINFO_CLIENT_BUILD_OVERRIDE_STATE:-}" in
  client_npm=on) client_npm_registry_override="on" ;;
  client_npm=off) client_npm_registry_override="off" ;;
  *) client_npm_registry_override="off" ;;
esac

echo "[CODEINFO][T04_CLIENT_BUILD_OVERRIDE_STATE] client_npm_registry_override=${client_npm_registry_override}"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec npm run preview -- --host --port "${PORT:-5001}"
