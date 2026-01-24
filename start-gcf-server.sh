#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GCF_PORT="24875"
export GIT_CREDENTIAL_FORWARDER_PORT="${1:-$DEFAULT_GCF_PORT}"
export GIT_CREDENTIAL_FORWARDER_DEBUG="true"
GCF_GIT_PATH="$(command -v git)"
if command -v cygpath >/dev/null 2>&1; then
  GCF_GIT_PATH="$(cygpath -w "$GCF_GIT_PATH")"
  if command -v cmd.exe >/dev/null 2>&1; then
    GCF_GIT_PATH_SHORT="$(cmd.exe /c "for %I in (\"$GCF_GIT_PATH\") do @echo %~sI" | tr -d '\r')"
    if [ -n "$GCF_GIT_PATH_SHORT" ]; then
      GCF_GIT_PATH="$GCF_GIT_PATH_SHORT"
    fi
  fi
fi
export GIT_CREDENTIAL_FORWARDER_GIT_PATH="$GCF_GIT_PATH"

echo "Installing git-credential-forwarder globally..."
npm install -g git-credential-forwarder

echo "Starting gcf-server..."
exec gcf-server
