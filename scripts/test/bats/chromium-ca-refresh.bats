#!/usr/bin/env bats

setup() {
  repo_root="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  fixture="$BATS_TEST_TMPDIR/fixture"
  mkdir -p "$fixture/bin" "$fixture/home" "$fixture/certs" "$fixture/server"
  cp "$repo_root/certs/task6-valid/test.crt" "$fixture/certs/root.crt"
  cp "$repo_root/server/import-browser-certificates.sh" "$fixture/server/"
  sed -e "s|/usr/local/share/ca-certificates/codeinfo-corp|$fixture/certs|g" \
      -e "s|/tmp/chrome-devtools.log|$fixture/browser.log|g" \
      "$repo_root/server/entrypoint.sh" > "$fixture/server/entrypoint.sh"
  sed -e "s|/usr/local/share/ca-certificates/codeinfo-corp|$fixture/certs|g" \
      -e "s|/app/browser/import-browser-certificates.sh|$fixture/server/import-browser-certificates.sh|g" \
      "$repo_root/browser/entrypoint.sh" > "$fixture/playwright-entrypoint.sh"
  export PRIV_LOG="$fixture/privileges.log"
  export CALL_LOG="$fixture/calls.log"
  export BROWSER_READY="$fixture/browser-ready"
  : > "$CALL_LOG"
  mkfifo "$BROWSER_READY"
  cat > "$fixture/bin/certutil" <<'SH'
#!/bin/sh
operation="$1"
shift
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-d" ]; then database="${2#sql:}"; shift 2; else shift; fi
done
case "$operation" in
  -N) printf 'nss-init:%s\n' "$database" >> "$CALL_LOG"; touch "$database/cert9.db" ;;
  -A) printf 'nss-import:%s\n' "$database" >> "$CALL_LOG"; [ "${FAIL_NSS_IMPORT:-false}" != true ] ;;
esac
SH
  cat > "$fixture/bin/id" <<'SH'
#!/bin/sh
printf '%s\n' "${FAKE_UID:-0}"
SH
  cat > "$fixture/bin/chown" <<'SH'
#!/bin/sh
exit 0
SH
  cat > "$fixture/bin/update-ca-certificates" <<'SH'
#!/bin/sh
printf 'system-ca\n' >> "$CALL_LOG"
SH
  cat > "$fixture/bin/codeinfo-prepare-rust-homes" <<'SH'
#!/bin/sh
exit 0
SH
  cat > "$fixture/bin/setpriv" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$PRIV_LOG"
while [ "$#" -gt 0 ] && [ "$1" != node ]; do shift; done
exec "$@"
SH
  cat > "$fixture/bin/jq" <<'SH'
#!/bin/sh
cat >/dev/null
printf 'skipped\n'
SH
  cat > "$fixture/bin/node" <<'SH'
#!/bin/sh
case "$1" in
  /app/cli.js)
    printf 'mcp-arg:%s\n' "$@" >> "$CALL_LOG"
    printf 'node-ca:%s\n' "$NODE_EXTRA_CA_CERTS"
    ;;
  /app/browser/start-chromium.mjs)
    printf 'browser\n' >> "$CALL_LOG"
    printf 'ready\n' > "$BROWSER_READY"
    ;;
  dist/config/copilotSeedBootstrap.js) printf '{"status":"skipped"}\n' ;;
  dist/index.js)
    read -r ready < "$BROWSER_READY"
    printf 'server\n' >> "$CALL_LOG"
    ;;
esac
SH
  chmod +x "$fixture/bin/"*
  export PATH="$fixture/bin:$PATH"
  export CODEINFO_CODEX_HOME="$fixture/home"
  export CODEINFO_COPILOT_HOME="$fixture/copilot"
  export CODEINFO_LMSTUDIO_HOME="$fixture/lmstudio"
  export CODEINFO_RUNTIME_UID=1000
  export CODEINFO_RUNTIME_GID=1000
  export CHROME_BIN=/bin/true
  unset CODEINFO_SERVER_BUILD_OVERRIDE_STATE FAIL_NSS_IMPORT FAKE_UID
}

@test "disabled refresh leaves NSS untouched and starts the browser" {
  run env CODEINFO_REFRESH_CA_CERTS_ON_START=false sh "$fixture/server/entrypoint.sh"
  [ "$status" -eq 0 ]
  [ ! -d "$fixture/home/.local/share/pki/nssdb" ]
  [ "$(cat "$CALL_LOG")" = "$(printf 'browser\nserver')" ]
}

@test "enabled refresh imports system and browser trust before Chromium starts" {
  run env CODEINFO_REFRESH_CA_CERTS_ON_START=' TRUE ' sh "$fixture/server/entrypoint.sh"
  [ "$status" -eq 0 ]
  [ -f "$fixture/home/.local/share/pki/nssdb/cert9.db" ]
  [ "$(sed -n '1p' "$CALL_LOG")" = system-ca ]
  [ "$(sed -n '2p' "$CALL_LOG")" = "nss-init:$fixture/home/.local/share/pki/nssdb" ]
  [ "$(sed -n '3p' "$CALL_LOG")" = "nss-import:$fixture/home/.local/share/pki/nssdb" ]
  [ "$(sed -n '4p' "$CALL_LOG")" = browser ]
  [ "$(sed -n '5p' "$CALL_LOG")" = server ]
}

