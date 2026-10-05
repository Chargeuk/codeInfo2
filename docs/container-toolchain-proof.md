# Container pins and proof

This story changes image construction and focused proof support only. Parent
accepted completed tester reports without opening successful logs. Native ARM64
image/cache/runtime/Rapier proof passed; formal suite execution completed with
two pre-existing server test mismatches. User authorized committing and pushing this reviewed candidate.

## Completed proof and limits (2026-10-05)

- Native ARM64/aarch64 host: Node 22.21.1, npm 10.9.4.
  `npm run compose:build:summary` passed 2/2; the container-toolchain summary passed.
  Source-only rebuilds kept server npm/browser/Rust and client npm steps `CACHED`,
  while app compilation was `DONE` after disposable source edits.
- Fresh runtimes UID 1000/12345 with mounted empty HOME passed actual native and
  WASM compilation and Chromium page launch. UID 1000 also passed copied Rapier
  full 3D baseline build, `@dimforge/rapier3d-compat@0.21.0`, CJS/ESM initialization
  and World step/free, and npm pack dry-run. Original Rapier remained unchanged.
- Main `npm run compose:up` passed, with HTTP 200 at server `5010/health` and
  client `5001/`. Normal runtime UID/GID 1000 has writable Cargo/Rustup homes.
  Actual runtime: Node 22.21.1, npm 10.9.4, Rust/Cargo 1.99.0, wasm-pack 0.15.0,
  wasm-bindgen 0.2.129, wasm-opt 133, Playwright 1.56.1, Chromium 141.0.7390.37.
  Healthy main stack was left running; protected local stack was untouched.
- Lint, `format:check`, explicit Prettier coverage of new files, `sh -n` on four
  scripts and shell tests 37/37 passed after the import-order fix. Exactly one
  `npm run test:summary:all:parallel`: client 919 passed, cucumber 138 passed,
  E2E 80 passed; server unit 3038 total, 3033 passed, 2 failed, 3 skipped.
- AMD64 execution was not attempted. Focused contracts passed AMD64/ARM64
  source/checksum selection coverage; this is not dual-architecture runtime proof.

The full suite is **not green**. Two unchanged baseline test/source mismatches
remain: `capabilityResolver.test.ts` selects default first `gpt-6.1-sol` and expects
minimal/turbo despite the existing low/medium/high/xhigh restriction;
`chatValidators.test.ts` supplies an unlisted SDK model, falls back to the first
restricted model and expects every effort. Parent confirmed empty `git diff HEAD`
for both tests and resolver/config/validator, unchanged global Codex 0.159.2, and
resolver reads environment rather than CLI. An ordinary-env targeted rerun
reproduced 30 passed/2 failed. No unrelated baseline test fix was made.

Failure evidence: `test-results/server-unit-tests-2026-10-05T16-52-38-204Z.log`,
lines 70293–70310 and 77486–77497; targeted
`test-results/server-unit-tests-2026-10-05T17-02-55-735Z.log`, lines 51–64 and
689–699. Compact image/cache evidence:
`logs/test-summaries/container-toolchain-evidence.json`; retained copied package
and native/WASM artifacts: `/tmp/codeinfo-toolchain-proof-iVHGeI`.
These build/smoke results do not establish Rapier behavioral regression,
performance, or iPhone proof.

## Pins and provenance

Captured on 2026-10-05 from the existing container's package metadata and official
release endpoints. Exact project lockfiles and tree-sitter 0.21.1 are unchanged.

- Node base, all server/client stages: `22.21.1-slim`, multiarch index
  `sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c`.
  Docker Hub registry verified Linux AMD64 and ARM64/v8 entries.
- Playwright CLI/core: `1.56.1`, existing root lockfile; the direct locked CLI
  installs its matching Chromium revision and OS dependencies.
- pip bootstrap: `26.2.1`, installed Python metadata and Docker `PIP_VERSION` ARG.
- Preserved globals: `@openai/codex@0.159.2`, `@github/copilot@1.0.89`,
  `@mermaid-js/mermaid-cli@11.15.0`.
- Previously floating globals: `mcp-remote@0.14.3`, `@upstash/context7-mcp@4.1.1`,
  `@mui/mcp@0.1.6`, `@playwright/mcp@0.0.83`, `chrome-devtools-mcp@1.10.1`,
  `git-credential-forwarder@1.5.0`; observed in
  `/usr/local/lib/node_modules/*/package.json`.
