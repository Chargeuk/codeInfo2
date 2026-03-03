# Story 0000041 – Corporate Registry and Certificate Overrides via CODEINFO Environment Variables

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Today, the project works in standard Mac and WSL setups, but some corporate Windows/WSL environments require manual one-off edits before Docker builds can reach package repositories. In these environments, public npm/pip access is blocked and traffic must go through an internal Artifactory and corporate TLS certificate chain.

At the moment, users must manually edit multiple files (`.npmrc`, `server/Dockerfile`, `client/Dockerfile`, and container startup behavior) to inject registry and certificate settings. This is fragile, hard to document, and difficult for new contributors.

This story introduces a generic configuration approach based on `CODEINFO_*` environment variables so users can place corporate overrides in workflow env files (`server/.env.local` for `compose`/`compose:local`, `.env.e2e` for e2e) instead of modifying source-controlled Docker and npm config files. The default open-source behavior must remain unchanged when overrides are not set.
For v1, this story is intentionally narrow: single default npm registry only (no scoped npm registry rules), no npm auth mechanism, and no proxy support.
For certificate trust, v1 standardizes on mounting only corporate `.crt` files from a dedicated host directory into `/usr/local/share/ca-certificates/codeinfo-corp:ro` (not mounting host `/etc/ssl/certs`), then conditionally refreshing the runtime CA store.
Documentation for this story must add a new README subsection immediately after `### Mac & WSL That have followed the WSL setup above` with a clear corporate-restricted-network title and setup steps.
The expected implementation output for this story is limited to Docker/Compose/shell/docs updates (no TypeScript or React feature work).
Because current wrappers use different env files per workflow, this story treats `compose` and `compose:local` as `server/.env.local` driven, while e2e corporate overrides are driven by `.env.e2e`.

Expected user outcome:
- Standard users keep current behavior with no extra setup.
- Corporate users can configure npm/pip registry and certificate behavior through environment values only.
- Manual source edits to Dockerfiles and `.npmrc` are no longer required for normal corporate onboarding.

### Deliverables

- Updated compose files (`docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`) with explicit `CODEINFO_*` build/runtime wiring and deterministic cert-mount behavior.
- Updated Dockerfiles (`server/Dockerfile`, `client/Dockerfile`) so dependency install commands honor configured corporate registry/index values.
- Updated server startup script (`server/entrypoint.sh`) for deterministic CA refresh behavior with clear fail-fast logging.
- Updated host helper (`start-gcf-server.sh`) so global npm install honors corporate npm registry env when set.
- Updated docs (`README.md`) with the required new corporate setup section and concrete examples.
- Required env-file updates for workflow parity (including adding `CODEINFO_*` placeholders/defaults to `.env.e2e`).

### Configuration Semantics (Authoritative)

The following behavior is mandatory and is the single source of truth for tasking.

1. `CODEINFO_NPM_REGISTRY`
   - Default: unset.
   - Used by: server Docker build (`npm ci`, `npm install -g`), client Docker build (`npm ci`), host helper (`start-gcf-server.sh` global npm install).
   - Behavior:
     - unset/empty => current npm default behavior,
     - non-empty => npm commands use this registry.

2. `CODEINFO_PIP_INDEX_URL`
   - Default: unset.
   - Used by: server Docker build `pip install` steps.
   - Behavior:
     - unset/empty => current pip default behavior,
     - non-empty => pip uses this index URL.

3. `CODEINFO_PIP_TRUSTED_HOST`
   - Default: unset.
   - Used by: server Docker build `pip install` steps.
   - Behavior:
     - unset/empty => current pip default behavior,
     - non-empty => pip uses this trusted host.

4. `CODEINFO_NODE_EXTRA_CA_CERTS`
   - Default: `/etc/ssl/certs/ca-certificates.crt` at server runtime.
   - Used by: server runtime before launching Node.
   - Behavior:
     - unset/empty => runtime exports default path above,
     - non-empty => runtime exports provided path.

5. `CODEINFO_CORP_CERTS_DIR`
   - Default: compose fallback path `./certs/empty-corp-ca`.
   - Used by: compose server volume mount source.
   - Behavior:
     - unset/empty => compose mounts fallback path,
     - non-empty => compose mounts configured host cert directory.

6. `CODEINFO_REFRESH_CA_CERTS_ON_START`
   - Default: disabled.
   - Used by: server entrypoint before `node dist/index.js`.
   - Behavior:
     - only case-insensitive `true` enables refresh,
     - any other value (including unset/empty) means disabled,
     - enabled + no usable `.crt` files => fail fast with clear error and non-zero exit,
     - enabled + usable `.crt` files => run `update-ca-certificates`, then continue startup.

