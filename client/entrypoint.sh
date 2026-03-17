#!/bin/sh
set -e

CONFIG_PATH="/app/client/dist/config.js"

escape_js_string() {
  printf "%s" "$1" | sed "s/'/\\\\'/g"
}

write_config() {
  API_BASE_URL_VALUE="${VITE_CODEINFO_API_URL:-${SERVER_API_URL:-${API_BASE_URL:-}}}"
  LM_STUDIO_URL_VALUE="${VITE_CODEINFO_LMSTUDIO_URL:-}"
  LOG_FORWARD_ENABLED_VALUE="${VITE_CODEINFO_LOG_FORWARD_ENABLED:-}"
  LOG_MAX_BYTES_VALUE="${VITE_CODEINFO_LOG_MAX_BYTES:-}"

  printf "window.__CODEINFO_CONFIG__ = {\n" > "$CONFIG_PATH"

  if [ -n "$API_BASE_URL_VALUE" ]; then
    SAFE_API_URL="$(escape_js_string "$API_BASE_URL_VALUE")"
    printf "  apiBaseUrl: '%s',\n" "$SAFE_API_URL" >> "$CONFIG_PATH"
  fi

  if [ -n "$LM_STUDIO_URL_VALUE" ]; then
    SAFE_LM_URL="$(escape_js_string "$LM_STUDIO_URL_VALUE")"
    printf "  lmStudioBaseUrl: '%s',\n" "$SAFE_LM_URL" >> "$CONFIG_PATH"
  fi

  case "$(printf "%s" "$LOG_FORWARD_ENABLED_VALUE" | tr '[:upper:]' '[:lower:]')" in
    true|false)
      printf "  logForwardEnabled: %s,\n" "$(printf "%s" "$LOG_FORWARD_ENABLED_VALUE" | tr '[:upper:]' '[:lower:]')" >> "$CONFIG_PATH"
      ;;
  esac

  case "$LOG_MAX_BYTES_VALUE" in
    ''|*[!0-9]*)
      ;;
    *)
      printf "  logMaxBytes: %s,\n" "$LOG_MAX_BYTES_VALUE" >> "$CONFIG_PATH"
      ;;
  esac

  printf "};\n" >> "$CONFIG_PATH"
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
