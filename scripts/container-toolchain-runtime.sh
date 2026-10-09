#!/bin/sh
# Only for standalone disposable proof containers; never boots Compose services.
set -eu

if [ "$(id -u)" = 0 ]; then
  codeinfo-prepare-rust-homes
  chown -R "$CODEINFO_RUNTIME_UID:$CODEINFO_RUNTIME_GID" /proof /app/codex /work/rapier
  exec setpriv --reuid "$CODEINFO_RUNTIME_UID" --regid "$CODEINFO_RUNTIME_GID" \
    --clear-groups sh "$0" "$@"
fi
[ "$(id -u)" = "$CODEINFO_RUNTIME_UID" ]
codeinfo-prepare-rust-homes
export HOME=/app/codex
export PATH=/opt/cargo/bin:/opt/wasm-tools/bin:/opt/binaryen/bin:/usr/local/bin:/usr/bin:/bin
mkdir -p /proof/artifacts
[ -w "$CARGO_HOME" ] && [ -w "$RUSTUP_HOME" ] && [ -w "$HOME" ]
python3 - <<'PY'
import importlib.metadata as m, pathlib, json, platform
versions = {}
for line in pathlib.Path('/tmp/requirements-constraints.txt').read_text().splitlines():
    if line and not line.startswith('#'):
        name, version = line.split('==')
        assert m.version(name) == version, (name, m.version(name), version)
        versions[name] = m.version(name)
assert m.version('pip') == '26.2.1'
print(json.dumps({'python': platform.python_version(), 'pip': m.version('pip'), 'pythonPackages': versions}))
PY
python3 -m pip check
node - <<'JS'
const fs = require('fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
assert.equal(process.version, 'v22.21.1');
const globals = {};
for (const line of fs.readFileSync('/tmp/npm-global.txt', 'utf8').trim().split('\n')) {
  const index = line.lastIndexOf('@');
  const name = line.slice(0, index);
  const version = line.slice(index + 1);
  assert.equal(require(`/usr/local/lib/node_modules/${name}/package.json`).version, version, name);
  globals[name] = version;
}
const tools = {};
for (const command of ['rustup', 'rustc', 'cargo', 'rustfmt', 'wasm-pack', 'wasm-bindgen', 'wasm-opt', 'npm']) {
  tools[command] = execFileSync(command, ['--version'], {encoding: 'utf8'}).trim();
}
tools.clippy = execFileSync('cargo', ['clippy', '--version'], {encoding: 'utf8'}).trim();
console.log(JSON.stringify({node: process.version, playwright: require('/opt/playwright/node_modules/playwright/package.json').version, tools, globals}));
JS
rustup --version | grep -F 'rustup 1.29.1 '
rustc --version | grep -F 'rustc 1.99.0 '
cargo --version | grep -F 'cargo 1.99.0 '
rustfmt --version
cargo clippy --version
rustup target list --installed | grep -x wasm32-unknown-unknown
wasm-pack --version | grep -x 'wasm-pack 0.15.0'
wasm-bindgen --version | grep -x 'wasm-bindgen 0.2.129'
wasm-opt --version | grep -F 'version 133'
printf 'fn main() { println!("native smoke passed"); }\n' > /proof/artifacts/native.rs
rustc /proof/artifacts/native.rs -o /proof/artifacts/native
/proof/artifacts/native
printf '#[unsafe(no_mangle)] pub extern "C" fn smoke() -> u32 { 42 }\n' > /proof/artifacts/wasm.rs
rustc --crate-type cdylib --target wasm32-unknown-unknown /proof/artifacts/wasm.rs -o /proof/artifacts/smoke.wasm
node - <<'JS'
const assert = require('node:assert/strict');
const {chromium} = require('/opt/playwright/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<title>fresh image smoke</title>');
    assert.equal(await page.title(), 'fresh image smoke');
    console.log(JSON.stringify({chromium: browser.version(), uid: process.getuid(), home: process.env.HOME}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS

# The second UID-only run omits the expensive Rapier compile, but still exercises
# versions, writable homes, native/WASM compilation and a real browser launch.
if [ "${1:-}" = uid-only ]; then exit 0; fi
cd /work/rapier
export CARGO_TARGET_DIR=/proof/artifacts/native-target
cargo build -p rapier3d --lib
cd bindings/typescript
export CARGO_TARGET_DIR=/proof/artifacts/bindings-target
npm ci --ignore-scripts --no-audit --no-fund
cargo run -p prepare_builds -- -d dim3 -f non-deterministic
cd rapier-compat
npm ci --ignore-scripts --no-audit --no-fund
WASM_PACK_MODE=no-install sh ./build-rust.sh -d 3 -f non-deterministic
python3 - <<'PY'
import json, toml
resolved = [p['version'] for p in toml.load('../Cargo.lock')['package'] if p['name'] == 'wasm-bindgen']
assert resolved == ['0.2.129'], resolved
print(json.dumps({'bindingCargoWasmBindgen': resolved[0]}))
PY
RAPIER_COMPAT_VARIANT=3d sh ./gen_src.sh
RAPIER_COMPAT_VARIANT=3d ./node_modules/.bin/rollup --config rollup.config.js --bundleConfigAsCjs
RAPIER_COMPAT_VARIANT=3d bash ./fix_raw_file.sh
node /proof/package-smoke.mjs "$PWD/builds/3d/pkg"
cd builds/3d/pkg
npm pack --dry-run --json > /proof/artifacts/rapier-pack.json
cp /proof/artifacts/native-target/debug/librapier3d.rlib /proof/artifacts/rapier-native.rlib
cp /proof/artifacts/bindings-target/wasm32-unknown-unknown/release/rapier_wasm3d.wasm /proof/artifacts/rapier_wasm3d.wasm