@test "repeated imports reuse the NSS database and preserve unrelated files" {
  run sh "$fixture/server/import-browser-certificates.sh" "$fixture/certs" "$fixture/home" 1000 1000
  [ "$status" -eq 0 ]
  printf 'keep\n' > "$fixture/home/.local/share/pki/nssdb/unrelated"
  run sh "$fixture/server/import-browser-certificates.sh" "$fixture/certs" "$fixture/home" 1000 1000
  [ "$status" -eq 0 ]
  [ "$(grep -c '^nss-init:' "$CALL_LOG")" -eq 1 ]
  [ "$(grep -c '^nss-import:' "$CALL_LOG")" -eq 2 ]
  [ "$(cat "$fixture/home/.local/share/pki/nssdb/unrelated")" = keep ]
}

@test "an existing legacy NSS database is reused" {
  mkdir -p "$fixture/home/.pki/nssdb"
  touch "$fixture/home/.pki/nssdb/cert9.db"
  run sh "$fixture/server/import-browser-certificates.sh" "$fixture/certs" "$fixture/home" 1000 1000
  [ "$status" -eq 0 ]
  [ "$(cat "$CALL_LOG")" = "nss-import:$fixture/home/.pki/nssdb" ]
  [ ! -d "$fixture/home/.local/share/pki/nssdb" ]
}

@test "a failed NSS import prevents browser and server startup" {
  run env CODEINFO_REFRESH_CA_CERTS_ON_START=true FAIL_NSS_IMPORT=true sh "$fixture/server/entrypoint.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Chromium certificate import failed"* ]]
  ! grep -q '^browser$\|^server$' "$CALL_LOG"
}


@test "Playwright imports trust before MCP and drops to the configured runtime user" {
  run env HOME="$fixture/home" CODEINFO_REFRESH_CA_CERTS_ON_START=true CODEINFO_RUNTIME_UID=1234 CODEINFO_RUNTIME_GID=2345 sh "$fixture/playwright-entrypoint.sh" --port 8931 --allowed-hosts 'example.test other.test'
  [ "$status" -eq 0 ]
  [ "$(sed -n '1p' "$CALL_LOG")" = system-ca ]
  [ "$(sed -n '2p' "$CALL_LOG")" = "nss-init:$fixture/home/.local/share/pki/nssdb" ]
  [ "$(sed -n '3p' "$CALL_LOG")" = "nss-import:$fixture/home/.local/share/pki/nssdb" ]
  [ "$(sed -n '4p' "$CALL_LOG")" = mcp-arg:/app/cli.js ]
  grep -q 'mcp-arg:example.test other.test' "$CALL_LOG"
  grep -q -- '--reuid 1234 --regid 2345 --clear-groups node /app/cli.js' "$PRIV_LOG"
  [[ "$output" == *node-ca:/etc/ssl/certs/ca-certificates.crt* ]]
}

@test "Playwright skips imports when disabled and retains the Node CA override" {
  run env HOME="$fixture/home" CODEINFO_REFRESH_CA_CERTS_ON_START=false CODEINFO_NODE_EXTRA_CA_CERTS=/custom/bundle.pem sh "$fixture/playwright-entrypoint.sh" --port 8931
  [ "$status" -eq 0 ]
  [ ! -d "$fixture/home/.local/share/pki/nssdb" ]
  ! grep -q '^system-ca$\|^nss-' "$CALL_LOG"
  [[ "$output" == *node-ca:/custom/bundle.pem* ]]
}

@test "Playwright rejects enabled system refresh without startup root privileges" {
  run env HOME="$fixture/home" CODEINFO_REFRESH_CA_CERTS_ON_START=true FAKE_UID=1000 sh "$fixture/playwright-entrypoint.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"requires root at startup"* ]]
  [ ! -s "$CALL_LOG" ]
}

@test "Playwright does not launch MCP when the browser trust import fails" {
  run env HOME="$fixture/home" CODEINFO_REFRESH_CA_CERTS_ON_START=true FAIL_NSS_IMPORT=true sh "$fixture/playwright-entrypoint.sh"
  [ "$status" -ne 0 ]
  ! grep -q '^mcp-arg:' "$CALL_LOG"
}

@test "Playwright rejects malformed runtime identities before starting MCP" {
  run env HOME="$fixture/home" CODEINFO_REFRESH_CA_CERTS_ON_START=false CODEINFO_RUNTIME_UID=10:00 sh "$fixture/playwright-entrypoint.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UID/GID must be numeric"* ]]
  [ ! -s "$CALL_LOG" ]
}