### Acceptance Criteria

1. A developer can configure corporate behavior by editing workflow env files only:
   - `server/.env.local` for `compose` and `compose:local`,
   - `.env.e2e` for e2e workflows,
   - with no edits required to `.npmrc`, Dockerfiles, or compose YAML files in their local clone.
2. Canonical v1 environment variables are exactly:
   - `CODEINFO_NPM_REGISTRY`
   - `CODEINFO_PIP_INDEX_URL`
   - `CODEINFO_PIP_TRUSTED_HOST`
   - `CODEINFO_NODE_EXTRA_CA_CERTS`
   - `CODEINFO_CORP_CERTS_DIR`
   - `CODEINFO_REFRESH_CA_CERTS_ON_START`
3. Compose interpolation remains sourced from existing wrapper behavior:
   - `compose` and `compose:local` flows use `server/.env` + `server/.env.local`,
   - e2e flow uses `.env.e2e`,
   - no separate client env interpolation is introduced for this story.
4. `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` each pass `CODEINFO_NPM_REGISTRY` to both server and client build paths, and pass the remaining `CODEINFO_*` values to the server build/runtime paths.
5. `server/Dockerfile` accepts and applies registry/certificate-related build arguments in every stage that executes `npm ci`, global `npm install -g`, or `pip install`.
6. `client/Dockerfile` accepts and applies registry-related build arguments in the stage that executes `npm ci`.
7. When `CODEINFO_NPM_REGISTRY` is set, npm install steps use that registry through environment/config wiring; when it is unset, existing default npm behavior is preserved.
8. When `CODEINFO_PIP_INDEX_URL` and `CODEINFO_PIP_TRUSTED_HOST` are set, server pip install steps use them; when unset, existing pip defaults are preserved.
9. Server runtime supports certificate refresh by running `update-ca-certificates` during startup only when `CODEINFO_REFRESH_CA_CERTS_ON_START=true`.
10. Corporate certificate mount uses `CODEINFO_CORP_CERTS_DIR` mapped to `/usr/local/share/ca-certificates/codeinfo-corp:ro`; mounting host `/etc/ssl/certs` is not used.
11. Server runtime exports `NODE_EXTRA_CA_CERTS` from `CODEINFO_NODE_EXTRA_CA_CERTS` and uses `/etc/ssl/certs/ca-certificates.crt` as the documented default when unset.
12. Root `.npmrc` remains unchanged for v1 (no mandatory manual edits for single-registry corporate setup).
13. v1 supports one default npm registry URL only and does not implement scoped registry mapping (`@scope:registry`).
14. v1 does not implement npm authentication handling (token/basic/client certificate).
15. v1 does not implement proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
16. README contains a new section immediately after `### Mac & WSL That have followed the WSL setup above` with exact title `### Corporate Registry and Certificate Overrides (Restricted Networks)`.
17. That README section includes:
   - a tested concrete example path for `CODEINFO_CORP_CERTS_DIR`,
   - expected cert file format/location (for example `.crt` files in that directory),
   - explicit default statement that `CODEINFO_REFRESH_CA_CERTS_ON_START=false` unless certificate-mount setup is intentionally enabled,
   - step-by-step setup for restricted corporate WSL environments across `compose`/`compose:local` (`server/.env.local`) and e2e (`.env.e2e`).
18. Compose handling for missing cert-dir variables is deterministic and documented:
   - default path/logic must not break compose parsing when `CODEINFO_CORP_CERTS_DIR` is unset,
   - compose uses a repo-owned fallback mount source path for unset cert-dir values (for example `./certs/empty-corp-ca`),
   - if `CODEINFO_REFRESH_CA_CERTS_ON_START=true` and no usable `.crt` files are available, server startup fails with a clear error message and non-zero exit code.
19. `CODEINFO_REFRESH_CA_CERTS_ON_START` parsing is explicitly defined for junior implementers: only case-insensitive `true` enables refresh; all other values (including empty/unset) mean disabled.
20. Host helper `start-gcf-server.sh` supports restricted networks by honoring `CODEINFO_NPM_REGISTRY` (mapped to npm registry env/config) for its `npm install -g git-credential-forwarder` step, with defaults unchanged when unset.
21. Final verification notes in the story must show wrapper build commands complete successfully for affected workflows after configuration changes, including:
   - `npm run compose:build`
   - `npm run compose:local:build`
   - `npm run compose:e2e:build`
   - and include command output/log references proving each command completed successfully.
22. Story implementation notes must include evidence for both positive and negative runtime cert paths:
   - refresh enabled + valid cert input (successful startup),
   - refresh enabled + missing/invalid cert input (expected fail-fast).
