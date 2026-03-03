# Story 0000041 – Corporate Registry and Certificate Overrides via CODEINFO Environment Variables

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Today, the project works in standard Mac and WSL setups, but some corporate Windows/WSL environments require manual one-off edits before Docker builds can reach package repositories. In these environments, public npm/pip access is blocked and traffic must go through an internal Artifactory and corporate TLS certificate chain.

At the moment, users must manually edit multiple files (`.npmrc`, `server/Dockerfile`, `client/Dockerfile`, and container startup behavior) to inject registry and certificate settings. This is fragile, hard to document, and difficult for new contributors.

This story introduces a generic configuration approach based on `CODEINFO_*` environment variables so users can place corporate overrides in one local env file (for example `server/.env.local`) instead of modifying source-controlled files. The default open-source behavior must remain unchanged when overrides are not set.
For v1, this story is intentionally narrow: single default npm registry only (no scoped npm registry rules), no npm auth mechanism, and no proxy support.
For certificate trust, v1 standardizes on mounting only corporate `.crt` files from a dedicated host directory into `/usr/local/share/ca-certificates/codeinfo-corp:ro` (not mounting host `/etc/ssl/certs`), then conditionally refreshing the runtime CA store.
Documentation for this story must add a new README subsection immediately after `### Mac & WSL That have followed the WSL setup above` with a clear corporate-restricted-network title and setup steps.
The expected implementation output for this story is limited to Docker/Compose/shell/docs updates (no TypeScript or React feature work).

Expected user outcome:
- Standard users keep current behavior with no extra setup.
- Corporate users can configure npm/pip registry and certificate behavior through environment values only.
- Manual source edits to Dockerfiles and `.npmrc` are no longer required for normal corporate onboarding.

### Acceptance Criteria

1. A developer can configure corporate behavior by editing only `server/.env.local` (no edits required to `.npmrc`, Dockerfiles, or compose YAML files in their local clone).
2. Canonical v1 environment variables are exactly:
   - `CODEINFO_NPM_REGISTRY`
   - `CODEINFO_PIP_INDEX_URL`
   - `CODEINFO_PIP_TRUSTED_HOST`
   - `CODEINFO_NODE_EXTRA_CA_CERTS`
   - `CODEINFO_CORP_CERTS_DIR`
   - `CODEINFO_REFRESH_CA_CERTS_ON_START`
3. Compose interpolation remains sourced from `server/.env.local` via existing wrapper usage; no separate client env interpolation is introduced for this story.
4. `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` each pass relevant `CODEINFO_*` values to both server and client build/runtime paths where applicable.
5. `server/Dockerfile` accepts and applies registry/certificate-related build arguments in every stage that executes `npm ci`, global `npm install -g`, or `pip install`.
6. `client/Dockerfile` accepts and applies registry-related build arguments in the stage that executes `npm ci`.
7. When `CODEINFO_NPM_REGISTRY` is set, npm install steps use that registry through environment/config wiring; when it is unset, existing default npm behavior is preserved.
8. When `CODEINFO_PIP_INDEX_URL` and `CODEINFO_PIP_TRUSTED_HOST` are set, server pip install steps use them; when unset, existing pip defaults are preserved.
9. Server runtime supports certificate refresh by running `update-ca-certificates` during startup only when `CODEINFO_REFRESH_CA_CERTS_ON_START=true`.
10. Corporate certificate mount uses `CODEINFO_CORP_CERTS_DIR` mapped to `/usr/local/share/ca-certificates/codeinfo-corp:ro`; mounting host `/etc/ssl/certs` is not used.
11. Node runtime/npm trust chain supports `CODEINFO_NODE_EXTRA_CA_CERTS` and documents the default corporate value `/etc/ssl/certs/ca-certificates.crt`.
12. Root `.npmrc` remains unchanged for v1 (no mandatory manual edits for single-registry corporate setup).
13. v1 supports one default npm registry URL only and does not implement scoped registry mapping (`@scope:registry`).
14. v1 does not implement npm authentication handling (token/basic/client certificate).
15. v1 does not implement proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
16. README contains a new section immediately after `### Mac & WSL That have followed the WSL setup above` with exact title `### Corporate Registry and Certificate Overrides (Restricted Networks)`.
17. That README section includes:
   - a tested concrete example path for `CODEINFO_CORP_CERTS_DIR`,
   - expected cert file format/location (for example `.crt` files in that directory),
   - explicit default statement that `CODEINFO_REFRESH_CA_CERTS_ON_START=false` unless certificate-mount setup is intentionally enabled,
   - step-by-step setup for restricted corporate WSL environments.
18. Final verification notes in the story must show wrapper build commands complete successfully for affected workflows after configuration changes.

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

## Implementation Ideas

- Planned file touchpoints:
  - `docker-compose.yml`
  - `docker-compose.local.yml`
  - `docker-compose.e2e.yml`
  - `server/Dockerfile`
  - `client/Dockerfile`
  - `server/entrypoint.sh`
  - `README.md`
- Compose changes:
  - map `CODEINFO_*` values into server/client `build.args` and runtime `environment`,
  - add optional server cert mount from `${CODEINFO_CORP_CERTS_DIR}` to `/usr/local/share/ca-certificates/codeinfo-corp:ro`,
  - keep interpolation based on `server/.env.local`.
- Dockerfile changes:
  - declare required `ARG`/`ENV` values in relevant build stages,
  - ensure npm/pip install commands consume provided registry/certificate values,
  - preserve default behavior when variables are unset.
- Entrypoint changes:
  - conditionally run `update-ca-certificates` when `CODEINFO_REFRESH_CA_CERTS_ON_START=true`,
  - log whether CA refresh ran or was skipped for easier troubleshooting.
- README changes:
  - insert section `### Corporate Registry and Certificate Overrides (Restricted Networks)` immediately after `### Mac & WSL That have followed the WSL setup above`,
  - include tested concrete example for `CODEINFO_CORP_CERTS_DIR` and expected `.crt` contents,
  - document `CODEINFO_REFRESH_CA_CERTS_ON_START=false` default and when to enable it,
  - provide step-by-step restricted-network setup using only `server/.env.local`.
