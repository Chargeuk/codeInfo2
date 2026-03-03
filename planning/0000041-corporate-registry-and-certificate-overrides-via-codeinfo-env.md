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
- Updating dependency versions or lockfiles (for example React, MUI, TypeScript, Vite, Express, Mongoose, OpenAI SDK, `ws`, npm major version, or Docker base image tags).

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
- Repository version validation from manifests/lockfile for this story scope:
  - Node runtime/tooling baseline in repo is Node `22` (`node:22-slim` images; `engines.node >=22` in workspaces).
  - npm in this environment is `10.9.4` and README prerequisite is npm `10+`; npm docs references in this story stay on CLI v10 URLs.
  - Frontend dependency resolution is React `19.2.0`, MUI `6.5.0` (resolved from `^6.4.1`), TypeScript `5.9.3`, Vite `7.2.4`; this story remains infra-only and must not modify frontend dependency/interface surfaces.
  - Server dependency resolution includes Express `5.1.0`, Mongoose `9.0.1`, OpenAI SDK `6.24.0`, and `ws` `8.18.3`; this story must not modify API/WS/storage contracts.
- Tooling availability caveat from this research session:
  - `deepwiki` could not be used for this repository because it is not indexed there.
  - `context7` could not be used due API key failure in this environment.
  - MUI MCP docs were available for Material UI `6.4.12`; repository lockfile currently resolves MUI to `6.5.0`, so MUI MCP references are informational only for this story because no MUI component/API work is in scope.

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

### 1. Compose Wiring: map `CODEINFO_*` values and cert mount fallbacks

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Add compose-level build/runtime mappings for the canonical `CODEINFO_*` variables and implement deterministic certificate mount behavior in all compose variants.

#### Documentation Locations

- Context7: `/docker/docs` (Compose file structure, build args, environment entries, volumes).
- Docker Compose variable interpolation: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Docker Compose file reference (services/build/environment/volumes): https://docs.docker.com/reference/compose-file/services/
- Docker Compose env-file behavior: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/

#### Subtasks

