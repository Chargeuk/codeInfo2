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

### Ground Rules For Junior Developers (Single-Subtask Mode)

- You must treat every subtask as standalone: do not assume context from other tasks. Re-read the subtask text fully before editing files.
- Scope guard for every subtask in this story: do not change API/WS/storage contracts (`openapi.json`, request/response shapes, WS message shapes, Mongo shapes) unless the subtask explicitly instructs it.
- Canonical variables that appear repeatedly across subtasks are exactly: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`, `CODEINFO_CORP_CERTS_DIR`, `CODEINFO_REFRESH_CA_CERTS_ON_START`.
- Workflow env-source split that appears repeatedly across subtasks:
  - `compose` and `compose:local` interpolate from `server/.env` + `server/.env.local`.
  - e2e interpolate from `.env.e2e`.
- When a subtask references docs, read the explicit URL in that subtask and also the task-level `Documentation Locations` list.
- Universal baseline links used repeatedly in subtasks:
  - Docker Compose interpolation: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
  - npm config precedence: https://docs.npmjs.com/cli/v10/using-npm/config/

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

### Reuse Matrix (Tasks 1..10)

| Task | Existing files/functions/patterns to reuse | Wording currently implying new mechanism | Exact wording adjustment recommendation |
|---|---|---|---|
| 1 | Reuse env-file flow in [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh:25) and wrapper invocations in [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json:22). Reuse startup env precedence in [server/src/config/startupEnv.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/startupEnv.ts:25). | “with no edits required to ... Dockerfiles, or compose YAML files in their local clone” can be misread as source files never changing. | Replace with: “Developers configure via workflow env files only; implementation updates existing repo wiring so local clones do not require manual source-file edits.” |
| 2 | Reuse canonical variable list in this planning file ([Ground Rules](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md:27)). | Canonical list exists but task text does not explicitly prevent adding extra names. | Replace with: “Do not introduce additional `CODEINFO_*` names for this story; only the listed six variables are in scope.” |
| 3 | Reuse existing compose wrapper behavior in [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh:66) and existing workflow entry points in [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json:22). | Task allows interpretation of a second interpolation mechanism. | Replace with: “Keep the existing wrapper/env-file interpolation chain; do not create a separate compose env interpolation layer.” |
| 4 | Reuse build-arg/env wiring patterns already present in [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml:16), [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml:23), and [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml:19). | “each pass CODEINFO_NPM_REGISTRY...” reads like custom one-off wiring per file. | Replace with: “Extend existing `build.args` and service `environment` blocks with CODEINFO_* values using current compose patterns.” |
| 5 | Reuse existing multi-stage install structure in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile:31), including existing npm/pip install steps at [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile:14), [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile:98), [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile:103). | This can be interpreted as introducing new installation orchestration. | Replace with: “Inject CODEINFO_* into the existing install RUN commands and keep stage layout unchanged.” |
| 6 | Reuse existing client build-stage pattern and ARG/ENV wiring in [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile:4) and [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile:16). | Generic acceptance phrasing could allow new helper scripts. | Replace with: “Extend the existing `client/Dockerfile` npm build stage only; do not add a separate install wrapper.” |
| 7 | Reuse existing npm invocation points in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile:14), [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile:16), and [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh:39). | “npm install steps use that registry…” can suggest custom parser logic. | Replace with: “Use npm config precedence/environment wiring on existing npm commands; no custom registry parser is needed.” |
| 8 | Reuse existing pip install block in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile:98) and env parsing style in [server/src/config/serverPort.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/serverPort.ts:11). | Task text can be read as adding a new pip wrapper. | Replace with: “Set `CODEINFO_PIP_INDEX_URL` and `CODEINFO_PIP_TRUSTED_HOST` directly on the existing pip install command path and preserve default when unset.” |
| 9 | Reuse shell startup flow in [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh:1) with its single `exec node` handoff and `set -e`. | Current wording is high level and can imply a separate startup process. | Replace with: “Implement pre-start CA refresh inside `server/entrypoint.sh` before `exec node dist/index.js`, preserving current startup command shape.” |
| 10 | Reuse existing service volume-mount patterns in [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml:31), [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml:47), and [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml:26). | “mapped to ... not used” does not call out extending current mount style. | Replace with: “Extend the existing server volume section to mount `CODEINFO_CORP_CERTS_DIR` into `/usr/local/share/ca-certificates/codeinfo-corp:ro` with fallback source path.” |

### Additional Reuse Anchors (Mandatory)

- Reuse existing wrapper entry points in [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json) and [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh). Do not create a second compose execution path for this story.
- Reuse existing startup env precedence behavior in [server/src/config/startupEnv.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/startupEnv.ts) and startup flow in [server/src/index.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/index.ts). Do not add a parallel env loader.
- Reuse existing container startup scripts [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), [client/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/entrypoint.sh), and [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh) for observability output; do not introduce new API routes or storage for this story.

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
   - `server/.env.local` missing for `compose`/`compose:local` must fail clearly before build/run begins, with the error surfaced by `docker compose` env-file parsing (the wrapper is pass-through).
   - `.env.e2e` missing or malformed for e2e flows must fail clearly before build/run begins, with the error surfaced by `docker compose` env-file parsing (the wrapper is pass-through).
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
  - npm major version is governed by repo requirements (`10+` in README); no npm patch/version is pinned in repository manifests/lock metadata, so npm CLI v10 docs are the baseline for this story.
  - Frontend dependency resolution is React `19.2.0`, MUI `6.5.0` (resolved from `^6.4.1`), TypeScript `5.9.3`, Vite `7.2.4`; this story remains infra-only and must not modify frontend dependency/interface surfaces.
  - Server dependency resolution includes Express `5.1.0`, Mongoose `9.0.1`, OpenAI SDK `6.24.0`, and `ws` `8.18.3`; test tooling resolution includes Jest `30.2.0`, Playwright `1.56.1`, and Cucumber.js `11.3.0` from lockfile; this story must not modify API/WS/storage contracts.
- Tooling availability caveat from this research session:
  - `deepwiki` was used for upstream libraries (`jestjs/jest`, `microsoft/playwright`, `cucumber/cucumber-js`), but this repository itself is not indexed there.
  - `context7` could not be used due API key failure in this environment.
  - MUI MCP docs were available for Material UI `6.4.12`; repository lockfile currently resolves MUI to `6.5.0`, so MUI MCP references are informational only for this story because no MUI component/API work is in scope.
  - Jest 30 guidance check: direct CLI option rename (`--testPathPattern` -> `--testPathPatterns`) is already abstracted by repo wrapper `test:summary:client -- --subset`, so no task changes are required to targeted-run commands.
    - https://jestjs.io/docs/upgrading-to-jest30
  - Playwright filtering check: file selectors plus `--grep` remain valid for targeted runs and align with current wrapper behavior.
    - https://playwright.dev/docs/test-cli
  - Cucumber filtering check: tags/name/path filtering remains valid; wrapper-level `--scenario` maps to Cucumber `--name`.
    - https://github.com/cucumber/cucumber-js/blob/main/docs/filtering.md

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
   - Keep `scripts/docker-compose-with-env.sh` as a pass-through wrapper; do not add custom env-file parsing/validation there for this story.
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
10. If a task creates or removes tracked files, include and complete a `projectStructure.md` update subtask immediately after the file add/remove subtasks and before test/evidence subtasks.

## Tasks

### 1. Compose Wiring: map `CODEINFO_*` values and cert mount fallbacks

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Add compose-level build/runtime mappings for the canonical `CODEINFO_*` variables and implement deterministic certificate mount behavior in all compose variants.

#### Documentation Locations

- Docker Compose variable interpolation: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ (required for `${VAR:-default}` fallback semantics used by cert mount and build args).
- Docker Compose services reference: https://docs.docker.com/reference/compose-file/services/ (authoritative keys and shapes for `build.args`, `environment`, and `volumes` blocks).
- Docker Compose environment-variable usage: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ (clarifies how `environment` and env files are applied at runtime).
- Docker Compose `config` command reference: https://docs.docker.com/reference/cli/docker/compose/config/ (used to validate rendered config for unset/set variable scenarios).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Create fallback cert directory and tracked placeholder file [certs/empty-corp-ca/.gitkeep](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/certs/empty-corp-ca/.gitkeep). Command reference: `mkdir -p certs/empty-corp-ca && touch certs/empty-corp-ca/.gitkeep`. Docs: Docker Compose interpolation defaults (`${VAR:-default}`) https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `git status --short` shows the new path.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. File-structure documentation subtask (must be completed immediately after all add/remove subtasks in this task and before test/evidence subtasks). Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) with one-line purpose entries for every file added or removed by this task: added file [certs/empty-corp-ca/.gitkeep](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/certs/empty-corp-ca/.gitkeep), removed files `none`. Done when the added/removed file list is explicit in this subtask and the corresponding project structure entry is updated.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Edit [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml) and under `services.server.build.args` add exactly these keys: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`. Use interpolation format `KEY: ${KEY:-}` to keep unset behavior unchanged. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when the corresponding Task 1 Testing config-render checks confirm all four args.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml), under `services.client.build.args`, add `CODEINFO_NPM_REGISTRY: ${CODEINFO_NPM_REGISTRY:-}` so the client build can use the same registry override. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when the corresponding Task 1 Testing config-render checks confirm the client build arg.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml), under `services.server.environment`, add `CODEINFO_NODE_EXTRA_CA_CERTS` and `CODEINFO_REFRESH_CA_CERTS_ON_START`, and under `services.server.volumes` add the quoted mount `"${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}:/usr/local/share/ca-certificates/codeinfo-corp:ro"`. Docs: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when the corresponding Task 1 Testing config-render checks confirm env keys and mount target.
6. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml), add server build args only: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS` using `${KEY:-}` interpolation. Done when local config-render checks show all four server build args.
7. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml), add client build arg only: `CODEINFO_NPM_REGISTRY: ${CODEINFO_NPM_REGISTRY:-}`. Done when local config-render checks show the client build arg.
8. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml), add server runtime env keys only: `CODEINFO_NODE_EXTRA_CA_CERTS` and `CODEINFO_REFRESH_CA_CERTS_ON_START`. Done when local config-render checks show both runtime env keys.
9. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml), add only the quoted cert mount `"${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}:/usr/local/share/ca-certificates/codeinfo-corp:ro"`. Done when local config-render checks show the expected mount target.
10. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml), add server build args only: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS` using `${KEY:-}` interpolation. Done when e2e config-render checks show all four server build args.
11. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml), add client build arg only: `CODEINFO_NPM_REGISTRY: ${CODEINFO_NPM_REGISTRY:-}`. Done when e2e config-render checks show the client build arg.
12. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml), add server runtime env keys only: `CODEINFO_NODE_EXTRA_CA_CERTS` and `CODEINFO_REFRESH_CA_CERTS_ON_START`, without relying on `server/.env.e2e` for missing keys. Done when e2e config-render checks show both runtime env keys.
13. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml), add only the quoted cert mount `"${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}:/usr/local/share/ca-certificates/codeinfo-corp:ro"`. Done when e2e config-render checks show the expected mount target.
14. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Architecture documentation subtask. Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with a concise text section for compose wiring flow (env sources -> compose interpolation -> build args/runtime env -> cert mount target). No new Mermaid diagram is required; only update existing diagram content if it is straightforward. Done when the text section reflects Task 1 behavior.
15. [ ] Add a structured runtime observability line for compose wiring in [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh): `[CODEINFO][T01_COMPOSE_WIRING_APPLIED] corp_certs_mount_source=<path> npm_registry_set=<true|false> pip_index_set=<true|false> pip_trusted_host_set=<true|false>`. Reuse existing env values already passed through compose by computing `corp_certs_mount_source=${CODEINFO_CORP_CERTS_DIR:-./certs/empty-corp-ca}` and deriving boolean flags from non-empty registry/index/trusted-host values. Emit once during server startup before `exec node dist/index.js`. Done when Task 10 compose-log assertions can find this token with all fields populated.
16. [ ] Validate deterministic compose rendering for cert mount fallback with `CODEINFO_CORP_CERTS_DIR` unset by running `docker compose ... config` for `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`. Record evidence that each render includes `/usr/local/share/ca-certificates/codeinfo-corp:ro` and never mounts host `/etc/ssl/certs`. Done when three unset-case render outputs are documented.
17. [ ] Validate deterministic compose rendering for cert mount override with `CODEINFO_CORP_CERTS_DIR` set by running `docker compose ... config` for `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`. Record evidence that each render includes `/usr/local/share/ca-certificates/codeinfo-corp:ro` and never mounts host `/etc/ssl/certs`. Done when three set-case render outputs are documented.
18. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.