- Python direct pins from installed `importlib.metadata`: `requests==2.34.2`,
  `pyyaml==6.0.3`, `toml==0.10.2`, `jsonschema==4.26.0`, `rich==15.0.0`,
  `python-dotenv==1.2.3`, `pydantic==2.13.5`, `tenacity==9.1.4`, `httpx==0.28.1`,
  `python-dateutil==2.9.0.post0`, `beautifulsoup4==4.15.0`, `lxml==6.1.3`,
  `pandas==3.0.6`; preserved `img2pdf==0.6.3` and `Pillow==12.2.0`.
- Rustup `1.29.1`: official architecture-specific archive `.sha256` files.
- Rust/Cargo `1.99.0`: explicit official toolchain, whose distribution checksums
  rustup verifies. Components: rustfmt, Clippy, `wasm32-unknown-unknown`.
- wasm-pack `0.15.0`: official wasm-bindgen/wasm-pack release asset SHA256 metadata.
- wasm-bindgen CLI `0.2.129`: official release SHA256 metadata and `.sha256sum`.
- Binaryen/wasm-opt `133`: official release SHA256 metadata and `.sha256` files.

[requirements-constraints.txt](../server/requirements-constraints.txt) records the
installed Linux/Python 3.11 non-extra runtime closure reachable from the direct
requirements, including numpy, pikepdf and pydantic-core. Image requirement
installs use `-c /tmp/requirements-constraints.txt`; unrelated environment packages
are excluded and future project virtualenvs inherit no global pip constraint.
The fresh-image smoke verifies every constrained version and runs `pip check`.
These are compatible observed pins, not a request to update to future releases.
Global npm transitive resolution and Debian apt repositories are still upstream
resolution inputs; direct pins do not imply bit-for-bit image reproducibility.