1. [ ] Create fallback cert directory and tracked placeholder file [certs/empty-corp-ca/.gitkeep](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/certs/empty-corp-ca/.gitkeep). Command reference: `mkdir -p certs/empty-corp-ca && touch certs/empty-corp-ca/.gitkeep`. Docs: Docker Compose interpolation defaults (`${VAR:-default}`) https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `git status --short` shows the new path.
2. [ ] Edit [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml) and under `services.server.build.args` add exactly these keys: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`. Use interpolation format `KEY: ${KEY:-}` to keep unset behavior unchanged. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `docker compose -f docker-compose.yml config` renders all four args.
3. [ ] In [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml), under `services.client.build.args`, add `CODEINFO_NPM_REGISTRY: ${CODEINFO_NPM_REGISTRY:-}` so the client build can use the same registry override. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `docker compose -f docker-compose.yml config` includes this client build arg.
4. [ ] In [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml), under `services.server.environment`, add `CODEINFO_NODE_EXTRA_CA_CERTS` and `CODEINFO_REFRESH_CA_CERTS_ON_START`, and under `services.server.volumes` add the quoted mount `"${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}:/usr/local/share/ca-certificates/codeinfo-corp:ro"`. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `docker compose -f docker-compose.yml config` shows both env keys and the mounted target path.
5. [ ] Edit [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.local.yml) and apply the same explicit mappings as subtasks 2-4 directly in this file: server build args (`CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`), client build arg (`CODEINFO_NPM_REGISTRY`), server runtime env (`CODEINFO_NODE_EXTRA_CA_CERTS`, `CODEINFO_REFRESH_CA_CERTS_ON_START`), and quoted cert mount (`"${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}:/usr/local/share/ca-certificates/codeinfo-corp:ro"`). Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `docker compose -f docker-compose.local.yml config` renders each of these entries.
6. [ ] Edit [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.e2e.yml) and add the same server/client build args and server runtime env keys from subtasks 2-4, plus the same quoted cert mount, without relying on `server/.env.e2e` to inject missing runtime keys. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `docker compose -f docker-compose.e2e.yml config` shows all required build args, runtime env keys, and the cert mount.
7. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) with one-line purpose entries for [certs/empty-corp-ca/.gitkeep](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/certs/empty-corp-ca/.gitkeep), [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.yml), [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.local.yml), and [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.e2e.yml). Done when each touched path has updated documentation text.
8. [ ] In this task’s `Implementation notes`, add a small evidence table with columns: file changed, key(s) added, verification command, result. Include command references: `docker compose -f docker-compose.yml config`, `docker compose -f docker-compose.local.yml config`, `docker compose -f docker-compose.e2e.yml config`. Done when the notes include all three files and fallback mount evidence.
9. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and their success is recorded in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `docker compose -f docker-compose.yml config`
6. [ ] `docker compose -f docker-compose.local.yml config`
7. [ ] `docker compose -f docker-compose.e2e.yml config`
8. [ ] With `CODEINFO_CORP_CERTS_DIR` set (for example `/tmp/codeinfo-corp-certs`), run `docker compose -f docker-compose.yml config`, `docker compose -f docker-compose.local.yml config`, and `docker compose -f docker-compose.e2e.yml config` and verify rendered mount source uses the provided path.

#### Implementation notes

- Capture exact compose mappings added and fallback directory path.
- Record any interpolation pitfalls resolved (unset vs empty variables).

---

### 2. Env Source Verification: wrapper interpolation and `.env.e2e` parity

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Validate and document env-file source behavior for compose/local/e2e workflows, then add explicit `.env.e2e` placeholders and non-destructive failure checks.

#### Documentation Locations

- Context7: `/docker/docs` (`docker compose --env-file`, interpolation order, and `config` rendering behavior).
- Docker Compose variable interpolation and multiple env files: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Docker Compose CLI `config` reference: https://docs.docker.com/reference/cli/docker/compose/config/

#### Subtasks

1. [ ] In this task’s `Implementation notes`, add a 3-row env-source matrix with columns `Workflow`, `Interpolation Source`, and `Runtime env_file Source`, using exact values: `compose` -> `server/.env + server/.env.local`, `compose:local` -> `server/.env + server/.env.local`, `compose:e2e:*` -> `.env.e2e`; runtime `env_file` entries in compose YAML stay unchanged. Evidence sources: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package.json), [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/docker-compose-with-env.sh), [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.e2e.yml). Done when all three rows exist verbatim.
2. [ ] Edit [.env.e2e](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/.env.e2e) and add placeholders for all six canonical variables exactly once each: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`, `CODEINFO_CORP_CERTS_DIR`, `CODEINFO_REFRESH_CA_CERTS_ON_START`. Add short comments describing default behavior when unset. Docs: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md). Done when `rg -n "^CODEINFO_" .env.e2e` returns six lines.
3. [ ] Verify wrapper source order remains unchanged by inspecting [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/docker-compose-with-env.sh) and script entries in [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package.json): `compose`/`compose:local` must still pass `--env-file server/.env --env-file server/.env.local`; e2e must still pass `--env-file .env.e2e`. Done when these exact flag sequences are visible in file diffs or grep output.
4. [ ] In this task’s `Implementation notes`, record positive and negative command evidence using exact commands from Testing steps 5-8, including exit codes and one key output line per command. Docs: [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/docker-compose-with-env.sh). Done when notes include at least four command/result pairs.
5. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and their results are captured in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `npm run compose:build` and capture summary/log evidence that wrapper env-file interpolation still works for `server/.env` + `server/.env.local`.
6. [ ] `npm run compose:e2e:build` and capture summary/log evidence that wrapper env-file interpolation uses `.env.e2e`.
7. [ ] Non-destructive negative-path check: run `bash ./scripts/docker-compose-with-env.sh --env-file server/.env --env-file /tmp/nonexistent-codeinfo-local.env -f docker-compose.yml config` and confirm non-zero exit plus a missing-env-file indicator in output.
8. [ ] Non-destructive negative-path check: run `bash ./scripts/docker-compose-with-env.sh --env-file /tmp/nonexistent-codeinfo-e2e.env -f docker-compose.e2e.yml config` and confirm non-zero exit plus a missing-env-file indicator in output.

#### Implementation notes

- Record exact env-source verification evidence and command outputs used.

---