#### Implementation notes

- Capture exact compose mappings added and fallback directory path.
- Record any interpolation pitfalls resolved (unset vs empty variables).
- Record config-render evidence for `CODEINFO_CORP_CERTS_DIR` unset/set across all three compose files.

---

### 2. Env Source Verification: compose interpolation and wrapper env-file pass-through parity

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Validate and document env-file source behavior for compose/local/e2e workflows, confirm wrapper pass-through behavior, then add explicit `.env.e2e` placeholders and non-destructive failure checks.

#### Documentation Locations

- Docker Compose variable interpolation and multi-env-file behavior: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ (source of truth for interpolation precedence and default syntax).
- Docker Compose `config` command reference: https://docs.docker.com/reference/cli/docker/compose/config/ (required to verify effective config under positive/negative env-file checks).
- Docker Compose env-variable usage guide: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ (documents how env-file inputs and `environment` entries are consumed).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In this task’s `Implementation notes`, add a 3-row env-source matrix with columns `Workflow`, `Interpolation Source`, and `Runtime env_file Source`, using exact values: `compose` -> `server/.env + server/.env.local`, `compose:local` -> `server/.env + server/.env.local`, `compose:e2e:*` -> `.env.e2e`; runtime `env_file` entries in compose YAML stay unchanged. Evidence sources: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json), [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh), [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml). Done when all three rows exist verbatim.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Edit [.env.e2e](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/.env.e2e) and add placeholders for all six canonical variables exactly once each: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`, `CODEINFO_CORP_CERTS_DIR`, `CODEINFO_REFRESH_CA_CERTS_ON_START`. Add short comments describing default behavior when unset. Docs: Docker Compose interpolation/env-file docs https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. Done when `rg -n "^CODEINFO*" .env.e2e` returns six lines.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Verify wrapper source order remains unchanged by inspecting [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh) and script entries in [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json): `compose`/`compose:local` must still pass `--env-file server/.env --env-file server/.env.local`; e2e must still pass `--env-file .env.e2e`. Document that interpolation/parse failures are emitted by `docker compose` (wrapper is pass-through). Done when these exact flag sequences and pass-through behavior are recorded in task notes.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Before any positive `compose`/`compose:local` validation command in this task, ensure local untracked [server/.env.local](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/.env.local) exists. If absent, create it with `cp server/.env server/.env.local`. Do not add/commit this file. Done when positive-path checks can run and `git status --short` does not show a tracked diff for this path.
5. [ ] Validate wrapper pass-through failure behavior for missing local compose env source by temporarily moving `server/.env.local`, running `npm run compose:build`, confirming `docker compose` env-file parse failure is surfaced unchanged, then restoring `server/.env.local`. Do not commit any changes to env files. Done when failure output and restoration proof are recorded.
6. [ ] Validate wrapper pass-through failure behavior for missing e2e env source by temporarily moving `.env.e2e`, running `npm run compose:e2e:build`, confirming `docker compose` env-file parse failure is surfaced unchanged, then restoring `.env.e2e`. Do not commit any changes to env files. Done when failure output and restoration proof are recorded.
7. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Architecture documentation subtask. Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with concise text describing env-source flow (`compose`/`compose:local` using `server/.env` + `server/.env.local`; `compose:e2e` using `.env.e2e`; runtime `env_file` separation). No new Mermaid diagram is required; only update existing diagram content if it is straightforward. Done when the text reflects Task 2 behavior.
8. [ ] In [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh), add only the env-source handoff exports before `exec docker compose`: `CODEINFO_COMPOSE_WORKFLOW`, `CODEINFO_INTERPOLATION_SOURCE`, and `CODEINFO_RUNTIME_ENV_FILE_SOURCE`. Keep wrapper pass-through behavior unchanged. Done when environment export lines are present and wrapper command shape is unchanged.
9. [ ] In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), emit `[CODEINFO][T02_ENV_SOURCE_RESOLVED] workflow=<compose|compose-local|e2e> interpolation_source=<server/.env+server/.env.local|.env.e2e> runtime_env_file=<unchanged|value>` using wrapper-exported values (`runtime_env_file` sourced from `CODEINFO_RUNTIME_ENV_FILE_SOURCE`). Done when Task 10 compose-log assertions can verify this token for the active workflow.
10. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.

#### Implementation notes

- Record exact env-source verification evidence and command outputs used.

---

### 3. Server Dockerfile Build Wiring: apply npm/pip registry variables across all install stages

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Implement server image build-time handling for npm and pip corporate registry/index variables without changing default behavior when values are unset.

#### Documentation Locations

- Docker Build variables (`ARG`, `ENV`): https://docs.docker.com/build/building/variables/ (defines build-time variable scope across Dockerfile stages).
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/ (covers multi-stage patterns and `RUN` execution behavior used in this task).
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/ (authoritative precedence for registry override behavior).
- pip configuration docs: https://pip.pypa.io/en/stable/topics/configuration/ (defines `PIP_INDEX_URL` and `PIP_TRUSTED_HOST` behavior, including empty env handling).
- pip install options: https://pip.pypa.io/en/stable/cli/pip_install/ (verifies valid flags and expected install-time argument forms).
- POSIX shell command language (`/bin/sh` compatibility): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html (required because Dockerfile `RUN` logic must remain POSIX-compliant).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Edit [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile) and declare `ARG CODEINFO_NPM_REGISTRY`, `ARG CODEINFO_PIP_INDEX_URL`, `ARG CODEINFO_PIP_TRUSTED_HOST`, and `ARG CODEINFO_NODE_EXTRA_CA_CERTS` in every stage that executes install commands (`deps` stage for `npm ci`, runtime stage for `python3 -m pip install ...` and global npm install). Docs: npm config https://docs.npmjs.com/cli/v10/using-npm/config/, pip config https://pip.pypa.io/en/stable/topics/configuration/. Done when each relevant stage has local `ARG` declarations.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Keep baseline install command anchors exactly unchanged in [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile): `npm ci --workspaces --include-workspace-root --no-audit --no-fund`, `python3 -m pip install ...`, and `xargs -r npm install -g --force < /tmp/npm-global.txt` (global package source file [server/npm-global.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/npm-global.txt)). Only add conditional env/flags around these commands. Done when `git diff` shows anchors preserved.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In the `deps` stage of [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile), implement conditional registry wiring so non-empty `CODEINFO_NPM_REGISTRY` applies npm registry override and unset/empty path keeps default npm behavior. Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when logs from set and unset builds show two distinct code paths.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In the runtime stage of [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile), apply `CODEINFO_NPM_REGISTRY` only to the global install path and keep install source file unchanged (`/tmp/npm-global.txt`). Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when global install still resolves package list from `/tmp/npm-global.txt`.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In the runtime stage of [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile), apply `CODEINFO_PIP_INDEX_URL` and `CODEINFO_PIP_TRUSTED_HOST` only when each value is non-empty so unset/empty does not inject malformed flags. Docs: https://pip.pypa.io/en/stable/topics/configuration/. Done when build logs show default pip command for unset values.
6. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Implement all Dockerfile `RUN` conditionals with POSIX `/bin/sh` syntax only (for example `if [ -n "$VAR" ]; then ...; fi`), not Bash-only syntax. Docs: Dockerfile shell behavior in Debian images + npm docs https://docs.npmjs.com/cli/v10/using-npm/config/. Done when Task 3 Testing build steps confirm no shell syntax failures.
7. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Validate that empty-string inputs (`CODEINFO_NPM_REGISTRY=`, `CODEINFO_PIP_INDEX_URL=`, `CODEINFO_PIP_TRUSTED_HOST=`) behave the same as unset values by comparing build logs and command output. Docs: pip env behavior https://pip.pypa.io/en/stable/topics/configuration/. Done when no empty-value flags are emitted.
8. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) with any revised purpose text for [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile) and [server/npm-global.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/npm-global.txt). Done when both entries reflect corporate override behavior.
9. [ ] Add a structured runtime observability line for server build overrides by introducing an explicit build-to-runtime metadata handoff between [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile) and [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh): `[CODEINFO][T03_SERVER_BUILD_OVERRIDE_STATE] npm_registry_override=<on|off> pip_index_override=<on|off> pip_trusted_host_override=<on|off>`. Persist the state in Dockerfile using runtime-visible env/file metadata, then read and emit it in entrypoint. Keep default behavior unchanged when values are unset. Done when Task 10 compose-log assertions can confirm the token and all three fields.
10. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.

#### Implementation notes

- Record which Dockerfile stages were changed and why.
- Record how empty-string env handling was implemented.

---

### 4. Client Dockerfile Build Wiring: apply npm registry variable in client build stage

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Implement client build-stage registry override support via `CODEINFO_NPM_REGISTRY` while preserving default npm behavior when unset.

#### Documentation Locations

- Docker Build variables (`ARG`, `ENV`): https://docs.docker.com/build/building/variables/ (defines where `ARG CODEINFO_NPM_REGISTRY` must be declared for client build stage visibility).
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/ (documents stage boundaries and `RUN` command execution rules).
- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/ (source of truth for registry override semantics and defaults when unset).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Edit [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile) and add `ARG CODEINFO_NPM_REGISTRY` in the same build stage that executes `npm ci` (do not add it only to runtime stage). Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when the `ARG` is in scope immediately before the install step.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Keep the existing client install anchor unchanged: `npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund`, then wrap only registry-override behavior around that command. Docs: https://docs.npmjs.com/cli/v10/using-npm/config/. Done when `git diff` confirms anchor text is unchanged.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Implement conditional registry override in [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile) so only non-empty `CODEINFO_NPM_REGISTRY` changes npm behavior; unset/empty uses defaults. Done when both `CODEINFO_NPM_REGISTRY=` and non-empty test runs build.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Verify behavior parity for unset/empty values by comparing install-step logs from unset and empty-string runs and confirming no registry flag is injected. Docs: npm config precedence https://docs.npmjs.com/cli/v10/using-npm/config/. Done when parity evidence is recorded.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) entry for [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile) to mention corporate registry build override behavior. Done when the entry reflects this new purpose.
6. [ ] Add a structured runtime observability line for client build override state by persisting client build-time registry mode from [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile) and emitting it from [client/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/entrypoint.sh) during container startup: `[CODEINFO][T04_CLIENT_BUILD_OVERRIDE_STATE] client_npm_registry_override=<on|off>`. Ensure unset/empty values report `off`. Done when Task 10 compose-log assertions can find this token with the expected mode.
7. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
4. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [ ] `npm run compose:up`
6. [ ] Manual Playwright-MCP check (run only after `npm run compose:up`; do not replace with local browser checks): open http://host.docker.internal:5001, capture screenshots for the task UI outcomes (at minimum `task-04-home-load.png` showing the app shell loaded and `task-04-console-clean.png` showing browser developer console state), save screenshots to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output` (this path is mapped via `docker-compose.yml`), and have the agent review the saved screenshots to confirm GUI expectations for this task are met (page renders correctly, no obvious layout breakage, and no unexpected browser console errors/exceptions). Token `[CODEINFO][T04_CLIENT_BUILD_OVERRIDE_STATE]` must be validated via compose logs, not Playwright UI logs.
7. [ ] `npm run compose:down`