23. Story implementation notes must record the exact fallback cert directory path added to the repo and where it is referenced in compose files.

### Message Contracts and Storage Shapes

1. New REST API contracts
   - None required for this story.
   - No new endpoints are introduced.

2. Existing REST API contracts
   - No request/response shape changes are required.
   - `openapi.json` does not require contract additions for this infrastructure-only story.

3. WebSocket contracts
   - No new WebSocket message types are required.
   - No changes are required to existing client/server WS payload shapes.

4. Storage and persistence shapes
   - No Mongo collection/schema changes are required.
   - Conversation/turn/repo document shapes remain unchanged.

5. Scope guard
   - If implementation proposes any new API route, WS event, or persisted field, that change is out of scope for this story and must be raised as a separate story update before coding it.

### Out Of Scope

- Replacing enterprise credential-management systems (vault/secret stores/SSO tooling).
- Building a full multi-registry policy engine for arbitrary per-package routing.
- Supporting scoped npm registry rules (`@scope:registry`) in v1.
- Implementing npm authentication mechanisms (token/basic/client certificate) in v1.
- Proxy support (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) for this story.
- Mounting the full host `/etc/ssl/certs` tree into containers.
- TypeScript/React feature changes in `client/src` or server business logic changes in `server/src` unrelated to build/runtime configuration.
- Supporting native Windows (non-WSL) runtime behavior beyond existing project support.
- Changing unrelated networking requirements (for example LM Studio, Mongo, Chroma host routing).
- Committing corporate secrets or internal hostnames as hardcoded defaults in tracked env files.

### Questions
- None.

### Edge Cases and Failure Modes

1. Compose/env-file loading failures
   - `server/.env.local` missing for `compose`/`compose:local` must fail clearly before build/run begins.
   - `.env.e2e` missing or malformed for e2e flows must fail clearly before build/run begins.
   - Corporate setup docs must not imply `client/.env.local` controls compose interpolation for this story.

2. Compose interpolation and mount-shape failures
   - `CODEINFO_CORP_CERTS_DIR` unset/empty must still produce a valid compose volume spec via fallback directory.
   - `CODEINFO_CORP_CERTS_DIR` with whitespace, relative, or absolute paths must resolve to a deterministic mount shape.
   - Compose config rendering (`docker compose ... config`) must remain valid across `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`.

3. Build-arg propagation failures
   - `CODEINFO_NPM_REGISTRY` must be available to both server and client build flows; missing mapping in any compose file is a failure.
   - `CODEINFO_PIP_INDEX_URL`/`CODEINFO_PIP_TRUSTED_HOST` must be available to server build flows where pip runs.
   - Empty-string values (`VAR=`) must not accidentally alter commands in ways that differ from true unset behavior.

4. Registry/index behavior failures
   - Npm behavior must remain default when `CODEINFO_NPM_REGISTRY` is unset and must switch to override when set.
   - Pip behavior must remain default when pip vars are unset and must switch to override when set.
   - Build logs should make it diagnosable when override registries are unreachable (network/auth/TLS failures).

5. Runtime certificate refresh failures
   - `CODEINFO_REFRESH_CA_CERTS_ON_START` parsing must only enable on case-insensitive `true`; all other values are disabled.
   - Enabled refresh with no usable `.crt` files must fail fast with clear non-zero exit.
   - Enabled refresh with valid cert input must complete and allow normal Node startup.
   - `NODE_EXTRA_CA_CERTS` must be exported before Node starts; otherwise extra CA bundle is not applied.
   - Permission problems during `update-ca-certificates` must surface clearly and fail startup when refresh is enabled.

6. Host helper failures (`start-gcf-server.sh`)
   - Global npm install must use default behavior when `CODEINFO_NPM_REGISTRY` is unset.
   - Global npm install must use override registry when `CODEINFO_NPM_REGISTRY` is set.
   - Existing git-path resolution behavior (including `cygpath` handling) must remain unchanged.

7. Workflow parity and documentation failures
   - README must clearly separate `compose`/`compose:local` (`server/.env.local`) from e2e (`.env.e2e`) setup.
   - README must include required section title and placement exactly as defined in acceptance criteria.
   - README must document fallback cert directory behavior and expected `.crt` file format.

8. Regression guardrails
   - Existing compose flows without any `CODEINFO_*` values must continue to build/start as they do today.
   - Existing API/WS contracts and Mongo shapes must remain unchanged (infra-only story scope).

### Research Findings (2026-03-03)