### 3. Server Dockerfile Build Wiring: apply npm/pip registry variables across all install stages

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Implement server image build-time handling for npm and pip corporate registry/index variables without changing default behavior when values are unset.

#### Documentation Locations

- Context7: `/docker/docs` (Dockerfile `ARG` scope, multi-stage behavior, `RUN` patterns).
- Docker Build variables (`ARG`, `ENV`): https://docs.docker.com/build/building/variables/
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/
- pip configuration docs: https://pip.pypa.io/en/stable/topics/configuration/
- pip install options: https://pip.pypa.io/en/stable/cli/pip_install/
- POSIX shell command language (`/bin/sh` compatibility): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html

#### Subtasks

1. [ ] Edit [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile) and declare `ARG CODEINFO_NPM_REGISTRY`, `ARG CODEINFO_PIP_INDEX_URL`, `ARG CODEINFO_PIP_TRUSTED_HOST`, and `ARG CODEINFO_NODE_EXTRA_CA_CERTS` in every stage that executes install commands (`deps` stage for `npm ci`, runtime stage for `python3 -m pip install ...` and global npm install). Docs: npm config https://docs.npmjs.com/cli/v10/using-npm/config/, pip config https://pip.pypa.io/en/stable/topics/configuration/. Done when each relevant stage has local `ARG` declarations.
2. [ ] Keep baseline install command anchors exactly unchanged in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile): `npm ci --workspaces --include-workspace-root --no-audit --no-fund`, `python3 -m pip install ...`, and `xargs -r npm install -g --force < /tmp/npm-global.txt` (global package source file [server/npm-global.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/npm-global.txt)). Only add conditional env/flags around these commands. Done when `git diff` shows anchors preserved.
3. [ ] In the `deps` stage of [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile), implement conditional registry wiring so non-empty `CODEINFO_NPM_REGISTRY` applies npm registry override and unset/empty path keeps default npm behavior. Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when logs from set and unset builds show two distinct code paths.
4. [ ] In the runtime stage of [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile), apply `CODEINFO_NPM_REGISTRY` only to the global install path and keep install source file unchanged (`/tmp/npm-global.txt`). Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when global install still resolves package list from `/tmp/npm-global.txt`.
5. [ ] In the runtime stage of [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile), apply `CODEINFO_PIP_INDEX_URL` and `CODEINFO_PIP_TRUSTED_HOST` only when each value is non-empty so unset/empty does not inject malformed flags. Docs: https://pip.pypa.io/en/stable/topics/configuration/. Done when build logs show default pip command for unset values.
6. [ ] Implement all Dockerfile `RUN` conditionals with POSIX `/bin/sh` syntax only (for example `if [ -n "$VAR" ]; then ...; fi`), not Bash-only syntax. Docs: Dockerfile shell behavior in Debian images + npm docs https://docs.npmjs.com/cli/v10/using-npm/config/. Done when `npm run compose:build` succeeds without shell syntax errors.
7. [ ] Validate that empty-string inputs (`CODEINFO_NPM_REGISTRY=`, `CODEINFO_PIP_INDEX_URL=`, `CODEINFO_PIP_TRUSTED_HOST=`) behave the same as unset values by comparing build logs and command output. Docs: pip env behavior https://pip.pypa.io/en/stable/topics/configuration/. Done when no empty-value flags are emitted.
8. [ ] In this task’s `Implementation notes`, add evidence for three scenarios: all vars unset, vars set to valid values, and one intentionally invalid override causing expected non-zero failure. Include command, exit code, and one confirming log line for each scenario. Done when all three rows are documented.
9. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) with any revised purpose text for [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/Dockerfile) and [server/npm-global.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/npm-global.txt). Done when both entries reflect corporate override behavior.
10. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both exit 0 and results are captured in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] `npm run compose:build` with registry/index vars unset and confirm success.
6. [ ] `npm run compose:build` with registry/index vars set to test values and confirm command-path usage from logs.
7. [ ] `npm run compose:local:build` and `npm run compose:e2e:build` with registry/index vars unset to confirm server Dockerfile changes do not break other workflows.
8. [ ] Run one build with intentionally invalid registry/index values and confirm non-zero failure plus clear evidence that override values were applied.

#### Implementation notes

