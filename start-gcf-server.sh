#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GCF_PORT="24875"
export GIT_CREDENTIAL_FORWARDER_PORT="${1:-$DEFAULT_GCF_PORT}"
export GIT_CREDENTIAL_FORWARDER_DEBUG="true"

echo "Installing git-credential-forwarder globally..."
npm install -g git-credential-forwarder

echo "Starting gcf-server..."
exec gcf-server