- Docker Compose interpolation substitutes unresolved variables with empty strings, which can break value shapes like volume specs if not handled deliberately. Source: Docker docs, variable interpolation (`${VAR:-default}`, `${VAR:?error}` and unresolved-variable behavior).
  - https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Docker Compose supports multiple `--env-file` inputs and later files override earlier files. Source: Docker docs.
  - https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- npm config precedence is command line, then environment variables, then `npmrc` files; therefore env-based registry wiring is sufficient for the single-registry v1 scope. Source: npm CLI config docs.
  - https://docs.npmjs.com/cli/v10/using-npm/config/
- npm auth-related settings are expected to be scoped to a registry path in `.npmrc`, which supports the v1 decision to keep auth out of scope. Source: `.npmrc` docs.
  - https://docs.npmjs.com/cli/v10/configuring-npm/npmrc/
- pip supports configuration via environment variables (`PIP_<OPTION>`), including `PIP_INDEX_URL` and `PIP_TRUSTED_HOST`; empty environment variables are not treated as false and must be handled explicitly. Sources: pip configuration and pip install docs.
  - https://pip.pypa.io/en/stable/topics/configuration/
  - https://pip.pypa.io/en/stable/cli/pip_install/
- Node.js reads `NODE_EXTRA_CA_CERTS` only when the process starts, so certificate refresh must happen before launching `node` in entrypoint flow. Source: Node CLI docs.
  - https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Debian `update-ca-certificates` reads trusted certs from `/usr/local/share/ca-certificates` and processes `.crt` files, which validates the dedicated corporate cert mount approach. Source: Debian man page.
  - https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html
- Tooling availability caveat from this research session:
  - `deepwiki` could not be used for this repository because it is not indexed there.
  - `context7` could not be used due API key failure in this environment.

## Implementation Ideas

1. Implementation surface and sequencing
   - Work in this order to minimize breakage and make verification simpler:
     - Compose/env wiring first.
     - Dockerfile build-time registry behavior second.
     - Runtime certificate refresh behavior third.
     - Host helper (`start-gcf-server.sh`) fourth.
     - README/documentation last.
   - Planned file touchpoints:
     - `docker-compose.yml`
     - `docker-compose.local.yml`
     - `docker-compose.e2e.yml`
     - `.env.e2e`
     - `certs/empty-corp-ca/.gitkeep`
     - `server/Dockerfile`
     - `client/Dockerfile`
     - `server/entrypoint.sh`
     - `start-gcf-server.sh`
     - `README.md`

2. Compose and env propagation
   - Add canonical `CODEINFO_*` values with explicit mapping:
     - server build args: all registry/cert-related `CODEINFO_*` values needed at build time,
     - client build args: `CODEINFO_NPM_REGISTRY`,
     - server runtime env: cert-refresh and node extra cert values.
   - Keep workflow env sources aligned to existing wrappers:
     - `compose` and `compose:local`: `server/.env` + `server/.env.local`
     - `compose:e2e:*`: `.env.e2e`
   - Ensure e2e has corresponding `CODEINFO_*` keys in `.env.e2e` (with safe defaults/comments for local corporate overrides).
   - Implement deterministic cert mount behavior in compose when cert dir is unset:
     - introduce a repo-owned empty fallback directory (for example `./certs/empty-corp-ca/.gitkeep`),
     - mount `${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}` to `/usr/local/share/ca-certificates/codeinfo-corp:ro` so config parsing never fails.

3. Server Dockerfile build-time behavior
   - Add `ARG` values for:
     - `CODEINFO_NPM_REGISTRY`
     - `CODEINFO_PIP_INDEX_URL`
     - `CODEINFO_PIP_TRUSTED_HOST`
     - `CODEINFO_NODE_EXTRA_CA_CERTS`
   - Apply them in each server stage that installs dependencies:
     - workspace `npm ci`,
     - global `npm install -g`,
     - `pip install`.
   - Use conditional shell logic so unset values do not change current behavior.
   - Do not introduce `.npmrc` mutation in image build for v1.

4. Client Dockerfile build-time behavior
   - Add `ARG CODEINFO_NPM_REGISTRY` in build stage.
   - Ensure `npm ci` uses the override only when set and otherwise stays default.

5. Runtime cert-refresh and Node trust behavior
   - Update `server/entrypoint.sh` to:
     - parse `CODEINFO_REFRESH_CA_CERTS_ON_START` (`true` case-insensitive enables; everything else disabled),
     - run `update-ca-certificates` before launching `node` when enabled,
     - fail fast with clear error + non-zero exit if refresh is enabled but no usable `.crt` files exist under `/usr/local/share/ca-certificates/codeinfo-corp`,
     - set/default `NODE_EXTRA_CA_CERTS` from `CODEINFO_NODE_EXTRA_CA_CERTS` (default `/etc/ssl/certs/ca-certificates.crt`) before starting Node.

