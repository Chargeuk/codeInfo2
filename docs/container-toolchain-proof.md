# Container pins and proof

This story changes image construction and focused proof support only. Parent
accepted the final PR262 ARM64 image/cache/runtime/package proof and compact
validation reports on 2026-10-06 without opening successful logs. Required proof
execution is complete; the full suite is **not green** because two unchanged
capability-baseline failures remain. AMD64 runtime execution was not attempted.

## Historical baseline (2026-10-05)

Initial image/cache/runtime proof passed on native ARM64/aarch64 with Node
22.21.1 and npm 10.9.4, including the then-upstream baseline package
`@dimforge/rapier3d-compat@0.21.0`. The main stack passed startup/health checks and
was left running; the protected local stack was untouched. Historical artifacts:
`/tmp/codeinfo-toolchain-proof-iVHGeI`. Final PR262 results below supersede the
initial proof for the current candidate and use the scoped Chargeuk fork.

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

Rust-home ownership is prepared only at runtime, by the entrypoint before dropping
privileges and by standalone proof containers. Image construction still creates
and owns HOME but no longer recursively reowns `/opt/cargo` or `/opt/rustup`.
Root inspects each complete tree with GNU find: any nested UID **or** GID mismatch
triggers recursive repair, even if the home directory already matches. Matching
trees skip chown. Traversal errors are reported and fail before repair; a non-root
unwritable home still fails with actionable guidance. Start the normal entrypoint
as root for runtime UID preparation.

Removing the build-time recursive chown avoids an extra ownership/copy-up layer;
the final ARM64 image is 7.8% smaller in aggregate uncompressed image bytes.
Fresh startup pays the scan and, where needed, recursive ownership/copy-up cost.
Fully matching warm trees still require a scan but no chown. The measured cold
startup tradeoff is recorded below; it is specific to the tested image/storage.
Registry, proxy, certificate, provider home and Compose configuration are unchanged.

## Completed PR262 proof and limits (2026-10-06)

- Scoped contract tests **15/15**, read-only ESLint/Prettier and shell syntax
  checks passed. Main Compose image build passed 2/2.
- The standalone toolchain summary passed using the clean scoped fork
  `/home/dan/code/rapier` at
  `55725fc55c95b664292e1d94f1dab344c67f87ab`. Disposable source-only rebuilds
  kept npm/Rust/Chromium install layers `CACHED` and server/client app layers
  `DONE`. Per-run source identities avoid reusing a previous invocation's app
  layer; strict cache evidence checks remain unchanged.
- UID/GID 1000 passed full native/tiny-WASM/Chromium and non-SIMD 3D Rapier
  compilation, actual CJS/ESM initialization and World step/free, and npm pack
  dry-run. The wrapper's UID/GID 12345 basic proof passed; a separate copied-source
  run without `uid-only` also passed the same full Rapier compile/package proof
  at UID/GID 12345. Actual package:
  `@chargeuk/rapier3d-compat@0.21.0-chargeuk.1`.
- The original Rapier checkout remained clean. Disposable copies, stacks and
  volumes were cleaned; both protected local and main live CodeInfo stacks stayed
  running unchanged. Retained artifacts: `/tmp/codeinfo-toolchain-proof-FiuggN`;
  compact evidence: `logs/test-summaries/container-toolchain-evidence.json`.

The focused ownership fixtures traverse real nested directories with GNU find,
but map ownership IDs and record repairs to avoid host chown privileges. Separate
accepted real-OS proof verified zero chown for matching trees and repair of
nested UID-only and GID-only mismatches despite matching roots. The final helper
has SHA-256 `3d95addd64c16c87f97fc93849aeb334926d8296af2b88a5f4c3304b4078e966`,
identical to that OS-tested candidate. Docker contracts retain entrypoint
preparation before privilege drop and prohibit build-time Rust-home preparation.

### Image size and startup tradeoff

| Image           | Tag                                                   | ID prefix (abbreviated) | Platform      | Image.Size (bytes) |
| --------------- | ----------------------------------------------------- | ----------------------- | ------------- | -----------------: |
| Baseline        | `codeinfo2-server:baseline-f2332787-20261006`         | `sha256:6da51e76…`      | `linux/arm64` |      8,558,828,612 |
| Final candidate | `codeinfo2-server:candidate-rust-home-final-20261006` | `sha256:55fd5085…`      | `linux/arm64` |      7,891,139,352 |

Saving: **667,689,260 bytes (~667.7 MB, 7.8%)**. Docker `Image.Size` is
aggregate uncompressed image bytes, not deduplicated host disk usage.

These three-trial startup medians were measured earlier against a
helper-identical candidate, **not repeated on the final image**:

| Image             | Runtime UID/GID | Helper (ms) | Helper + drop (ms) | Full Docker startup (ms) |
| ----------------- | --------------: | ----------: | -----------------: | -----------------------: |
| Baseline          |            1000 |         6.1 |               13.0 |                      224 |
| Baseline          |           12345 |         404 |                410 |                      672 |
| Earlier candidate |            1000 |         369 |                376 |                      651 |
| Earlier candidate |           12345 |         345 |                351 |                      606 |

The default UID cold start now pays runtime ownership cost; override startup was
lower in these trials. These bounded ARM64/storage observations do not establish
a universal startup improvement. Measurements used fresh disposable containers;
the existing wrapper has no timing report and no benchmark framework was added.

### Full-suite outcome and remaining limits

Exactly one new-candidate, no-filter `npm run test:summary:all:parallel`
completed: client **919/919**, cucumber **138/138**, E2E **80/80**; server
**3046 run, 3041 passed, 2 failed, 3 skipped**. The two baseline failures remain:

- `resolveCodexCapabilities` metadata expects minimal/turbo against the restricted
  default `gpt-6.1-sol` efforts.
- `chatValidators` supplies an unlisted model and expects all SDK efforts despite
  fallback to the restricted model.

Parent verified the related tests/source unchanged. No unrelated capability fix
is included. Failed-log references:
`test-results/server-unit-tests-2026-10-06T08-52-27-358Z.log`, lines
70359–70377 and 77552–77568; summary 91240–91245. Completion records performed
validation, not a green suite. Successful logs were not read for this closeout.

Actual runtime proof is ARM64 only. AMD64 checksum/source selection coverage is
not AMD64 runtime execution. These build/package smokes establish no Rapier
behavioral regression, performance or iPhone proof.

### Supported Rapier input

Use the actual scoped fork and revision above. Its generation scripts implement
`RAPIER_COMPAT_VARIANT=3d`; unmodified upstream master `846c463e` ignores that flag
and expects six variants, so it cannot use this 3D-only recipe unchanged.
The package gate accepts only these exact pairs before module import/init:
`@chargeuk/rapier3d-compat@0.21.0-chargeuk.1` (current proof) and
`@dimforge/rapier3d-compat@0.21.0` (historical baseline). Mixed versions and unknown
names fail. The baseline allowlist does not establish upstream script compatibility;
real CJS/ESM World step/free checks remain required.

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
scoped fork's locked npm trees with scripts disabled and runs the recipe below.
For full Rapier proof at UID 12345, use the same standalone runtime script without
`uid-only` on a separately populated disposable copy; the default wrapper's
12345 pass covers only basic runtime proof. Both full runs passed for this candidate.

Scoped fork recipe:

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

Use the scoped fork revision above; the copied package must be
`@chargeuk/rapier3d-compat@0.21.0-chargeuk.1`, with CJS/ESM initialization and
World step/free plus `npm pack --dry-run` passing. These are package/runtime
smokes, not behavioral regression proof. Native and binding targets are separate; the binding
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