#### Implementation notes

- Record exact Dockerfile changes and any cache-related observations.

---

### 5. Server Entrypoint Runtime CA Setup: boolean parsing and `NODE_EXTRA_CA_CERTS` defaults

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Implement deterministic runtime env parsing and default CA export behavior in `server/entrypoint.sh` before adding refresh/fail-fast execution paths.

#### Documentation Locations

- POSIX shell command language (`/bin/sh` parsing and conditionals): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html
- Node CLI `NODE_EXTRA_CA_CERTS`: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Docker container environment variables guide: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/
- Debian `update-ca-certificates`: https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html (needed for validating refresh-disabled checks that assert refresh command is not invoked).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Edit [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh) and implement deterministic parsing for `CODEINFO_REFRESH_CA_CERTS_ON_START`: trim whitespace, lowercase value, and treat only `true` as enabled; all other values (including empty/unset) are disabled. Use [server/src/config/codexEnvDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexEnvDefaults.ts) and [server/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts) as semantic references only; implement parsing directly in POSIX shell (no TS reuse/import). Done when logs show enablement only for `true`, `TrUe`, and whitespace-padded true values.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), export `NODE_EXTRA_CA_CERTS` to `/etc/ssl/certs/ca-certificates.crt` when `CODEINFO_NODE_EXTRA_CA_CERTS` is empty/unset, otherwise export the provided path. Docs: Node CLI docs https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile. Done when runtime environment prints expected value in both default and override scenarios.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Preserve existing startup structure in [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh): keep Chrome setup block unchanged and insert new cert/env logic immediately before final `exec node dist/index.js`. Done when `git diff` shows minimal movement and startup still reaches `exec node dist/index.js`.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Validate disabled-refresh path (`CODEINFO_REFRESH_CA_CERTS_ON_START` unset, empty, or non-true value) starts server normally without invoking `update-ca-certificates`. Docs: Debian tool behavior https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when container starts and no refresh command appears in logs.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Architecture documentation subtask. Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with concise text for runtime gate flow (refresh flag parse -> `NODE_EXTRA_CA_CERTS` export -> optional refresh branch -> Node startup). No new Mermaid diagram is required; only update existing diagram content if it is straightforward. Done when the text reflects Task 5 behavior.
6. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) entry for [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh) to mention default `NODE_EXTRA_CA_CERTS` export and refresh gate parsing behavior. Done when the entry reflects both behaviors.
7. [ ] Add a structured runtime observability line in [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh) after `NODE_EXTRA_CA_CERTS` is resolved: `[CODEINFO][T05_NODE_EXTRA_CA_CERTS_RESOLVED] value=<effective-path> source=<default|override> refresh_requested=<true|false>`. Emit this line before any refresh branch executes. Done when Task 10 compose-log assertions can confirm path and source fields.
8. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.