6. Host helper alignment
   - Update `start-gcf-server.sh` so `npm install -g git-credential-forwarder` honors `CODEINFO_NPM_REGISTRY` when set.
   - Preserve existing behavior when variable is unset.

7. README implementation output
   - Insert immediately after `### Mac & WSL That have followed the WSL setup above`:
     - `### Corporate Registry and Certificate Overrides (Restricted Networks)`
   - Include:
     - tested concrete `CODEINFO_CORP_CERTS_DIR` example path,
     - expected certificate format (`.crt` files),
     - explicit default `CODEINFO_REFRESH_CA_CERTS_ON_START=false`,
     - setup steps for:
       - `compose` / `compose:local` using `server/.env.local`,
       - e2e using `.env.e2e`.

8. Verification evidence to capture
   - Compose parsing checks:
     - `docker compose -f docker-compose.yml config`
     - `docker compose -f docker-compose.local.yml config`
     - `docker compose -f docker-compose.e2e.yml config`
     - run each with cert-dir unset and set.
   - Required wrapper builds:
     - `npm run compose:build`
     - `npm run compose:local:build`
     - `npm run compose:e2e:build`
   - Runtime behavior checks:
     - refresh disabled path starts normally,
     - refresh enabled + valid certs starts normally,
     - refresh enabled + missing/invalid certs exits non-zero with clear log.
   - Host helper check:
     - run `start-gcf-server.sh` with and without `CODEINFO_NPM_REGISTRY` and confirm install path behavior.

## Task Execution Instructions

1. Read this full story before implementation, including Acceptance Criteria, Configuration Semantics, Message Contracts and Storage Shapes, Edge Cases and Failure Modes, and Implementation Ideas.
2. Work tasks strictly in numeric order. Do not start a later task until the current task is fully complete and documented.
3. Each task is intentionally scoped to one testable implementation concern. Keep scope confined to that concern.
4. For each task, set Task Status to `__in_progress__` before touching code, and set to `__done__` only after subtasks, testing, docs updates, and implementation notes are complete.
5. Complete every subtask in order and tick its checkbox immediately after completion.
6. Complete testing steps in order and tick each checkbox immediately after completion.
7. Use wrapper-first commands from `AGENTS.md` for build/test/compose checks.
8. After each task, update Implementation notes with decisions, issues, and outcomes, then record commit hashes in Git Commits.
9. Keep API/WS/storage contracts unchanged in this story; if contract/schema changes are discovered, stop and update the story scope first.

## Tasks

### 1. Compose and Env Scaffolding: wire `CODEINFO_*` values and deterministic cert fallback

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Add compose-level plumbing so all workflows receive the expected `CODEINFO_*` values from the correct env files, ensure cert volume interpolation remains valid when `CODEINFO_CORP_CERTS_DIR` is unset, and remove ambiguity between compose interpolation sources and container `env_file` sources.

#### Documentation Locations

- [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml)
- [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.local.yml)
- [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.e2e.yml)
- [.env.e2e](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/.env.e2e)
- [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/docker-compose-with-env.sh)
- [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package.json)
- Docker Compose interpolation docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/

#### Subtasks