- Record which Dockerfile stages were changed and why.
- Record how empty-string env handling was implemented.

---

### 4. Client Dockerfile Build Wiring: apply npm registry variable in client build stage

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Implement client build-stage registry override support via `CODEINFO_NPM_REGISTRY` while preserving default npm behavior when unset.

#### Documentation Locations

- Context7: `/docker/docs` (Dockerfile `ARG` scope and multi-stage behavior).
- Docker Build variables (`ARG`, `ENV`): https://docs.docker.com/build/building/variables/
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/

#### Subtasks

1. [ ] Edit [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/Dockerfile) and add `ARG CODEINFO_NPM_REGISTRY` in the same build stage that executes `npm ci` (do not add it only to runtime stage). Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when the `ARG` is in scope immediately before the install step.
2. [ ] Keep the existing client install anchor unchanged: `npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund`, then wrap only registry-override behavior around that command. Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when `git diff` confirms anchor text is unchanged.
3. [ ] Implement conditional registry override in [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/Dockerfile) so only non-empty `CODEINFO_NPM_REGISTRY` changes npm behavior; unset/empty uses defaults. Done when both `CODEINFO_NPM_REGISTRY=` and non-empty test runs build.
4. [ ] Verify behavior parity for unset/empty values by comparing install-step logs from unset and empty-string runs and confirming no registry flag is injected. Docs: npm config precedence https://docs.npmjs.com/cli/v10/using-npm/config/. Done when parity evidence is recorded.
5. [ ] In this task’s `Implementation notes`, add evidence for two scenarios (unset vs set) with command used, exit code, and one proving log line each. Done when both scenarios are documented.
6. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) entry for [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/Dockerfile) to mention corporate registry build override behavior. Done when the entry reflects this new purpose.
7. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and results are captured in this task’s `Implementation notes`.

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

### 5. Server Entrypoint Runtime CA Setup: boolean parsing and `NODE_EXTRA_CA_CERTS` defaults

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Implement deterministic runtime env parsing and default CA export behavior in `server/entrypoint.sh` before adding refresh/fail-fast execution paths.

#### Documentation Locations

- POSIX shell command language (`/bin/sh` parsing and conditionals): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html
- Node CLI `NODE_EXTRA_CA_CERTS`: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Docker container environment variables guide: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/

#### Subtasks

1. [ ] Edit [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh) and implement deterministic parsing for `CODEINFO_REFRESH_CA_CERTS_ON_START`: trim whitespace, lowercase value, and treat only `true` as enabled; all other values (including empty/unset) are disabled. Reuse boolean-parsing behavior conventions from [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/config/codexEnvDefaults.ts) and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/config/runtimeConfig.ts). Done when logs show enablement only for `true`/`TrUe`.
2. [ ] In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh), export `NODE_EXTRA_CA_CERTS` to `/etc/ssl/certs/ca-certificates.crt` when `CODEINFO_NODE_EXTRA_CA_CERTS` is empty/unset, otherwise export the provided path. Docs: Node CLI docs https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile. Done when runtime environment prints expected value in both default and override scenarios.
3. [ ] Preserve existing startup structure in [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh): keep Chrome setup block unchanged and insert new cert/env logic immediately before final `exec node dist/index.js`. Done when `git diff` shows minimal movement and startup still reaches `exec node dist/index.js`.
4. [ ] Validate disabled-refresh path (`CODEINFO_REFRESH_CA_CERTS_ON_START` unset, empty, or non-true value) starts server normally without invoking `update-ca-certificates`. Docs: Debian tool behavior https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when container starts and no refresh command appears in logs.
5. [ ] In this task’s `Implementation notes`, record evidence for disabled parsing and mixed-case enablement parsing (`TrUe`) including command, exit code, and one log line per case. Done when both cases are documented explicitly.
6. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) entry for [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh) to mention default `NODE_EXTRA_CA_CERTS` export and refresh gate parsing behavior. Done when the entry reflects both behaviors.
7. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and results are captured in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] Runtime test: refresh disabled path -> startup succeeds without refresh.
6. [ ] Runtime test: case-insensitive enablement gate (`CODEINFO_REFRESH_CA_CERTS_ON_START=TrUe`) is parsed consistently.
7. [ ] Runtime smoke check after startup: verify server health endpoint responds.

