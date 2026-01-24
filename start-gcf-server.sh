#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GCF_PORT="24875"
export GIT_CREDENTIAL_FORWARDER_PORT="${1:-$DEFAULT_GCF_PORT}"
export GIT_CREDENTIAL_FORWARDER_DEBUG="true"
GCF_GIT_PATH="$(command -v git)"
if command -v cygpath >/dev/null 2>&1; then
  GCF_GIT_PATH="$(cygpath -w "$GCF_GIT_PATH")"
fi
export GIT_CREDENTIAL_FORWARDER_GIT_PATH="$GCF_GIT_PATH"

echo "Installing git-credential-forwarder globally..."
npm install -g git-credential-forwarder

echo "Starting gcf-server..."
exec gcf-server
