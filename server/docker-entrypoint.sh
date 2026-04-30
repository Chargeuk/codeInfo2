#!/usr/bin/env sh
set -e

# Ensure temp dir exists when HOME/TMPDIR is set to a non-standard path (e.g. via compose).
if [ -n "${HOME:-}" ]; then
  mkdir -p "$HOME/tmp"
fi

# Refresh CA store at startup to pick up mounted corporate certs.
if command -v update-ca-certificates >/dev/null 2>&1; then
  if find /usr/local/share/ca-certificates -type f -name "*.crt" -print -quit >/dev/null 2>&1; then
    if ! update-ca-certificates; then
      echo "update-ca-certificates failed; continuing startup." >&2
    fi
  fi
fi

exec "$@"