The checksum manifest contains both AMD64 and ARM64 rows. The image-only installer
maps Docker `TARGETARCH` to official `x86_64`/`aarch64` artifacts and verifies bytes
before execution/extraction. Unknown versions or architectures fail closed.
Changing the exposed Rustup/WASM version ARGs requires matching reviewed checksum
rows. Rust version changes must retain a compatible wasm-bindgen CLI/crate pair.
Sources: [rustup archive](https://static.rust-lang.org/rustup/archive/1.29.1/),
[wasm-pack release](https://github.com/wasm-bindgen/wasm-pack/releases/tag/v0.15.0),
[wasm-bindgen release](https://github.com/wasm-bindgen/wasm-bindgen/releases/tag/0.2.129),
[Binaryen release](https://github.com/WebAssembly/binaryen/releases/tag/version_133).

## Layer and runtime behavior

Workspace npm installs use manifest-only inputs with BuildKit `/root/.npm`
download caches. Client installation keeps `--ignore-scripts` and fetch/registry
overrides; server installation keeps native lifecycle scripts for tree-sitter.
Python/global tool inputs, Rust installer/checksums and locked Playwright packages
precede volatile source/dist/docs/scripts/agent/fixture copies. Playwright uses
`node /opt/playwright/node_modules/playwright/cli.js install --with-deps chromium`;
`/ms-playwright` is an image directory, never a browser-only cache mount.

Native prerequisites include `build-essential`, `xz-utils`, `pkg-config` and
`libssl-dev`, alongside existing Python/git/curl tooling and Playwright OS libs.
`RUSTUP_HOME=/opt/rustup`, `CARGO_HOME=/opt/cargo`; native WASM tools are under
`/opt/wasm-tools/bin` and `/opt/binaryen/bin`. No global Node replacement or tool
installation under mounted `/app/codex`, `/app/copilot`, `/app/lmstudio` occurs.
Fresh shell PATH is:

```sh
export PATH=/opt/cargo/bin:/opt/wasm-tools/bin:/opt/binaryen/bin:/usr/local/bin:/usr/bin:/bin
```

Ownership preparation follows heavy installs. The entrypoint reuses
`codeinfo-prepare-rust-homes` before dropping privileges; root changes ownership
only when the requested UID/GID differs, and a non-root unwritable home fails with
an actionable error. Start the normal entrypoint as root for a new runtime UID.
Registry, proxy, certificate, provider home and Compose contracts remain intact.

## Parent-tester commands

Use current main wrappers, never `*:local:*`. First run the focused contracts:

```sh
npm run test:summary:server:unit -- --file src/test/unit/container-toolchain-contract.test.ts --file src/test/unit/providerPackageVersions.test.ts --file src/test/unit/copilot-compose-contract.test.ts --file src/test/unit/host-network-compose-contract.test.ts --file src/test/unit/open-code-review-flow.test.ts
npm run compose:build:summary
npm run test:summary:container-toolchain -- --rapier-root /home/dan/code/rapier
```

The last command uses the shared heartbeat/final summary protocol. It copies
tracked and unignored current files into a temporary context, excluding live
homes/credentials and ignored dependencies/builds. It builds server/client once,
changes only disposable server/client source files, then rebuilds. Evidence must
show workspace npm layers `CACHED`, server browser/Rust installs `CACHED`, and app
build layers `DONE`; missing or ambiguous BuildKit plain step evidence fails.
BuildKit must be available and its cache must survive the paired builds. Do not
prune shared caches. Source fixtures never change the checked-out repositories.

Standalone fresh containers use disposable named HOME/proof/Rapier volumes,
populated with `docker cp`, not live catalogs or credentials. This also works
when the agent's filesystem differs from the Docker host's bind-mount paths.
Root prepares ownership, then `setpriv` runs
the smoke as UID 1000 and again as override UID 12345. Both check tool/package
versions, writable Rust homes, native and WASM Rust compilation and a real
Playwright Chromium launch. The UID 1000 run additionally installs the copied
Rapier locked npm trees with scripts disabled and runs:

```sh
cd /work/rapier
export CARGO_TARGET_DIR=/proof/artifacts/native-target
cargo build -p rapier3d --lib
cd bindings/typescript
export CARGO_TARGET_DIR=/proof/artifacts/bindings-target
cargo run -p prepare_builds -- -d dim3 -f non-deterministic
cd rapier-compat
WASM_PACK_MODE=no-install sh ./build-rust.sh -d 3 -f non-deterministic
RAPIER_COMPAT_VARIANT=3d sh ./gen_src.sh
RAPIER_COMPAT_VARIANT=3d ./node_modules/.bin/rollup --config rollup.config.js --bundleConfigAsCjs
RAPIER_COMPAT_VARIANT=3d bash ./fix_raw_file.sh
```

The copied upstream baseline package must be
`@dimforge/rapier3d-compat@0.21.0`, with CJS/ESM initialization and World
step/free plus `npm pack --dry-run` passing. No `@chargeuk` port or behavioral
regression proof is implied. Native and binding targets are separate; the binding
script cleans only its disposable target. Generated package:
`/work/rapier/bindings/typescript/rapier-compat/builds/3d/pkg/` in the copied tree.

For the other architecture, repeat with `--platform linux/amd64` or
`--platform linux/arm64` on a native builder or configured emulation; report a
missing builder/emulator as a blocker rather than claiming cross-architecture
execution. Export required `CODEINFO_*` build overrides and standard proxy env
for the isolated proof; it does not read Compose env files or mount credentials.
Corporate CA trust must already be available to the builder/runtime where needed.

Logs: `logs/test-summaries/container-toolchain-latest.log` and timestamped log;
compact evidence: `logs/test-summaries/container-toolchain-evidence.json`.
The final summary includes the temporary artifact root. It retains copied sources,
the generated `package/`, native library/WASM, pack metadata and small smoke
artifacts under `artifacts-1000/` and `artifacts-12345/`. Large native/binding
targets remain isolated in the proof volume and are removed with it. Cleanup
removes only invocation container/image/volume names, never Compose stacks or
shared build caches. After an
interrupted run, clean only the printed `codeinfo-toolchain-proof-*` names.

The commands above remain repeatable proof instructions. This run's completed
results and limitations are recorded at the top; it is not awaiting an initial
proof run. For a future changed candidate, record pass/fail/skip and architecture
coverage separately and run only one full parallel wrapper. Accept compact
successful status; request failure details, paths and exact line ranges before
reading relevant failed sections. No new validation ran during this documentation
update.
