# Story 0000066 – Container toolchain and build cache

## Implementation Plan

### Description

Stabilize the Node 22 container baseline, move stable dependency and browser installs ahead of source copies, and bake the pinned Rust/WASM toolchain into the agent runtime. Preserve workspace lockfiles, corporate network overrides, provider homes, and runtime UID/GID behavior. Initial implementation and requested proof execution were completed on 2026-10-05; parent accepted compact tester reports without opening successful logs. Native ARM64 image/cache/runtime/Rapier proof passed; the full suite has two documented pre-existing server test mismatches, and AMD64 execution was not attempted. User authorized the initial reviewed delivery. PR262 runtime-ownership and proof-repair tasks below completed on 2026-10-06 with accepted cache and full copied-fork package proof at UID/GID 1000 and 12345. The new full-suite execution retains the same two baseline failures; completion does not mean the suite is green. No commit/push is performed during this documentation closeout.

### Acceptance Criteria

- Both applications use Node 22.21.1; manifest-only workspace installs cache downloads and survive source-only changes.
- Runtime Playwright 1.56.1 installs Chromium and OS libraries before volatile copies; browsers remain in `/ms-playwright` in the final image.
- Global npm and Python inputs are exact pins with provenance; pip bootstrap is pinned and the relevant Python dependency closure is constrained.
- AMD64/ARM64 official tool downloads are checksum verified. Rustup 1.29.1, Rust/Cargo 1.99.0, rustfmt, Clippy, the WASM target, wasm-pack 0.15.0, wasm-bindgen 0.2.129 and Binaryen 133 work outside mounted provider homes.
- Configured build/run UID changes leave Rust homes writable. Existing provider, Compose, OCR, registry, certificate and tree-sitter contracts remain intact.
- Disposable-context cache proof and standalone runtime/Rapier smoke instructions provide compact evidence without modifying original repositories.

### Out Of Scope

Rapier implementation, provider/API changes, workspace dependency upgrades, Node 24, tree-sitter upgrades, live installation, protected local-stack changes, credentials/catalog edits.

### Additional Repositories

None modified. Validation built a disposable copy of `/home/dan/code/rapier`; the original working tree remained unchanged.

### Story Manual Testing Guidance

Parent delegates validation using the main summary wrappers and isolated containers. No `*:local:*` commands. Inspect failed log sections only; successful summaries are sufficient. iPhone testing remains user-owned and is unrelated to this container story.

### Task 1. Pin and reorder container dependencies

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits: Included in this story commit.

#### Subtasks

1. [x] Pin Node images and move client workspace installation before source copies; add npm download caches.
2. [x] Pin installed global npm/Python versions and pip, record closure constraints and provenance.
3. [x] Install repo-pinned Playwright browsers/OS libraries before volatile runtime copies.

#### Testing

1. [x] Run focused implementation contracts with builds skipped; completed formal image/full-suite results are recorded in Tasks 2–3.

#### Implementation Notes

- Started from clean `main` on `feature/0000066-container-toolchain-and-build-cache`; no flow-state handoff changed.
- Pinned the verified Node multiarch index, installed global versions and Python closure; preserved network override branches and locked workspaces. Moved client source copies and server browser installs so source changes do not invalidate stable installs.
- Parent review follow-up: moved all four Vite ARG/ENV declarations after npm installation and source/override-state copies, immediately before the frontend build. Registry/fetch arguments remain at the dependency phase; a focused ordering assertion guards against application config invalidating npm installation.
- Implementation-stage verification: the focused container contract passed all 7 tests with builds skipped. Explicitly formatted only the eight added/modified JS/TS/Markdown/JSON files, including untracked sources; formatter writes outside the assertion were limited to whitespace in the proof wrapper.
- Implementation-stage focused summary ran the new container contracts (including proof CLI guards) and the four required existing contracts: 39 passed, zero failed, builds skipped. Successful logs were not opened.
- Parent proof: `npm run compose:build:summary` passed 2/2 on native ARM64/aarch64 with host Node 22.21.1/npm 10.9.4. Main `compose:up` passed; server `5010/health` and client `5001/` returned HTTP 200. Healthy main stack remains running; protected local stack was untouched.
- Read Dockerfiles, entrypoint and relevant contracts directly; worker-backed CodeInfo research is excluded by this assignment's no-worker rule. Consulted Docker's cache documentation via Context7.

