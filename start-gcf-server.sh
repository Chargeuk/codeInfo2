#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GCF_PORT="24875"
export GIT_CREDENTIAL_FORWARDER_PORT="${1:-$DEFAULT_GCF_PORT}"
export GIT_CREDENTIAL_FORWARDER_DEBUG="true"
GCF_GIT_PATH="$(command -v git)"
if command -v cygpath >/dev/null 2>&1; then
  if GCF_GIT_PATH_MIXED="$(cygpath -m -s "$GCF_GIT_PATH" 2>/dev/null)"; then
    GCF_GIT_PATH="$GCF_GIT_PATH_MIXED"
  elif GCF_GIT_PATH_MIXED="$(cygpath -m "$GCF_GIT_PATH" 2>/dev/null)"; then
    GCF_GIT_PATH="$GCF_GIT_PATH_MIXED"
  fi
fi
export GIT_CREDENTIAL_FORWARDER_GIT_PATH="$GCF_GIT_PATH"

echo "Installing git-credential-forwarder globally..."
npm install -g git-credential-forwarder

echo "Starting gcf-server..."
exec gcf-server