1. [ ] Create fallback cert directory for unset cert mounts at `certs/empty-corp-ca/.gitkeep`.
2. [ ] Create a short source-of-truth matrix in Implementation notes before edits: compose/local interpolation from `server/.env` + `server/.env.local`, e2e interpolation from `.env.e2e`, and service runtime `env_file` usage from compose YAML.
3. [ ] Reuse existing compose interpolation style already present in compose files (for example `${VAR:-default}` patterns used for `CODEINFO_DOCKER_UID/GID` and host paths) when adding all new `CODEINFO_*` mappings.
4. [ ] Update [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml) server build args to include `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, and `CODEINFO_NODE_EXTRA_CA_CERTS`.
5. [ ] Update [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml) client build args to include `CODEINFO_NPM_REGISTRY`.
6. [ ] Update [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml) server runtime env to include `CODEINFO_NODE_EXTRA_CA_CERTS` and `CODEINFO_REFRESH_CA_CERTS_ON_START`, and add quoted cert mount `"${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}:/usr/local/share/ca-certificates/codeinfo-corp:ro"`.
7. [ ] Apply the same mapping/mount pattern (including quoted cert mount) to [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.local.yml).
8. [ ] Apply the same mapping/mount pattern (including quoted cert mount) to [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.e2e.yml), and ensure server runtime values are explicitly mapped through compose `environment` entries rather than relying on `server/.env.e2e`.
9. [ ] Add commented/default `CODEINFO_*` placeholders to [.env.e2e](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/.env.e2e) for workflow interpolation parity, and do not duplicate these placeholders into `server/.env.e2e` or `client/.env.e2e`.
10. [ ] Verify wrapper env-file sourcing remains unchanged by checking [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/docker-compose-with-env.sh) and [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package.json): `compose`/`compose:local` must continue using `server/.env` + `server/.env.local`, and e2e must continue using `.env.e2e`.
11. [ ] Add/update test coverage artifact for this task: record compose-config rendering checks (all three compose files, with cert var unset and set) and wrapper env-file source verification evidence in Implementation notes.
12. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) for any new files/folders introduced in this task.
13. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `docker compose -f docker-compose.yml config`
6. [ ] `docker compose -f docker-compose.local.yml config`
7. [ ] `docker compose -f docker-compose.e2e.yml config`
8. [ ] `npm run compose:build` and capture summary/log evidence that wrapper env-file interpolation still works for `server/.env` + `server/.env.local`.
9. [ ] `npm run compose:e2e:build` and capture summary/log evidence that wrapper env-file interpolation uses `.env.e2e`.
10. [ ] With `CODEINFO_CORP_CERTS_DIR` set (for example `/tmp/codeinfo-corp-certs`), run `docker compose -f docker-compose.yml config`, `docker compose -f docker-compose.local.yml config`, and `docker compose -f docker-compose.e2e.yml config` and verify rendered mount source uses the provided path.
11. [ ] Non-destructive negative-path check: run `bash ./scripts/docker-compose-with-env.sh --env-file server/.env --env-file /tmp/nonexistent-codeinfo-local.env -f docker-compose.yml config` and confirm clear failure message with non-zero exit.
12. [ ] Non-destructive negative-path check: run `bash ./scripts/docker-compose-with-env.sh --env-file /tmp/nonexistent-codeinfo-e2e.env -f docker-compose.e2e.yml config` and confirm clear failure message with non-zero exit.

#### Implementation notes

- Capture exact compose mappings added and fallback directory path.
- Record any interpolation pitfalls resolved (unset vs empty variables).

---

### 2. Server Dockerfile Build Wiring: apply npm/pip registry variables across all install stages

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Implement server image build-time handling for npm and pip corporate registry/index variables without changing default behavior when values are unset.

#### Documentation Locations

- [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile)
- [server/npm-global.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/npm-global.txt)
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/
- pip configuration docs: https://pip.pypa.io/en/stable/topics/configuration/

#### Subtasks

1. [ ] Add `ARG` declarations in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile) for `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, and `CODEINFO_NODE_EXTRA_CA_CERTS` in each stage that needs them.
2. [ ] Reuse the existing install command anchors without replacing them (`npm ci --workspaces...`, `python3 -m pip install ...`, and `xargs -r npm install -g --force < /tmp/npm-global.txt`); wrap only the registry/index behavior conditionally around those anchors.
3. [ ] Update the `deps` stage `npm ci` command in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile) to conditionally honor `CODEINFO_NPM_REGISTRY` only when non-empty.
4. [ ] Update runtime global npm install step (`npm install -g`) in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile) to conditionally honor `CODEINFO_NPM_REGISTRY` only when non-empty.
5. [ ] Update runtime pip install step in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile) to conditionally apply `CODEINFO_PIP_INDEX_URL` and `CODEINFO_PIP_TRUSTED_HOST` only when non-empty.
6. [ ] Implement conditional command logic using POSIX-compatible `/bin/sh` patterns (no Bash-only syntax) so Docker build commands remain portable.
7. [ ] Ensure unset/empty values preserve existing default behavior and do not pass malformed/empty flags.
8. [ ] Add/update test coverage artifact for this task: record build log evidence for unset vs set behavior and for an intentionally invalid registry/index failure path in Implementation notes.
9. [ ] If file/folder structure changed, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md).
10. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `npm run compose:build` with registry/index vars unset and confirm success.
6. [ ] `npm run compose:build` with registry/index vars set to test values and confirm command-path usage from logs.
7. [ ] `npm run compose:local:build` and `npm run compose:e2e:build` with registry/index vars unset to confirm server Dockerfile changes do not break other workflows.
8. [ ] Run one build with intentionally invalid registry/index values and confirm failure logs are diagnosable and clearly show the failing install command path.

#### Implementation notes

- Record which Dockerfile stages were changed and why.
- Record how empty-string env handling was implemented.

---

### 3. Client Dockerfile Build Wiring: apply npm registry variable in client build stage

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Implement client build-stage registry override support via `CODEINFO_NPM_REGISTRY` while preserving default npm behavior when unset.

#### Documentation Locations

- [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/Dockerfile)
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/

#### Subtasks