#### Implementation notes

- Record exact parsing rules and default export behavior implemented.

---

### 6. Server Entrypoint Runtime CA Refresh: certificate refresh and fail-fast paths

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Implement and verify the refresh-enabled certificate execution path and fail-fast behavior when certificates are missing or invalid.

#### Documentation Locations

- POSIX shell command language (`/bin/sh` parsing and conditionals): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html
- Debian `update-ca-certificates`: https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html
- Node CLI process-start trust-store behavior: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile
- Docker bind mounts and mount-source behavior: https://docs.docker.com/engine/storage/bind-mounts/

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), implement enabled-refresh path for `CODEINFO_REFRESH_CA_CERTS_ON_START=true`: inspect `/usr/local/share/ca-certificates/codeinfo-corp` for usable `*.crt` files, run `update-ca-certificates`, then continue to Node startup. Docs: Debian CA refresh tool https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when valid-cert scenario starts successfully.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), implement fail-fast behavior for refresh-enabled runs when the cert directory is missing. Exit non-zero before `exec node dist/index.js` and print a clear actionable error message. Docs: Debian tool docs https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when the missing-directory scenario exits non-zero.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), implement fail-fast behavior for refresh-enabled runs when no usable `*.crt` files are present. Exit non-zero before `exec node dist/index.js` and print a clear actionable error message. Done when the no-crt scenario exits non-zero.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), implement fail-fast behavior for refresh-enabled runs with unreadable certificate files. Exit non-zero before `exec node dist/index.js` and print a clear actionable error message. Done when the unreadable-cert scenario exits non-zero.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), implement fail-fast behavior for refresh-enabled runs when `update-ca-certificates` returns an error. Exit non-zero before `exec node dist/index.js` and print a clear actionable error message. Done when the refresh-command-failure scenario exits non-zero.
6. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Architecture documentation subtask. Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with concise text for refresh branch flow (enabled + valid certs -> refresh -> startup; enabled + invalid/missing certs -> fail-fast exit). No new Mermaid diagram is required; only update existing diagram content if it is straightforward. Done when the text reflects Task 6 behavior.
7. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) entry for [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh) to include cert discovery path (`/usr/local/share/ca-certificates/codeinfo-corp`) and fail-fast behavior summary. Done when these runtime details are present.
8. [ ] Add a structured runtime observability line in [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh) for CA refresh outcomes: `[CODEINFO][T06_CA_REFRESH_RESULT] refresh_enabled=<true|false> result=<skipped|success|failed> crt_count=<number> cert_dir=/usr/local/share/ca-certificates/codeinfo-corp`. Implement this directly in the refresh branch control flow (no separate logging framework), and emit on skipped, success, and fail-fast paths with deterministic field names. Done when Task 10 compose-log assertions can validate result matches the executed scenario.
9. [ ] Execute and record runtime cert success scenario using wrapper-driven compose runs: refresh enabled + valid `.crt` input => startup success. Include exact command, exit code, and log evidence in this task’s Implementation notes.
10. [ ] Execute and record runtime cert fail-fast scenario using wrapper-driven compose runs: refresh enabled + missing/invalid `.crt` input => non-zero exit. Include exact command, exit code, and log evidence in this task’s Implementation notes.
11. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.

