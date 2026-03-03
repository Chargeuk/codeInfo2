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

Expected user outcome:
- Standard users keep current behavior with no extra setup.
- Corporate users can configure npm/pip registry and certificate behavior through environment values only.
- Manual source edits to Dockerfiles and `.npmrc` are no longer required for normal corporate onboarding.

### Acceptance Criteria

- Corporate package access can be configured through `CODEINFO_*` environment variables without requiring source edits.
- A documented set of `CODEINFO_*` variables exists for npm registry, pip index/trusted host, and Node CA certificate handling.
- Compose build paths pass relevant `CODEINFO_*` values into both server and client Docker builds.
- Server build steps (`npm`, `pip`) respect configured registry/index/trusted-host values when provided.
- Client build steps (`npm`) respect configured registry values when provided.
- Server runtime can refresh container CA trust on startup when corporate certs are mounted and CA refresh is enabled.
- Corporate certificate settings support `NODE_EXTRA_CA_CERTS` behavior for Node tooling.
- Default behavior remains unchanged when no `CODEINFO_*` overrides are set.
- The solution avoids forcing users to manually edit root `.npmrc` for the common single-registry corporate case.
- Any remaining `.npmrc` need (for advanced scoped registries/auth patterns) is explicitly documented with a safe, non-committed approach.
- README and env documentation clearly explain how to configure Mac/WSL corporate environments using local env files only.

### Out Of Scope

- Replacing enterprise credential-management systems (vault/secret stores/SSO tooling).
- Building a full multi-registry policy engine for arbitrary per-package routing.
- Supporting native Windows (non-WSL) runtime behavior beyond existing project support.
- Changing unrelated networking requirements (for example LM Studio, Mongo, Chroma host routing).
- Committing corporate secrets or internal hostnames as hardcoded defaults in tracked env files.

### Questions

- Which `CODEINFO_*` variable names should be canonical for v1 (minimal set vs extended set)?
- Do we need to support scoped npm registry rules (`@scope:registry`) in v1, or only a single default registry URL?
- What authentication mechanism is expected in corporate environments (token, basic auth, client cert), and should this be env-only or optional generated `.npmrc`?
- Should compose interpolation continue to rely on `server/.env.local` only, or should wrapper behavior be expanded to also load `client/.env.local`?
- Should corporate registry/certificate overrides also apply to e2e compose workflows, or only the main/local developer workflows?
- What is the expected mounted certificate path convention in developer machines, and do we need a default mount + toggle to run `update-ca-certificates`?
- Is proxy support (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) in scope for this story or a follow-up story?

## Implementation Ideas

- Introduce a small, documented `CODEINFO_*` env surface, for example:
  - `CODEINFO_NPM_REGISTRY`
  - `CODEINFO_PIP_INDEX_URL`
  - `CODEINFO_PIP_TRUSTED_HOST`
  - `CODEINFO_NODE_EXTRA_CA_CERTS`
  - optional `CODEINFO_CORP_CERTS_DIR` and `CODEINFO_REFRESH_CA_CERTS_ON_START`
- Update compose files to map `CODEINFO_*` values into `build.args` and runtime `environment` for both server and client services.
- Update server/client Dockerfiles to accept and apply registry/certificate args in every build stage that performs package installs.
- Update server entrypoint to conditionally refresh CA trust at startup for mounted corporate certs.
- Keep repo defaults safe by leaving `CODEINFO_*` unset in committed env files and documenting local-only overrides.
- Document when env vars are sufficient vs when advanced npm auth/scoped registry cases require generating runtime/build-time npm config.