### Task 2. Bake architecture-specific Rust/WASM tools

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__done__`
- Git Commits: Included in this story commit.

#### Subtasks

1. [x] Add checksum-pinned architecture-specific installer instructions and runtime native prerequisites, keeping installs separate from app/home changes.
2. [x] Prepare writable Rust homes for configured runtime UID/GID and entrypoint overrides.

#### Testing

1. [x] Parent tester validates AMD64/ARM64 source/checksum selection coverage and native ARM64 fresh-image tool versions, mounted-HOME permissions, native/WASM compilation and Chromium launch. AMD64 execution was not attempted.

#### Implementation Notes

- Added official architecture-specific checksum inputs and image-only installer, native prerequisites and `/opt` homes. Ownership is prepared after heavy installs and rechecked by the entrypoint for runtime UID overrides; no live installer executed.
- Tool versions are explicit user requirements; installation occurred during parent-owned image builds, with no implementation-stage live installer.
- Fresh runtimes UID 1000 and 12345 with mounted empty HOME passed actual native/WASM compilation and Chromium page launch. Main runtime UID/GID 1000 has writable Cargo/Rustup homes; actual versions: Node 22.21.1, npm 10.9.4, Rust/Cargo 1.99.0, wasm-pack 0.15.0, wasm-bindgen 0.2.129, wasm-opt 133, Playwright 1.56.1, Chromium 141.0.7390.37. Runtime proof is ARM64 only; AMD64 has focused source/checksum selection coverage.

### Task 3. Add focused proof support and documentation

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`, `Task 2`
- Task Status: `__done__`
- Git Commits: Included in this story commit.

#### Subtasks

1. [x] Add focused automated contracts and disposable source-only cache/runtime proof support using the existing summary protocol.
2. [x] Document pins, provenance, exact proof commands and evidence limitations in README/proof instructions.

#### Testing

1. [x] Parent tester runs source-only cache proof, confirming cached workspace npm/browser/Rust layers and changed app layers.
2. [x] Parent tester runs isolated Rapier 3D baseline build/package and CJS/ESM World step/free smoke with separate artifacts and unchanged original working tree.
3. [x] Parent tester runs main Compose build summary, lint/format checks and exactly one full `test:summary:all:parallel` candidate, recording actual results including failures. Execution is complete; the full suite is not green.

#### Implementation Notes

- Added strict BuildKit status parsing, disposable contexts/source fixtures and Docker volumes populated through `docker cp` (works with a remote/shared Docker socket). Fresh runtime proof uses mounted HOME and two non-root UIDs; original Rapier status/content fingerprints are checked and builds use only copied sources and separate targets.
- `npm run test:summary:container-toolchain -- --rapier-root /home/dan/code/rapier` passed. Source-only rebuild: server npm/browser/Rust and client npm steps `CACHED`, app compilation `DONE`. UID 1000 copied Rapier full 3D baseline build produced `@dimforge/rapier3d-compat@0.21.0`; CJS/ESM init/World step/free and npm pack dry-run passed. Evidence: `logs/test-summaries/container-toolchain-evidence.json`; retained artifacts: `/tmp/codeinfo-toolchain-proof-iVHGeI`.
- After the test import-order fix, lint, `format:check`, explicit Prettier coverage of new files, `sh -n` on four scripts and shell tests 37/37 passed. Exactly one full parallel run: client 919 passed, cucumber 138 passed, E2E 80 passed; server unit 3038 total, 3033 passed, 2 failed, 3 skipped. Ordinary-env targeted rerun reproduced 30 passed/2 failed.
- Full-suite limitation: unchanged `capabilityResolver.test.ts` selects default first `gpt-6.1-sol`, expects minimal/turbo despite existing low/medium/high/xhigh restriction; unchanged `chatValidators.test.ts` uses an unlisted SDK model, falls back to the first restricted model but expects every effort. Parent confirmed empty `git diff HEAD` for both tests and resolver/config/validator, unchanged global Codex 0.159.2, and resolver reads env rather than CLI. These baseline mismatches remain unfixed and do not justify claiming the suite passed.
- Failure references: `test-results/server-unit-tests-2026-10-05T16-52-38-204Z.log`, lines 70293–70310 and 77486–77497; targeted `test-results/server-unit-tests-2026-10-05T17-02-55-735Z.log`, lines 51–64 and 689–699. Completed testing checkboxes record execution, not universal success; task completion retains these limitations and unattempted AMD64 execution. No behavioral/performance/iPhone proof is claimed.