#### Implementation notes

- Record both success and fail-fast evidence with command/log references.

---

### 7. Host Helper Script: honor npm registry override in `start-gcf-server.sh`

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Update host helper install behavior so restricted-network users can install `git-credential-forwarder` via corporate npm registry when configured, and validate command-shape logic with non-destructive script harnesses.

#### Documentation Locations

- npm config docs: https://docs.npmjs.com/cli/v10/using-npm/config/ (defines registry precedence and expected behavior for env-driven override).
- npm install command docs: https://docs.npmjs.com/cli/v10/commands/npm-install (confirms supported global-install invocation used by helper script).
- POSIX shell command language (`/bin/sh` compatibility): https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html (ensures script conditionals remain portable and non-Bash-specific).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Edit [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh) to conditionally apply `CODEINFO_NPM_REGISTRY` only for the `git-credential-forwarder` global install command. Keep registry wiring limited to that install step so other script behavior is unaffected. Docs: npm config precedence https://docs.npmjs.com/cli/v10/using-npm/config/. Done when set/unset runs follow different install paths as expected.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Preserve the exact command anchor `npm install -g git-credential-forwarder` and existing script scaffolding (`set -euo pipefail`, environment exports, optional `cygpath` conversion). Add only minimal conditional logic around this anchor. For validation, do not perform uncontrolled host global installs; use disposable/mocked command harnesses. Done when `git diff` confirms anchor command still exists verbatim.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Verify default behavior in [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh) with `CODEINFO_NPM_REGISTRY` unset/empty using a temporary PATH shim that provides mock `npm`/`gcf-server` executables and captures arguments. Docs: npm docs https://docs.npmjs.com/cli/v10/using-npm/config/. Done when captured command output shows no registry override argument/env for unset/empty cases.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Verify existing path-resolution exports are unchanged after edit: `GIT_CREDENTIAL_FORWARDER_GIT_PATH` assignment and `cygpath` branch behavior. File reference: [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh). Done when diff shows no unrelated logic changes in path handling.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Architecture documentation subtask. Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with concise text for host-helper install flow (unset registry -> default npm path; set registry -> override path; invalid registry -> error path). No new Mermaid diagram is required; only update existing diagram content if it is straightforward. Done when the text reflects Task 7 behavior.
6. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) entry for [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh) to mention optional corporate registry override behavior. Done when entry reflects this change.
7. [ ] Add a structured host-helper observability line in [start-gcf-server.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/start-gcf-server.sh): `[CODEINFO][T07_GCF_INSTALL_REGISTRY_STATE] registry_override=<on|off> install_target=git-credential-forwarder`. Emit immediately before the global install command. Done when host helper command-output evidence confirms this token after helper execution (or record `not triggered` if helper flow was intentionally skipped).
8. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Record exact script command change and confirm no behavior drift in git path setup.

