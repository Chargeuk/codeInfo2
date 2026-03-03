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

Expected user outcome:
- Standard users keep current behavior with no extra setup.
- Corporate users can configure npm/pip registry and certificate behavior through environment values only.
- Manual source edits to Dockerfiles and `.npmrc` are no longer required for normal corporate onboarding.

### Acceptance Criteria

- Corporate package access can be configured through `CODEINFO_*` environment variables without requiring source edits.
- A documented set of `CODEINFO_*` variables exists for npm registry, pip index/trusted host, and Node CA certificate handling.
- Canonical v1 variables are:
  - `CODEINFO_NPM_REGISTRY`
  - `CODEINFO_PIP_INDEX_URL`
  - `CODEINFO_PIP_TRUSTED_HOST`
  - `CODEINFO_NODE_EXTRA_CA_CERTS`
  - `CODEINFO_CORP_CERTS_DIR`
  - `CODEINFO_REFRESH_CA_CERTS_ON_START`
- Compose interpolation for this story continues to use `server/.env.local` as the single source for local corporate overrides.
- Compose build paths pass relevant `CODEINFO_*` values into both server and client Docker builds.
- Server build steps (`npm`, `pip`) respect configured registry/index/trusted-host values when provided.
- Client build steps (`npm`) respect configured registry values when provided.
- Server runtime can refresh container CA trust on startup when corporate certs are mounted and CA refresh is enabled.
- Corporate certificate settings support `NODE_EXTRA_CA_CERTS` behavior for Node tooling.
- Default behavior remains unchanged when no `CODEINFO_*` overrides are set.
- The solution avoids forcing users to manually edit root `.npmrc` for the v1 single-registry corporate case.
- v1 supports only a single default npm registry URL and explicitly does not include scoped npm registry mapping.
- Corporate registry/certificate overrides apply consistently to main, local, and e2e compose workflows.
- v1 does not require or implement npm authentication handling.
- README and env documentation clearly explain how to configure Mac/WSL corporate environments using local env files only.

### Out Of Scope

- Replacing enterprise credential-management systems (vault/secret stores/SSO tooling).
- Building a full multi-registry policy engine for arbitrary per-package routing.
- Supporting scoped npm registry rules (`@scope:registry`) in v1.
- Implementing npm authentication mechanisms (token/basic/client certificate) in v1.
- Proxy support (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) for this story.
- Supporting native Windows (non-WSL) runtime behavior beyond existing project support.
- Changing unrelated networking requirements (for example LM Studio, Mongo, Chroma host routing).
- Committing corporate secrets or internal hostnames as hardcoded defaults in tracked env files.

### Questions

1. Question: What is the expected mounted certificate path convention in developer machines, and do we need a default mount + toggle to run `update-ca-certificates`?
Recommended answer: Use a documented default host cert directory mount to `/usr/local/share/ca-certificates/codeinfo-corp`, with a toggle (`CODEINFO_REFRESH_CA_CERTS_ON_START=true`) to run `update-ca-certificates` on startup.
Why this is best: A standard mount target reduces setup variance and troubleshooting time. The toggle preserves current behavior for non-corporate users and avoids unnecessary startup work.

## Implementation Ideas

- Introduce a small, documented `CODEINFO_*` env surface, for example:
  - `CODEINFO_NPM_REGISTRY`
  - `CODEINFO_PIP_INDEX_URL`
  - `CODEINFO_PIP_TRUSTED_HOST`
  - `CODEINFO_NODE_EXTRA_CA_CERTS`
  - `CODEINFO_CORP_CERTS_DIR`
  - `CODEINFO_REFRESH_CA_CERTS_ON_START`
- Keep v1 npm behavior to a single default registry and avoid scoped registry mapping/auth handling.
- Update compose files to map `CODEINFO_*` values into `build.args` and runtime `environment` for both server and client services.
- Ensure this mapping is applied for main, local, and e2e compose files.
- Update server/client Dockerfiles to accept and apply registry/certificate args in every build stage that performs package installs.
- Update server entrypoint to conditionally refresh CA trust at startup for mounted corporate certs.
- Keep repo defaults safe by leaving `CODEINFO_*` unset in committed env files and documenting local-only overrides.
- Explicitly document that v1 does not include proxy support or npm auth/scoped registry support.