### Task 4. PR262 runtime-only Rust home ownership

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`, `Task 3`
- Task Status: `__done__`
- Git Commits: Pending parent commit.

#### Subtasks

1. [x] Detect nested UID or GID mismatches and propagate traversal errors before conditional recursive repair.
2. [x] Remove only Docker build-time Rust-home preparation; preserve HOME ownership and entrypoint preparation before privilege drop.
3. [x] Extend ownership contracts/fixtures and document runtime-only preparation, cold-start tradeoff and focused proof limits.

#### Testing

1. [x] Parent tester validates focused ownership/Docker/entrypoint contracts, affected existing provider/Compose/flow contracts, scoped formatting/lint and shell syntax.
2. [x] Parent tester runs main `npm run compose:build:summary` and `npm run test:summary:container-toolchain -- --rapier-root /home/dan/code/rapier`, proving source-only npm/browser/Rust cache reuse, fresh UID/GID 1000 and 12345 native/WASM writable-home checks and full copied Rapier build/package smokes at both UIDs. The default wrapper runs full Rapier only at 1000; use the existing standalone runtime script without `uid-only` for the 12345 disposable copy and record both outcomes.
3. [x] Parent tester records one-time baseline/candidate image-size and fresh ownership-startup comparisons for UID/GID 1000 and 12345 using disposable containers, including matching-top-level/mismatched-nested ownership proof. No benchmark framework or live-stack changes.
4. [x] Parent tester runs exactly one full no-selection `npm run test:summary:all:parallel` (or `test:summary:all:stress` if concurrency-sensitive proof warrants it), reporting actual pass/fail/skip counts and remaining baseline limitations.

#### Implementation Notes

- Branch/HEAD verified as `feature/0000066-container-toolchain-and-build-cache` at `f2332787b`; user agent/flow changes are preserved. Plan helpers were used, with bounded section reads when no current-task handoff was available; flow state was not changed.
- Root inspects the entire Rust home for either UID or GID mismatch; traversal errors fail explicitly before repair and matching trees avoid recursive chown. Removed only Docker's build-time helper invocation; HOME ownership and entrypoint pre-drop preparation remain unchanged.
- Nested-tree/GNU-find fixtures map ownership without host chown privileges. Accepted real-OS proof separately demonstrated zero chown for matching trees and repair of nested UID-only/GID-only mismatches despite matching roots. Final helper hash `3d95addd64c16c87f97fc93849aeb334926d8296af2b88a5f4c3304b4078e966` matches that OS-tested candidate.
- Final scoped contracts 15/15, read-only ESLint/Prettier/shell syntax and Compose build 2/2 passed. Strict cache proof passed after Task 5 repairs: npm/Rust/Chromium layers CACHED, server/client app layers DONE.
- Clean scoped Rapier fork `55725fc55c95b664292e1d94f1dab344c67f87ab` passed full native/tiny-WASM/Chromium/non-SIMD 3D compilation, CJS/ESM init/World step/free and npm pack dry-run at UID1000. Wrapper UID12345 basic proof plus separate copied-source full Rapier compile/package at UID12345 passed; package `@chargeuk/rapier3d-compat@0.21.0-chargeuk.1`. Original Rapier remained clean; disposable copies/stacks/volumes were cleaned, main and protected local stacks stayed running unchanged. Artifacts: `/tmp/codeinfo-toolchain-proof-FiuggN`.
- Final ARM64 image size: baseline `codeinfo2-server:baseline-f2332787-20261006` (`sha256:6da51e76…`) 8,558,828,612 bytes; candidate `codeinfo2-server:candidate-rust-home-final-20261006` (`sha256:55fd5085…`) 7,891,139,352 bytes. Saving 667,689,260 bytes (~667.7 MB, 7.8%); Image.Size is aggregate uncompressed bytes, not deduplicated disk usage.
- Earlier helper-identical candidate's three-trial medians (helper/helper+drop/full Docker ms), not new final-image measurements: baseline UID1000 6.1/13.0/224, UID12345 404/410/672; candidate UID1000 369/376/651, UID12345 345/351/606. Runtime-only preparation shifts cost into fresh startup; these are bounded ARM64/storage observations.
- Exactly one new-candidate no-filter all-parallel suite completed: client 919/919, cucumber 138/138, E2E 80/80; server 3046 run, 3041 passed, 2 known capability-baseline failures, 3 skipped. Completed testing boxes record execution, not a green suite; related paths were unchanged. Final failure references and proof details are in [the guide](../docs/container-toolchain-proof.md). AMD64 runtime, behavioral/performance and iPhone proof were not performed. Compact reports were accepted without opening successful logs; this closeout ran no validation or Docker operations.

### Task 5. Repair repeatable cache fixtures and scoped fork package proof

- Repository Name: `Current Repository`
- Task Dependencies: `Task 4`
- Task Status: `__done__`
- Git Commits: Pending parent commit.

#### Subtasks

1. [x] Include existing per-run identity in disposable TS/TSX cache-proof source fixtures without weakening cache evidence.
2. [x] Accept only the two supported Rapier name/version pairs before imports; add focused boundary coverage and clarify supported scoped fork input/evidence.

#### Testing

1. [x] Parent tester validates the focused contract file and scoped source/style/shell checks for this repaired candidate.
2. [x] Parent tester reruns strict source-only cache proof with the actual scoped fork input, retaining original checkout fingerprints; completes full 3D CJS/ESM/package and UID/GID 1000/12345 native/WASM/Rapier proof.
3. [x] Parent tester performs exactly one new-candidate full no-selection `npm run test:summary:all:parallel` (or `test:summary:all:stress`, not both) and records actual outcomes, retaining capability baseline and AMD64 limitations.

#### Implementation Notes

- Root diagnosed repeated source-fixture bytes reusing a prior app layer and unmodified upstream generation ignoring the fork's 3D scope. Disposable TS/TSX fixtures now include the existing per-run identity through JSON string literals; strict cached-install/DONE-app checks remain unchanged. No semantic app or ownership change was made in this repair.
- Package gate accepts only exact upstream-baseline or Chargeuk name/version pairs before imports. CLI boundary coverage rejects mixed/wrong/unknown pairs; real CJS/ESM World smokes remain intact. Current proof input is the scoped fork, not unmodified upstream master.
- Final focused contract 15/15 and scoped read-only style/shell checks passed. Repaired cache proof and full copied-fork compilation/package smokes at both UIDs passed as recorded in Task 4 and [the guide](../docs/container-toolchain-proof.md); original checkout and live stacks were preserved.
- Final all-parallel execution completed with client 919, cucumber 138 and E2E 80 passed; server 3041 passed, 2 unchanged capability failures, 3 skipped out of 3046. `resolveCodexCapabilities` metadata expects minimal/turbo against restricted default `gpt-6.1-sol`; `chatValidators` unlisted-model fallback expects all SDK efforts. No baseline fix is included. Failure log `test-results/server-unit-tests-2026-10-06T08-52-27-358Z.log` lines 70359–70377 and 77552–77568, summary 91240–91245. Proof is complete within ARM64 scope, not full-suite green or AMD64 runtime/behavioral/performance/iPhone proof. Parent owns commit/push; only documentation changed in this closeout.