---

### 8. Documentation Task: README corporate section and workflow-specific setup guidance

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Document corporate setup clearly and precisely so users can configure each workflow without source edits, using the exact section title and placement defined in acceptance criteria.

#### Documentation Locations

- Docker Compose variable interpolation and env files: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ (documents defaults/fallback behavior that README must describe accurately).
- npm config docs (registry behavior): https://docs.npmjs.com/cli/v10/using-npm/config/ (provides wording basis for npm override behavior in docs).
- pip configuration docs (index/trusted host behavior): https://pip.pypa.io/en/stable/topics/configuration/ (provides wording basis for pip override behavior in docs).
- Node CLI `NODE_EXTRA_CA_CERTS`: https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile (needed for documenting runtime CA-path defaults).
- Debian `update-ca-certificates`: https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html (needed for documenting cert-refresh preconditions and failure behavior).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), insert heading `### Corporate Registry and Certificate Overrides (Restricted Networks)` immediately below existing heading `### Mac & WSL That have followed the WSL setup above` (no intervening unrelated section). Done when a diff view shows exact placement and exact heading text.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), add a variable table that lists all six canonical variables exactly: `CODEINFO_NPM_REGISTRY`, `CODEINFO_PIP_INDEX_URL`, `CODEINFO_PIP_TRUSTED_HOST`, `CODEINFO_NODE_EXTRA_CA_CERTS`, `CODEINFO_CORP_CERTS_DIR`, `CODEINFO_REFRESH_CA_CERTS_ON_START`. For each row include “default when unset” and “where used”. Docs: Docker interpolation https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/, Node CA env docs https://nodejs.org/docs/latest-v22.x/api/cli.html#node_extra_ca_certsfile.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), add one concrete cert directory example path (for example `/home/<user>/corp-certs`) and explicitly require `.crt` files in that directory. Docs: Debian CA refresh docs https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when path example and `.crt` requirement are present together.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), state explicitly that `CODEINFO_REFRESH_CA_CERTS_ON_START=false` is the default behavior and that enabling refresh with missing/invalid certs causes startup failure with non-zero exit. Docs: [server/entrypoint.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/entrypoint.sh), Debian docs https://manpages.debian.org/testing/ca-certificates/update-ca-certificates.8.en.html. Done when both default and fail-fast statements are present.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), document workflow-specific env editing with an explicit two-line rule block: `compose`/`compose:local` edit `server/.env.local`; e2e edit `.env.e2e`. Docs: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json), [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh). Done when both rules appear exactly once and are easy to scan.
6. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. In [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), explicitly distinguish interpolation vs runtime env sources for e2e: `.env.e2e` feeds compose interpolation, while `server/.env.e2e` and `client/.env.e2e` remain container runtime defaults. File refs: [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml). Done when both concepts are documented in one paragraph.
7. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Architecture documentation subtask. Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) with concise text for end-to-end corporate override flow: env source selection -> compose interpolation -> Docker build overrides -> entrypoint runtime gate -> success/fail-fast startup, and include explicit note that API/WS/storage contracts remain unchanged. No new Mermaid diagram is required; only update existing diagram content if it is straightforward. Done when the text reflects this story behavior.
8. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) entries for changed docs and infra files touched by this story so a new developer can find all related files quickly. Done when each touched file has a current one-line purpose note.
9. [ ] Documentation parity evidence subtask. In this task’s `Implementation notes`, add a checklist that proves README heading placement, canonical variable table, defaults, cert path example, and workflow split match acceptance criteria. Do not add a runtime observability token for docs parity. Done when each README requirement has direct file/line evidence in the checklist.
10. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.