1. [ ] Add `ARG CODEINFO_NPM_REGISTRY` in [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/Dockerfile) build stage.
2. [ ] Reuse the existing client install command anchor (`npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund`) and add registry override conditionally around it instead of replacing the command.
3. [ ] Update client `npm ci` step to use `CODEINFO_NPM_REGISTRY` only when non-empty.
4. [ ] Confirm unset value path remains behaviorally identical to current default install path.
5. [ ] Add/update test coverage artifact for this task: capture build evidence for unset vs set registry behavior.
6. [ ] If structure changed, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md).
7. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `npm run compose:build` with `CODEINFO_NPM_REGISTRY` unset and verify client image build.
6. [ ] `npm run compose:build` with `CODEINFO_NPM_REGISTRY` set and verify client image build.

#### Implementation notes

- Record exact Dockerfile changes and any cache-related observations.

---

### 4. Server Entrypoint Runtime CA Logic: refresh gate, fail-fast behavior, and `NODE_EXTRA_CA_CERTS` export

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Add deterministic runtime cert-refresh behavior in server startup: strict boolean parsing, fail-fast errors for bad cert input, and correct `NODE_EXTRA_CA_CERTS` export before Node starts.

#### Documentation Locations

- [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh)
- [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/config/codexEnvDefaults.ts)
- [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/config/runtimeConfig.ts)
- Node CLI `NODE_EXTRA_CA_CERTS`: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Debian `update-ca-certificates`: https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html

#### Subtasks

1. [ ] Update [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh) to parse `CODEINFO_REFRESH_CA_CERTS_ON_START` using POSIX `sh`-compatible logic, mirroring existing strict normalization semantics from `parseBooleanEnv`/`toBoolean` (`trim` + case-insensitive `true` gate).
2. [ ] Export `NODE_EXTRA_CA_CERTS` from `CODEINFO_NODE_EXTRA_CA_CERTS`, defaulting to `/etc/ssl/certs/ca-certificates.crt` when unset/empty, before launching Node.
3. [ ] Reorder startup flow so cert validation/refresh logic completes before spawning optional background Chrome process.
4. [ ] Implement refresh-enabled path: verify usable `.crt` files exist in `/usr/local/share/ca-certificates/codeinfo-corp`, run `update-ca-certificates`, then continue.
5. [ ] Implement fail-fast path: when refresh is enabled and no usable certs exist (or refresh fails), print clear error and exit non-zero before launching Node.
6. [ ] Keep refresh-disabled path unchanged except for deterministic logging.
7. [ ] Add/update test coverage artifact for this task: capture logs for both positive and negative runtime paths in Implementation notes.
8. [ ] If structure changed, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md).
9. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] Runtime test: `CODEINFO_REFRESH_CA_CERTS_ON_START=true` with valid cert input -> startup succeeds.
6. [ ] Runtime test: `CODEINFO_REFRESH_CA_CERTS_ON_START=true` with missing/invalid cert input -> startup fails with non-zero exit and clear message.
7. [ ] Runtime test: refresh disabled path -> startup succeeds without refresh.
8. [ ] Runtime test: case-insensitive enablement (`CODEINFO_REFRESH_CA_CERTS_ON_START=TrUe`) behaves identically to `true`.
9. [ ] Runtime smoke check after successful startup: verify server health endpoint still responds and no API startup regression was introduced by entrypoint changes.

#### Implementation notes

- Record exact parsing rules implemented.
- Record both success and fail-fast evidence with command/log references.

---

### 5. Host Helper Script: honor npm registry override in `start-gcf-server.sh`

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Update host helper install behavior so restricted-network users can install `git-credential-forwarder` via corporate npm registry when configured.

#### Documentation Locations

- [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/start-gcf-server.sh)
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/

#### Subtasks

1. [ ] Update [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/start-gcf-server.sh) so global npm install uses `CODEINFO_NPM_REGISTRY` when non-empty.
2. [ ] Reuse the existing `npm install -g git-credential-forwarder` command anchor and current script structure (`set -euo pipefail`, env exports, `cygpath` conversion), adding only minimal conditional registry wiring around that install step.
3. [ ] Preserve existing behavior when `CODEINFO_NPM_REGISTRY` is unset.
4. [ ] Confirm existing git path resolution logic (`cygpath` handling and exports) remains unchanged.
5. [ ] Add/update test coverage artifact for this task: record script run evidence for unset and set registry values.
6. [ ] If structure changed, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md).
7. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] Run `start-gcf-server.sh` with `CODEINFO_NPM_REGISTRY` unset and verify behavior.
6. [ ] Run `start-gcf-server.sh` with `CODEINFO_NPM_REGISTRY` set and verify registry override path.

