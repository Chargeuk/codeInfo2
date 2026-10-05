#!/bin/sh
# Shared by image setup, entrypoint UID overrides and isolated runtime proof.
set -eu
runtime_uid="${CODEINFO_RUNTIME_UID:-1000}"
runtime_gid="${CODEINFO_RUNTIME_GID:-1000}"
for value in "$runtime_uid" "$runtime_gid"; do
  case "$value" in
    '' | *[!0-9]*) echo 'Rust home UID/GID must be numeric' >&2; exit 1 ;;
  esac
done
for rust_home in "$CARGO_HOME" "$RUSTUP_HOME"; do
  [ -d "$rust_home" ] || { echo "Missing Rust home: $rust_home" >&2; exit 1; }
  if [ "$(id -u)" = 0 ]; then
    if [ "$(stat -c '%u:%g' "$rust_home")" != "$runtime_uid:$runtime_gid" ]; then
      chown -R "$runtime_uid:$runtime_gid" "$rust_home"
    fi
  elif [ ! -w "$rust_home" ]; then
    echo "Rust home is not writable: $rust_home; start as root for UID preparation" >&2
    exit 1
  fi
done