#### Implementation notes

- Record exact parsing rules and default export behavior implemented.

---

### 6. Server Entrypoint Runtime CA Refresh: certificate refresh and fail-fast paths

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Implement and verify the refresh-enabled certificate execution path and fail-fast behavior when certificates are missing or invalid.

#### Documentation Locations

- POSIX shell command language (`/bin/sh` parsing and conditionals): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html
- Debian `update-ca-certificates`: https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html
- Node CLI process-start trust-store behavior: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Docker bind mounts and mount-source behavior: https://docs.docker.com/engine/storage/bind-mounts/

#### Subtasks

1. [ ] In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh), implement enabled-refresh path for `CODEINFO_REFRESH_CA_CERTS_ON_START=true`: inspect `/usr/local/share/ca-certificates/codeinfo-corp` for usable `*.crt` files, run `update-ca-certificates`, then continue to Node startup. Docs: Debian CA refresh tool https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when valid-cert scenario starts successfully.
2. [ ] In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh), implement fail-fast behavior for refresh-enabled runs with missing directory, no `*.crt` files, unreadable cert files, or `update-ca-certificates` failure. Exit non-zero before `exec node dist/index.js` and print a clear actionable error message. Docs: Debian tool docs https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when each negative scenario exits non-zero.
3. [ ] In this task’s `Implementation notes`, record evidence for both success and fail-fast paths using commands from Testing steps 5 and 6, including exit code and at least one relevant log line for each path. Done when both paths are documented with command references.
4. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) entry for [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh) to include cert discovery path (`/usr/local/share/ca-certificates/codeinfo-corp`) and fail-fast behavior summary. Done when these runtime details are present.
5. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and are logged in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] Runtime test: `CODEINFO_REFRESH_CA_CERTS_ON_START=true` with valid cert input -> startup succeeds.
6. [ ] Runtime test: `CODEINFO_REFRESH_CA_CERTS_ON_START=true` with missing/invalid cert input -> startup fails with non-zero exit and clear message.
7. [ ] Runtime smoke check after successful startup: verify `GET /version` still responds with expected version payload.
8. [ ] Protocol regression guard after runtime changes: run `npm run test:summary:server:unit -- --file src/test/unit/ws-server.test.ts`.

#### Implementation notes

- Record both success and fail-fast evidence with command/log references.

---

### 7. Host Helper Script: honor npm registry override in `start-gcf-server.sh`

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Update host helper install behavior so restricted-network users can install `git-credential-forwarder` via corporate npm registry when configured.

#### Documentation Locations

- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/
- npm install command docs: https://docs.npmjs.com/cli/v10/commands/npm-install
- POSIX shell command language (`/bin/sh` compatibility): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html

#### Subtasks

1. [ ] Edit [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/start-gcf-server.sh) to conditionally apply `CODEINFO_NPM_REGISTRY` only for the `git-credential-forwarder` global install command. Keep registry wiring limited to that install step so other script behavior is unaffected. Docs: npm config precedence https://docs.npmjs.com/cli/v10/using-npm/config/. Done when set/unset runs follow different install paths as expected.
2. [ ] Preserve the exact command anchor `npm install -g git-credential-forwarder` and existing script scaffolding (`set -euo pipefail`, environment exports, optional `cygpath` conversion). Add only minimal conditional logic around this anchor. Done when `git diff` confirms anchor command still exists verbatim.
3. [ ] Verify default behavior in [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/start-gcf-server.sh) with `CODEINFO_NPM_REGISTRY` unset/empty and confirm install still uses npm defaults. Docs: npm docs https://docs.npmjs.com/cli/v10/using-npm/config/. Done when unset/empty run succeeds without explicit registry override.
4. [ ] Verify existing path-resolution exports are unchanged after edit: `GIT_CREDENTIAL_FORWARDER_GIT_PATH` assignment and `cygpath` branch behavior. File reference: [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/start-gcf-server.sh). Done when diff shows no unrelated logic changes in path handling.
5. [ ] In this task’s `Implementation notes`, capture two evidence blocks (registry unset and registry set) with command, exit code, and one output line proving which path executed. Done when both blocks are present.
6. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) entry for [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/start-gcf-server.sh) to mention optional corporate registry override behavior. Done when entry reflects this change.
7. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and are recorded in this task’s `Implementation notes`.

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

