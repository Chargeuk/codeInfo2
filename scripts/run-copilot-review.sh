#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd)"
launcher="$repository_root/server/dist/copilot/reviewLauncherCli.js"

if [[ ! -f "$launcher" ]]; then
  printf 'Copilot review launcher is not built: %s\n' "$launcher" >&2
  exit 2
fi

exec node "$launcher" "$@"