#### Implementation notes

- Record exact README insertion point and a brief summary of documented setup steps.

---

### 9. Interface and Dependency Guard Validation

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Run contract and immutability guard checks so this infra-only story cannot change API/WS/storage shapes or dependency versions.

#### Documentation Locations

- OpenAPI Specification (contract baseline): https://spec.openapis.org/oas/v3.1.0 (used to confirm API contract invariants when checking `openapi.json` drift).
- npm lockfile behavior (`package-lock.json` semantics): https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/ (used for dependency immutability checks).
- npm `.npmrc` documentation: https://docs.npmjs.com/cli/v10/configuring-npm/npmrc/ (used to validate no scoped registry/auth/proxy policy changes were introduced).
- Node.js test runner docs (`node:test`): https://nodejs.org/docs/latest-v22.x/api/test.html (applies to targeted server unit test wrapper expectations).
- Git diff reference (immutability checks): https://git-scm.com/docs/git-diff (source of truth for exact diff commands used in validation subtasks).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Validate that root [.npmrc](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/.npmrc) is unchanged by running `git diff -- .npmrc` and checking output is empty. In this task’s `Implementation notes`, explicitly state no scoped registry entries (`@scope:registry`), no npm auth settings, and no proxy settings were introduced. Done when command output evidence is recorded.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Validate API/WS/storage contracts are unchanged by checking `git diff -- openapi.json server/src` and confirming no intended API route shape, WS payload shape, or persisted Mongo shape edits were introduced by this story. Evidence files: [openapi.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/openapi.json), [server/src/test/unit/openapi.contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.contract.test.ts), [server/src/test/unit/openapi.prompts-route.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openapi.prompts-route.test.ts), [server/src/test/unit/ws-server.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/ws-server.test.ts). Done when diff evidence plus tests are recorded.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Validate dependency immutability by running `git diff -- package.json package-lock.json client/package.json server/package.json common/package.json` and confirming no changes. File refs: [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json), [package-lock.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package-lock.json), [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/package.json), [server/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/package.json), [common/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/common/package.json). Done when command output is empty and logged.
4. [ ] Guard evidence subtask. In this task’s `Implementation notes`, record guard outcomes (`openapi_unchanged`, `ws_shapes_unchanged`, `mongo_shapes_unchanged`, `deps_unchanged`) with command-output evidence from subtasks 1-3. Do not add new entrypoint env contracts or runtime tokens for this guard check. Done when all four guard values are documented as `true` with evidence links/paths.
5. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.

#### Implementation notes

- Record proof that `.npmrc` is unchanged and that scoped npm/auth/proxy support was intentionally not introduced.
- Record proof that API/WS/storage contracts remained unchanged (including explicit `openapi.json` unchanged evidence).
- Record proof that dependency manifests/lockfiles were unchanged for this infra-only story.

---

### 10. Final Story Closeout: acceptance verification and PR summary

- Task Status: ****to_do****
- Git Commits: `none yet`

#### Overview

Perform full end-to-end validation against acceptance criteria, confirm documentation is fully aligned, and prepare PR-ready summary material.

#### Documentation Locations

- Docker docs (build + compose): https://docs.docker.com/ (reference for final verification commands that build and compose environments).
- npm scripts and run lifecycle docs: https://docs.npmjs.com/cli/v10/using-npm/scripts (reference for wrapper script execution semantics in final validation).
- Git docs index: https://git-scm.com/docs (reference for release-note evidence commands such as `git log`/`git show`).
- Cucumber Guides root: https://cucumber.io/docs/guides/ (required baseline reference for cucumber test concepts and execution flow).
- Cucumber Guides overview: https://cucumber.io/docs/guides/overview/ (required because final validation includes cucumber wrapper execution).
- Cucumber 10-minute tutorial: https://cucumber.io/docs/guides/10-minute-tutorial/ (practical reference for interpreting feature/scenario-level failures).
- DeepWiki repo reference: `cucumber/cucumber-js` (use sections `3 Command Line Interface` and `7 Test Execution` for CLI and filtering behavior during wrapper triage).
- Context7: `/jestjs/jest` (authoritative Jest framework reference for client test execution, configuration, and troubleshooting).
- Jest getting started: https://jestjs.io/docs/getting-started (required because final validation includes client Jest summary wrapper).
- DeepWiki repo reference: `jestjs/jest` (use sections `4 Configuration` and `5 Testing APIs` when diagnosing wrapper failures).
- Playwright intro docs: https://playwright.dev/docs/intro (required because final validation includes e2e wrapper execution).
- DeepWiki repo reference: `microsoft/playwright` (use sections `4 Test Framework` and `6 Reporting System` to interpret e2e and reporting failures).