### 8. Documentation Task: README corporate section and workflow-specific setup guidance

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Document corporate setup clearly and precisely so users can configure each workflow without source edits, using the exact section title and placement defined in acceptance criteria.

#### Documentation Locations

- Docker Compose variable interpolation and env files: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- npm config docs (registry behavior): https://docs.npmjs.com/cli/v10/using-npm/config/
- pip configuration docs (index/trusted host behavior): https://pip.pypa.io/en/stable/topics/configuration/
- Node CLI `NODE_EXTRA_CA_CERTS`: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Debian `update-ca-certificates`: https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html

#### Subtasks

1. [ ] In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md), insert heading `### Corporate Registry and Certificate Overrides (Restricted Networks)` immediately below existing heading `### Mac & WSL That have followed the WSL setup above` (no intervening unrelated section). Done when a diff view shows exact placement and exact heading text.
2. [ ] In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md), add a variable table that lists all six canonical variables exactly: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`, `CODEINFO_CORP_CERTS_DIR`, `CODEINFO_REFRESH_CA_CERTS_ON_START`. For each row include “default when unset” and “where used”. Docs: Docker interpolation https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/, Node CA env docs https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile.
3. [ ] In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md), add one concrete cert directory example path (for example `/home/<user>/corp-certs`) and explicitly require `.crt` files in that directory. Docs: Debian CA refresh docs https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when path example and `.crt` requirement are present together.
4. [ ] In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md), state explicitly that `CODEINFO_REFRESH_CA_CERTS_ON_START=false` is the default behavior and that enabling refresh with missing/invalid certs causes startup failure with non-zero exit. Docs: [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/entrypoint.sh), Debian docs https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when both default and fail-fast statements are present.
5. [ ] In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md), document workflow-specific env editing with an explicit two-line rule block: `compose`/`compose:local` edit `server/.env.local`; e2e edit `.env.e2e`. Docs: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package.json), [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/docker-compose-with-env.sh). Done when both rules appear exactly once and are easy to scan.
6. [ ] In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md), explicitly distinguish interpolation vs runtime env sources for e2e: `.env.e2e` feeds compose interpolation, while `server/.env.e2e` and `client/.env.e2e` remain container runtime defaults. File refs: [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/docker-compose.e2e.yml). Done when both concepts are documented in one paragraph.
7. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/design.md) with a short flow description of corporate overrides: compose interpolation -> Docker build args -> entrypoint runtime gate -> Node startup. Include explicit mention that API/WS/storage contracts are unchanged. Done when this sequence appears in design docs.
8. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) entries for changed docs and infra files touched by this story so a new developer can find all related files quickly. Done when each touched file has a current one-line purpose note.
9. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and results are recorded in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up` then `npm run compose:down`
5. [ ] Manual doc validation: verify README section title, placement, and all required content items are present.

#### Implementation notes

- Record exact README insertion point and a brief summary of documented setup steps.

---

### 9. Interface and Dependency Guard Validation

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Run contract and immutability guard checks so this infra-only story cannot change API/WS/storage shapes or dependency versions.

#### Documentation Locations

- OpenAPI Specification (contract baseline): https://spec.openapis.org/oas/v3.1.0
- npm lockfile behavior (`package-lock.json` semantics): https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/
- Node.js test runner docs (`node:test`): https://nodejs.org/docs/latest-v22.x/api/test.html
- Git diff reference (immutability checks): https://git-scm.com/docs/git-diff

#### Subtasks