#### Implementation notes

- Record exact script command change and confirm no behavior drift in git path setup.

---

### 6. Documentation Task: README corporate section and workflow-specific setup guidance

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Document corporate setup clearly and precisely so users can configure each workflow without source edits, using the exact section title and placement defined in acceptance criteria.

#### Documentation Locations

- [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md)
- [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/design.md)
- [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md)

#### Subtasks

1. [ ] Add README section `### Corporate Registry and Certificate Overrides (Restricted Networks)` immediately after `### Mac & WSL That have followed the WSL setup above`.
2. [ ] Document canonical `CODEINFO_*` variables and their defaults using the Configuration Semantics section as source of truth.
3. [ ] Add tested concrete `CODEINFO_CORP_CERTS_DIR` example path and expected cert file format (`.crt`).
4. [ ] Document `CODEINFO_REFRESH_CA_CERTS_ON_START=false` default and the fail-fast behavior when enabled without usable certs.
5. [ ] Document workflow split explicitly:
   - `compose`/`compose:local` use `server/.env.local`,
   - e2e uses `.env.e2e`.
6. [ ] Document e2e env behavior explicitly: `.env.e2e` is compose interpolation input for corporate overrides, while `server/.env.e2e` and `client/.env.e2e` remain service runtime defaults.
7. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/design.md) with runtime-flow and env-source details added by this story.
8. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) to reflect new files/folders or changed purpose notes.
9. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] Manual doc validation: verify README section title, placement, and all required content items are present.

#### Implementation notes

- Record exact README insertion point and a brief summary of documented setup steps.

---

### 7. Final Validation and Story Closeout

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Perform end-to-end story validation against acceptance criteria, run full required wrappers, ensure docs are fully aligned, and prepare PR-ready summary material.

#### Documentation Locations

- [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md)
- [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/design.md)
- [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md)
- [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/openapi.json)
- [scripts/test-summary-server-unit.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/test-summary-server-unit.mjs)
- [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/test/unit/openapi.contract.test.ts)
- [server/src/test/unit/openapi.prompts-route.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/test/unit/openapi.prompts-route.test.ts)
- [server/src/test/unit/ws-server.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/test/unit/ws-server.test.ts)
- Docker docs: https://docs.docker.com/

#### Subtasks

1. [ ] Re-check every Acceptance Criteria item and record pass evidence in Implementation notes.
2. [ ] Ensure `README.md` fully reflects the final behavior and commands for this story.
3. [ ] Ensure `design.md` reflects the final runtime behavior and decision points added in this story.
4. [ ] Ensure `projectStructure.md` reflects all file/folder additions and purpose changes.
5. [ ] Verify root `.npmrc` remained unchanged for this story and explicitly record evidence that scoped npm registry mapping, npm auth handling, and proxy variables were not added.
6. [ ] Verify API/WS/storage contract files remain unchanged for this story (`openapi.json`, REST route payload contracts, websocket payload contracts, and Mongo storage shapes), and record evidence.
7. [ ] Reuse existing summary-wrapper targeting (`test:summary:server:unit -- --file ...`) and existing contract tests listed in Documentation Locations; do not add new contract-check scripts for this story.
8. [ ] Verify final file-change scope remains infrastructure-only (`docker-compose*`, Dockerfiles, shell scripts, env/docs) with no `client/src` or `server/src` feature changes.
9. [ ] Create a concise pull request summary comment covering all tasks, key decisions, and testing evidence.
10. [ ] Run full linting/format checks: `npm run lint --workspaces` and `npm run format:check --workspaces`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `npm run compose:build`
6. [ ] `npm run compose:local:build`
7. [ ] `npm run compose:e2e:build`
8. [ ] `npm run test:summary:server:unit`
9. [ ] `npm run test:summary:server:cucumber`
10. [ ] `npm run test:summary:client`
11. [ ] `npm run test:summary:e2e`
12. [ ] Targeted contract guards: `npm run test:summary:server:unit -- --file src/test/unit/openapi.contract.test.ts`
13. [ ] Targeted contract guards: `npm run test:summary:server:unit -- --file src/test/unit/openapi.prompts-route.test.ts`
14. [ ] Targeted protocol guard: `npm run test:summary:server:unit -- --file src/test/unit/ws-server.test.ts`

#### Implementation notes

- Record final acceptance checklist outcomes and links/paths to key logs.
- Include explicit command output/log references for `compose:build`, `compose:local:build`, and `compose:e2e:build`.
- Record proof that `.npmrc` is unchanged and that scoped npm/auth/proxy support was intentionally not introduced.
- Record proof that API/WS/storage contracts remained unchanged (including explicit `openapi.json` unchanged evidence).
