#!/usr/bin/env sh
set -eu

runtime_uid="${CODEINFO_RUNTIME_UID:-1000}"
runtime_gid="${CODEINFO_RUNTIME_GID:-1000}"
export HOME="${HOME:-/home/node}"
export NODE_EXTRA_CA_CERTS="${CODEINFO_NODE_EXTRA_CA_CERTS:-/etc/ssl/certs/ca-certificates.crt}"
export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

for runtime_id in "$runtime_uid" "$runtime_gid"; do
  case "$runtime_id" in
    '' | *[!0-9]*)
      echo "CODEINFO Playwright startup failed: runtime UID/GID must be numeric" >&2
      exit 1
      ;;
  esac
done

refresh_flag="$(printf '%s' "${CODEINFO_REFRESH_CA_CERTS_ON_START:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')"
if [ "$refresh_flag" = true ]; then
  if [ "$(id -u)" != 0 ]; then
    echo "CODEINFO Playwright refresh failed: system CA import requires root at startup" >&2
    exit 1
  fi
  cert_dir=/usr/local/share/ca-certificates/codeinfo-corp
  crt_found=false
  for cert_file in "$cert_dir"/*.crt; do
    [ -f "$cert_file" ] || continue
    if [ ! -r "$cert_file" ]; then
      echo "CODEINFO Playwright refresh failed: unreadable certificate ${cert_file}" >&2
      exit 1
    fi
    crt_found=true
  done
  if [ "$crt_found" != true ]; then
    echo "CODEINFO Playwright refresh failed: no .crt files in ${cert_dir}" >&2
    exit 1
  fi
  update-ca-certificates
  sh /app/browser/import-browser-certificates.sh "$cert_dir" "$HOME" "$runtime_uid" "$runtime_gid"
fi

if [ "$(id -u)" = 0 ]; then
  mkdir -p "$HOME"
  chown "$runtime_uid:$runtime_gid" "$HOME"
  exec setpriv --reuid "$runtime_uid" --regid "$runtime_gid" --clear-groups node /app/cli.js "$@"
fi
exec node /app/cli.js "$@"