1. [ ] Validate that root [.npmrc](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/.npmrc) is unchanged by running `git diff -- .npmrc` and checking output is empty. In this task’s `Implementation notes`, explicitly state no scoped registry entries (`@scope:registry`), no npm auth settings, and no proxy settings were introduced. Done when command output evidence is recorded.
2. [ ] Validate API/WS/storage contracts are unchanged by checking `git diff -- openapi.json server/src` and confirming no intended API route shape, WS payload shape, or persisted Mongo shape edits were introduced by this story. Evidence files: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/openapi.json), [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/test/unit/openapi.contract.test.ts), [server/src/test/unit/openapi.prompts-route.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/test/unit/openapi.prompts-route.test.ts), [server/src/test/unit/ws-server.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/src/test/unit/ws-server.test.ts). Done when diff evidence plus tests are recorded.
3. [ ] Validate dependency immutability by running `git diff -- package.json package-lock.json client/package.json server/package.json common/package.json` and confirming no changes. File refs: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package.json), [package-lock.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/package-lock.json), [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/package.json), [server/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/server/package.json), [common/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/common/package.json). Done when command output is empty and logged.
4. [ ] Run targeted contract checks using existing wrapper behavior in [scripts/test-summary-server-unit.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/scripts/test-summary-server-unit.mjs) exactly as listed in Testing steps 1-3; do not add new scripts. Done when all three targeted test runs pass and log paths are captured.
5. [ ] Validate final changed file scope is infra-only by running `git diff --name-only` and confirming changes are limited to compose files, Dockerfiles, shell scripts, env files, and docs (no `client/src/**` edits and no unintended business-logic changes under `server/src/**`). Done when `Implementation notes` includes the file-scope check result.
6. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and are recorded in this task’s `Implementation notes`.

#### Testing

1. [ ] `npm run test:summary:server:unit -- --file src/test/unit/openapi.contract.test.ts`
2. [ ] `npm run test:summary:server:unit -- --file src/test/unit/openapi.prompts-route.test.ts`
3. [ ] `npm run test:summary:server:unit -- --file src/test/unit/ws-server.test.ts`
4. [ ] Dependency immutability guard: `git diff --name-only -- package.json package-lock.json client/package.json server/package.json common/package.json` returns no changes.

#### Implementation notes

- Record proof that `.npmrc` is unchanged and that scoped npm/auth/proxy support was intentionally not introduced.
- Record proof that API/WS/storage contracts remained unchanged (including explicit `openapi.json` unchanged evidence).
- Record proof that dependency manifests/lockfiles were unchanged for this infra-only story.

---

### 10. Final Story Closeout: acceptance verification and PR summary

- Task Status: **__to_do__**
- Git Commits: `none yet`

#### Overview

Perform full end-to-end validation against acceptance criteria, confirm documentation is fully aligned, and prepare PR-ready summary material.

#### Documentation Locations

- Context7: `/docker/docs` (build/compose workflow references for final verification).
- Docker docs (build + compose): https://docs.docker.com/
- npm scripts and run lifecycle docs: https://docs.npmjs.com/cli/v10/using-npm/scripts
- Git diff/log references for release notes evidence: https://git-scm.com/docs

#### Subtasks

1. [ ] Build an explicit Acceptance Criteria checklist table in this task’s `Implementation notes` with columns `AC #`, `Requirement summary`, `Proof (command/log/file)`, and `Pass/Fail`, covering all criteria `1` through `23` from this story. Done when every AC has a proof reference and pass status.
2. [ ] Re-verify [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/README.md) includes exact required heading text and placement, canonical variable list, defaults, cert path example, workflow split, and e2e interpolation/runtime explanation. Done when checklist includes direct line/path evidence for each required item.
3. [ ] Re-verify [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/design.md) documents final runtime decision points (build arg flow, entrypoint refresh gate, fail-fast behavior) and explicitly states interfaces/contracts were unchanged. Done when checklist includes at least one direct quote or line reference summary.
4. [ ] Re-verify [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/projectStructure.md) includes all files/folders changed in this story with updated purpose text. Done when every touched file from `git diff --name-only` has a matching structure entry.
5. [ ] Create a final PR summary comment in this task’s `Implementation notes` containing five sections: changed files, configuration semantics implemented, cert-refresh behavior (success + fail-fast), env-source behavior by workflow, and complete testing evidence list with log paths. Done when all five sections are present.
6. [ ] Run root validation commands from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/AGENTS.md): `npm run lint --workspaces` and `npm run format:check --workspaces`. Done when both commands exit 0 and are recorded in this task’s `Implementation notes`.

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

#### Implementation notes

- Record final acceptance checklist outcomes and links/paths to key logs.
- Include explicit command output/log references for `compose:build`, `compose:local:build`, and `compose:e2e:build`.
