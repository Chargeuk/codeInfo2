#!/usr/bin/env bash
set -euo pipefail

# gcf-server helper
#
# Purpose:
#   Starts git-credential-forwarder (gcf-server) on the host so Docker containers
#   can fetch Git HTTPS credentials without prompting. This is intended for
#   local development when the container needs access to private repos.
#
# Usage:
#   ./start-gcf-server.sh            # uses default port 24875
#   ./start-gcf-server.sh 30000      # optional custom port
#
# WSL notes:
#   - Works best with WSL2 "mirrored" networking so containers can reach WSL via
#     host.docker.internal. If mirrored networking is disabled, you may need
#     to run gcf-server on Windows or set up port forwarding.
#
# macOS notes:
#   - Docker Desktop exposes host.docker.internal by default, so containers can
#     reach this server at host.docker.internal:PORT.

DEFAULT_GCF_PORT="24875"
export GIT_CREDENTIAL_FORWARDER_PORT="${1:-$DEFAULT_GCF_PORT}"
export GIT_CREDENTIAL_FORWARDER_DEBUG="true"

GCF_GIT_PATH="$(command -v git)"
if command -v cygpath >/dev/null 2>&1; then
  # Prefer short mixed paths (8.3) for Windows compatibility; fall back to full mixed path.
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
