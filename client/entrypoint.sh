#!/bin/sh
set -e

CONFIG_PATH="/app/client/dist/config.js"

escape_js_string() {
  printf "%s" "$1" | sed "s/'/\\\\'/g"
}

write_config() {
  API_BASE_URL_VALUE="${API_BASE_URL:-}"
  API_PORT_VALUE="${API_PORT:-${VITE_API_PORT:-}}"
  LEGACY_API_URL_VALUE="${VITE_API_URL:-}"

  if [ -n "$API_BASE_URL_VALUE" ]; then
    SAFE_URL="$(escape_js_string "$API_BASE_URL_VALUE")"
    printf "window.__CODEINFO_CONFIG__ = { apiBaseUrl: '%s' };\n" "$SAFE_URL" > "$CONFIG_PATH"
    return
  fi

  if [ -n "$API_PORT_VALUE" ]; then
    SAFE_PORT="$(escape_js_string "$API_PORT_VALUE")"
    printf "window.__CODEINFO_CONFIG__ = { apiPort: '%s' };\n" "$SAFE_PORT" > "$CONFIG_PATH"
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

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec npm run preview -- --host --port "${PORT:-5001}"