#### Subtasks

1. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Build an explicit Acceptance Criteria checklist table in this task’s `Implementation notes` with columns `AC #`, `Requirement summary`, `Proof (command/log/file)`, and `Pass/Fail`, covering all criteria `1` through `23` from this story. Done when every AC has a proof reference and pass status.
2. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Re-verify [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) includes exact required heading text and placement, canonical variable list, defaults, cert path example, workflow split, and e2e interpolation/runtime explanation. Done when checklist includes direct line/path evidence for each required item.
3. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Re-verify [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) documents final runtime decision points (build arg flow, entrypoint refresh gate, fail-fast behavior) and explicitly states interfaces/contracts were unchanged. Done when checklist includes at least one direct quote or line reference summary.
4. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Re-verify [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) includes all files/folders changed in this story with updated purpose text. Done when every touched file from `git diff --name-only` has a matching structure entry.
5. [ ] Single-subtask context: keep scope infra-only (no API/WS/storage contract changes); canonical vars are CODEINFO_NPM_REGISTRY, CODEINFO_PIP_INDEX_URL, CODEINFO_PIP_TRUSTED_HOST, CODEINFO_NODE_EXTRA_CA_CERTS, CODEINFO_CORP_CERTS_DIR, CODEINFO_REFRESH_CA_CERTS_ON_START; env sources are compose/compose:local => server/.env + server/.env.local and e2e => .env.e2e; read this subtask links plus https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ and https://docs.npmjs.com/cli/v10/using-npm/config/ before editing. Create a final PR summary comment in this task’s `Implementation notes` containing five sections: changed files, configuration semantics implemented, cert-refresh behavior (success + fail-fast), env-source behavior by workflow, and complete testing evidence list with log paths. Done when all five sections are present.
6. [ ] Run and record required workflow build wrapper `npm run compose:build` for acceptance criteria coverage. Capture terminal summary output and full log references in this task’s `Implementation notes`.
7. [ ] Run and record required workflow build wrapper `npm run compose:local:build` for acceptance criteria coverage. Capture terminal summary output and full log references in this task’s `Implementation notes`.
8. [ ] Run and record required workflow build wrapper `npm run compose:e2e:build` for acceptance criteria coverage. Capture terminal summary output and full log references in this task’s `Implementation notes`.
9. [ ] Final closeout evidence subtask. In this task’s `Implementation notes`, add a closeout row `ac_passed=<count>/23 regression_wrappers=complete manual_playwright=complete` backed by acceptance checklist and test/log evidence. Do not add a new runtime closeout token in entrypoint. Done when the closeout row is present and evidence-backed.
10. [ ] Run `npm run lint` and `npm run format:check`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds/tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [ ] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` OR warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` OR setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build` - Required acceptance-evidence wrapper run. Record terminal summary plus referenced logs in Implementation notes; if failed, inspect wrapper-referenced logs and rerun after fix.
8. [ ] `npm run compose:local:build` - Required acceptance-evidence wrapper run. Record terminal summary plus referenced logs in Implementation notes; if failed, inspect wrapper-referenced logs and rerun after fix.
9. [ ] `npm run compose:e2e:build` - Required acceptance-evidence wrapper run. Record terminal summary plus referenced logs in Implementation notes; if failed, inspect wrapper-referenced logs and rerun after fix.
10. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
11. [ ] `npm run compose:up`
12. [ ] Compose-log assertions (run after `npm run compose:up`): capture and review service logs (`timeout 90s npm run compose:logs` or equivalent wrapper-safe log capture) and verify runtime observability tokens/outcomes only for implementation-critical runtime paths: `[CODEINFO][T01_COMPOSE_WIRING_APPLIED]` present with non-empty `corp_certs_mount_source`; `[CODEINFO][T02_ENV_SOURCE_RESOLVED]` present with correct `workflow` and `interpolation_source`; `[CODEINFO][T03_SERVER_BUILD_OVERRIDE_STATE]` present with expected on/off flags for npm/pip overrides; `[CODEINFO][T04_CLIENT_BUILD_OVERRIDE_STATE]` present with expected client override flag; `[CODEINFO][T05_NODE_EXTRA_CA_CERTS_RESOLVED]` present with effective path/source; `[CODEINFO][T06_CA_REFRESH_RESULT]` present and `result` matches the scenario executed (`skipped`, `success`, or `failed`). For `[CODEINFO][T07_GCF_INSTALL_REGISTRY_STATE]`, record host helper command-output evidence if helper flow was triggered; otherwise record `not triggered`. Validate docs parity, interface/dependency guards, and closeout readiness through Implementation notes evidence/checklists rather than extra runtime tokens.
13. [ ] Manual Playwright-MCP check (run only after `npm run compose:up`; do not replace this with direct local browser checks). Open http://host.docker.internal:5001 and capture screenshot evidence for GUI-verifiable acceptance signals, saving files under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output` (mapped in `docker-compose.yml`): `task-10-home-overview.png` (main UI renders without layout regressions), `task-10-logs-overview.png` (Logs page renders and is navigable), and `task-10-console-clean.png` (developer console state with no unexpected errors/exceptions). The agent must review these saved screenshots to confirm GUI expectations are met.
14. [ ] `npm run compose:down`

#### Implementation notes

- Record final acceptance checklist outcomes and links/paths to key logs.
- Include explicit command output/log references for `compose:build`, `compose:local:build`, and `compose:e2e:build`.
