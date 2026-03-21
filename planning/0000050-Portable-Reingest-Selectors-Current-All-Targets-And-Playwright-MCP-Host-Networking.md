# Story 0000050 – Portable Reingest Selectors Current All Targets And Host-Networked Server And Playwright MCP

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Command JSON files and flow JSON files already support a dedicated re-ingest action, but the current contract is too tied to machine-specific absolute paths. Today a workflow author must usually place an exact ingested repository root path into `sourceId`, which means the same command or flow can stop working when it is copied to another machine, another container layout, or another developer environment.

Users want workflow re-ingest steps to be portable. A workflow should be able to identify a repository by a stable selector such as the repository name or id instead of by a hard-coded absolute path. This story therefore expands the meaning of flow and command re-ingest selectors so that existing path-based configurations keep working, while new machine-portable definitions can use case-insensitive repository names or ids and let the server resolve those to the canonical ingested root. The user has decided that if multiple ingested repositories share the same case-insensitive repository id, workflow re-ingest should preserve the current helper behavior of selecting the latest ingest rather than failing as ambiguous.

Users also want two higher-level re-ingest targets that are not currently possible in workflow files.

The first target is the current repository for the currently executing workflow file. In practice that means a re-ingest step should be able to say "re-ingest the repository that owns this flow or command" without hard-coding that repository path. For a top-level flow step this should mean the repository that supplied the flow file. For a direct command run this should mean the repository that supplied the command file. For a command running inside a flow command step this should mean the repository that supplied that command file, not the parent flow file unless they are the same repository.

The second target is all currently ingested repositories. This is useful for maintenance or refresh workflows where the user wants one workflow action to refresh every indexed repository without authoring one step per repository. Because the ingest layer already enforces a global lock, this story should treat "all repositories" as a deterministic sequential operation rather than a parallel fan-out. Existing delta and skipped behavior in the ingest layer should continue to keep no-op repositories relatively cheap, but the story should still assume that "all repositories" means one re-ingest operation per ingested repository in a predictable order. The user has decided that conversation history for this mode should use a dedicated batch result payload rather than emitting one existing per-repository tool result into the transcript for every repository.

Current-repository and all-repositories targeting are additions to the workflow contract, not replacements for the existing explicit selector shape. Backward-compatible `sourceId` steps stay valid, while the broader runtime contract should also allow explicit target shapes such as `{ "type": "reingest", "target": "current" }` and `{ "type": "reingest", "target": "all" }`. For `target: "all"`, deterministic order should be defined concretely as ascending canonical container path order so implementation and tests use one stable ordering rule.

The dedicated batch result for `target: "all"` also needs a concrete minimum contract. One transcript item should represent the whole batch and should include enough structured data for the UI, logs, and tests to reason about the outcome without reconstructing it from per-repository messages. At minimum that payload should identify that the target mode was `all`, preserve the ordered list of repositories attempted, and record for each repository the resolved repository identity, canonical container path, and terminal outcome (`reingested`, `skipped`, or `failed`) plus an error message when the outcome is `failed`.

This story should preserve the current blocking re-ingest semantics. A workflow step should still wait for each re-ingest target to reach a terminal outcome before moving on. Pre-start validation failures should still fail the relevant workflow step early with a clear message. Terminal ingest failures should still be recorded as structured outcomes rather than being silently swallowed.

This story also tightens one part of the markdown-file workflow contract used by commands and flows. If a loaded markdown file resolves successfully but its content is empty or contains only whitespace, the runtime should not try to execute that instruction as an empty prompt. Instead, that specific flow or command step should be skipped, and the system should emit an info-level log entry that makes it clear the step was skipped because the resolved markdown content was empty. This keeps reusable prompt files safe to leave temporarily blank without turning them into confusing no-op agent calls or avoidable failures.

That empty-markdown skip behavior should be implemented with a concrete log contract. The runtime should only skip when the markdown file resolved successfully but the final content is empty after whitespace trimming, and the info-level log entry should explicitly state the execution surface (`command` or `flow`), the resolved markdown file path, and that the step was skipped because the resolved markdown content was empty or whitespace-only.

In addition to the workflow re-ingest work, this story also includes an explicit host-networking implementation for the checked-in manual-testing and runtime containers that expose MCP surfaces. The current stack still relies on bridge networking assumptions for the `playwright-mcp` container and on published-port mapping for the `server` container. The user has now fixed the desired direction for this story: move the checked-in `server` and `playwright-mcp` containers onto host networking where they already exist, so manual testing and Codex MCP connections no longer depend on bridge-only service DNS assumptions.

This host-networking work is not just a one-line Compose change. Docker host networking means each process must bind the actual host-visible port it should use, because Compose `ports` mappings no longer provide the translation layer for that service. The story therefore must preserve the checked-in host-visible port contract unless a change is required to avoid a clash:

- `docker-compose.local.yml` server stays available on host ports `5510`, `5511`, and `5512`, so the local host-networked server process must bind those ports directly;
- `docker-compose.local.yml` Playwright MCP stays available on host port `8931`;
- `docker-compose.yml` server stays available on host ports `5010`, `5011`, and `5012`;
- `docker-compose.yml` Playwright MCP must move to a different checked-in host port than the local stack so the two stacks do not clash, for example `8932`;
- `docker-compose.e2e.yml` server keeps its current host-visible contract on `6010`, `6011`, and `6012`;
- other checked-in Compose files should preserve their current host-visible server ports unless a documented clash requires a different value.

This broader host-networking scope means the story must also plan the supporting changes that make the implementation safe and usable in real workflows:

- remove incompatible bridge-style wiring from each host-networked `server` and `playwright-mcp` service;
- update each host-networked server service so its bind-port environment values match the host-visible ports that stack is expected to expose;
- give each host-networked Playwright MCP service a deliberate host port strategy so checked-in stacks do not clash when run together;
- replace hard-coded MCP endpoints in checked-in runtime config files with explicit named placeholders that identify which server-owned MCP port or environment-aware URL override should be applied before runtime config is passed to Codex or related MCP consumers;
- keep browser navigation targets and agent control-channel endpoints as separate concerns rather than assuming they are the same URL.

For this story, "fail fast" on host-networking prerequisites should also be concrete. If a checked-in compose wrapper is run in an environment where the required host-network contract is unsupported or incompatible, the wrapper output should stop before container startup and explain which compose file or service cannot use the checked-in host-network setup and what prerequisite is missing or incompatible.

One preparatory compatibility pass has already been completed before implementation of this story begins. The server runtime now understands the planned MCP placeholder contracts in memory, it temporarily accepts the future `CODEINFO_CHAT_MCP_PORT` name alongside the legacy `CODEINFO_MCP_PORT` contract, and the local compose stack has been restarted and validated after that pre-work. This means the story can now proceed using the sequenced approach below without the currently running local stack immediately breaking as soon as checked-in `config.toml` files move to the new placeholder style.

That temporary compatibility should not become the permanent end state of the story. The final implemented contract should complete the rename cutover by removing the legacy `CODEINFO_MCP_PORT` fallback once all checked-in compose files, env files, runtime config files, tests, and documentation have moved to `CODEINFO_CHAT_MCP_PORT`. The story scope for that migration also now explicitly includes the checked-in shared-home runtime configs under `codex/` that are actually consumed at runtime, not just `config.toml.example` and `codex_agents/*`.

Repository research also clarifies an important implementation detail for this part of the story. The current Context7 API-key behavior is not driven by built-in TOML environment interpolation. Instead, the product reads a literal placeholder in runtime `config.toml` files and overlays the real value in memory during runtime config normalization. This story should treat MCP endpoint variability the same way: do not assume generic TOML env interpolation exists for MCP server definitions. If `server` or `playwright-mcp` endpoints vary per environment, the checked-in configs should declare which override they need by using explicit placeholder tokens, and runtime normalization should replace those placeholders with the correct environment-provided value before passing the config to Codex or related MCP consumers. For the server-owned MCP surfaces this should use named port placeholders inside localhost URLs, with the classic `/mcp` surface continuing to resolve from `CODEINFO_SERVER_PORT`, while Playwright should remain a full-URL override.

Current repository evidence shows that the checked-in Compose files do not all define a `playwright-mcp` service today, but they do all define a `server` service. The user has decided that files which do not currently define a `playwright-mcp` service remain out of scope for adding new Playwright services. The story therefore should implement host networking for every checked-in Compose file that already declares `server`, and for every checked-in Compose file that already declares `playwright-mcp`, without expanding scope into adding new server or Playwright services to additional environments. The user has also fixed one endpoint contract for that implementation: the Playwright control-channel runtime override variable is `CODEINFO_PLAYWRIGHT_MCP_URL`. Because the current `5010` versus `5011` CodeInfo MCP split is intentional and reflects different tool-access sets for chat versus other runtime configs, this story should preserve that split under host networking by using explicit named port placeholders in the checked-in CodeInfo MCP URLs rather than collapsing them into one shared URL.

This remains a single-repository story inside `codeInfo2`. The runtime behavior under discussion may operate on many ingested repositories, but the implementation work described by this story stays in this repository's server, config, compose, wrapper, test, and documentation files. No coordinated source changes in a second ingested repository are required by the current scope.

### Repository Research Notes

- Current selector behavior already exists in `server/src/mcpCommon/repositorySelector.ts`: it resolves by case-insensitive repository id first, then canonicalized container path, then canonicalized host path, and duplicate id matches already choose the latest ingest. This confirms the story should reuse that helper instead of inventing a second selector contract.
- Current low-level re-ingest execution in `server/src/ingest/reingestService.ts` is intentionally strict and only accepts an exact canonical ingested `sourceId`. This confirms the story should keep selector expansion above that service rather than weakening the service itself.
- Current flow and command ownership tracking already exists. `server/src/flows/service.ts` carries `flowSourceId` for the owning flow repository, while direct and nested command execution threads `sourceId` and `flowSourceId` through `server/src/agents/service.ts`, `server/src/agents/commandsRunner.ts`, and `server/src/agents/commandItemExecutor.ts`. This means the main story work is orchestration and contract expansion, not inventing a new ownership model from scratch.
- Current markdown-backed flow and command execution already shares one resolver path in `server/src/flows/markdownFileResolver.ts`, used from both flow execution and command-item execution. This confirms the empty-markdown skip behavior should be implemented in that shared resolver/execution seam so both surfaces stay aligned.
- Current runtime MCP placeholder handling is split today. `server/src/config/runtimeConfig.ts` currently overlays direct `${ENV}` placeholders and the direct placeholder token `CODEINFO_PLAYWRIGHT_MCP_URL`, while `server/src/config/codexConfig.ts` still performs separate server-port replacement and hard-coded `5010` substitutions. This confirms the story needs one shared normalization path as part of the cleanup, not another surface-specific patch.
- Current checked-in compose files still rely on bridge-era assumptions: `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml` all use `ports`, bridge networks, and in several places `host.docker.internal` or service-name assumptions. `scripts/docker-compose-with-env.sh` currently handles UID/GID and Docker socket differences, but it does not yet validate host-network prerequisites or fail early for unsupported environments.
- External Docker documentation confirmed two implementation constraints that should be treated as hard requirements for this story: Compose `ports` must not be kept on services that move to `network_mode: host`, and host networking support depends on Linux Docker Engine or Docker Desktop 4.34+ with host networking explicitly enabled. The story should therefore treat wrapper validation and documentation of those prerequisites as required scope, not optional polish.
- Current Docker build behavior is only partially aligned with the desired runtime model. `server/Dockerfile` and `client/Dockerfile` already copy application code into the image and build from there, which is the right direction, but the checked-in runtime assets used by the server (`codex/`, `codex_agents/`, and the checked-in flow directories) are still supplied at runtime through compose bind mounts rather than being baked into the image. This story therefore needs explicit Dockerfile/build-context work, not only compose edits, if the final host-networked runtime is not supposed to rely on host source bind mounts.
- Current ignore-file coverage exists in `.dockerignore`, `server/.dockerignore`, and `client/.dockerignore`, but the story now needs to treat those files as part of the implementation surface whenever additional checked-in runtime assets are copied into images. The goal is to copy only the files needed to build and run the server/client images while still excluding credentials, tests, node_modules, build output, and other unnecessary context content.
- Current host-visible port usage relevant to this story is already occupied and must be treated as a fixed inventory before choosing any new bind port: main server `5010/5011/5012`, local server `5510/5511/5512`, e2e server `6010/6011/6012`, local Playwright MCP `8931`, local Chrome DevTools `9222`, main client `5001`, local client `5501`, and e2e client `6001`. Any new host-visible port introduced by this story must be chosen against that inventory and written into the plan explicitly before implementation.

### Missing Prerequisites Confirmed By Audit

- Re-ingest `target` support does not exist yet in the command or flow schemas. `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` currently accept only literal `sourceId`-based re-ingest items, so this story must explicitly add the schema/runtime seam for `target: "current"` and `target: "all"` before those modes can be implemented.
- Batch orchestration for `target: "all"` does not exist yet. Current runners in `server/src/agents/commandsRunner.ts` and `server/src/flows/service.ts` call the single-repository re-ingest path one item at a time and do not have a reusable batch result-recording seam. The story therefore depends on introducing that orchestration layer as new capability, not just on changing validation text.
- Blank-markdown skip behavior does not exist yet. `server/src/flows/markdownFileResolver.ts`, flow LLM execution in `server/src/flows/service.ts`, and command-item execution in `server/src/agents/commandItemExecutor.ts` currently load resolved markdown content and pass it onward without a documented blank-content guard. The story must therefore add this skip seam explicitly.
- Dedicated MCP listener readiness seams are incomplete for host-network validation. The main server already exposes `/health`, but `server/src/mcp2/server.ts` and `server/src/mcpAgents/server.ts` start bare HTTP listeners with no separate readiness endpoint, and the checked-in `playwright-mcp` services also have no compose healthcheck. Final validation for this story cannot assume dedicated `/health` probes already exist on those surfaces.
- Wrapper-level host-network prerequisite validation does not exist yet. `scripts/docker-compose-with-env.sh` currently resolves Docker socket and UID/GID behavior, but it does not check whether host networking is supported/enabled, whether unsupported compose keys remain on host-networked services, or whether checked-in host-visible ports are already occupied.
- Deployment/env migration is still incomplete in checked-in defaults. `server/.env` still uses legacy `CODEINFO_MCP_PORT`, and checked-in runtime configs such as `config.toml.example`, `codex/chat/config.toml`, and `codex_agents/coding_agent/config.toml` still contain hard-coded MCP URLs or service-name assumptions that are incompatible with the intended final host-networked contract. The story should treat these as explicit migration prerequisites rather than incidental cleanups.
- Test harness coverage for the new assumptions does not exist yet. Current tests cover strict single-source re-ingest and runtime placeholder normalization, but there is not yet focused coverage for `target: "current"`, `target: "all"`, batch result payloads, blank-markdown skip logging, wrapper preflight failures, or host-networked manual-testing validation. The story should document those as required new tests rather than assuming existing harnesses already prove them.
- Docker runtime packaging for the host-networked server is incomplete for the desired no-host-source-bind-mount model. Because compose currently bind-mounts checked-in repo directories such as `./codex`, `./codex_agents`, and `./flows` or `./flows-sandbox`, the story must explicitly add the missing Dockerfile/build-context seam that copies those checked-in runtime assets into the image if the final stack is to run from image contents rather than from the host source tree.
- Generated-output persistence rules are not yet documented for the story surfaces. The current `playwright-mcp` services bind-mount host output directories, so the story should explicitly decide that any container-generated artifact persistence uses Docker-managed volumes for generated output only, with host bind mounts reserved for logs rather than for application source or checked-in repo trees.

### Acceptance Criteria

- Existing path-based re-ingest steps in commands and flows continue to work.
- Command and flow re-ingest execution can accept a portable repository selector rather than requiring only a machine-specific absolute path.
- The selector logic for command and flow re-ingest is aligned with the existing repository-selector helper already used by MCP surfaces:
  - case-insensitive repository id or name;
  - container path;
  - host path.
- If multiple ingested repositories share the same case-insensitive repository id, workflow re-ingest preserves the existing helper behavior of selecting the latest ingest.
- Direct command runs can re-ingest the current repository without the workflow author hard-coding a repository path.
- Top-level flow re-ingest steps can re-ingest the current repository without the workflow author hard-coding a repository path.
- Command items running inside a flow command step can re-ingest the current repository of the executing command file rather than implicitly using only the parent flow repository.
- Command and flow re-ingest support an explicit "all repositories" mode.
- "All repositories" mode re-ingests repositories sequentially in a deterministic order and waits for each one to reach a terminal outcome before continuing.
- For `target: "all"`, deterministic order is defined as ascending canonical container path order of the currently ingested repositories.
- "All repositories" mode records one dedicated batch result payload in conversation history rather than one existing single-repository result per repository.
- The dedicated batch result payload for `target: "all"` contains one ordered result entry per attempted repository, including the resolved repository identity, canonical container path, terminal outcome (`reingested`, `skipped`, or `failed`), and error text when a repository fails.
- If a "current repository" target resolves to a repository that is not currently ingested, the step fails fast with a clear pre-start error instead of silently falling back to another repository.
- The low-level single-repository re-ingest service remains the canonical strict container-path execution layer, with selector expansion handled above it.
- Structured re-ingest result recording remains intact for direct commands, dedicated flow re-ingest steps, and command items executed inside flows.
- If a command or flow markdown file resolves successfully but contains only empty or whitespace-only content, that step is skipped rather than executed as an empty prompt.
- Empty-markdown skips emit an info-level log entry that clearly states the step was skipped because the resolved markdown content was empty.
- Empty-markdown skip logs also include the execution surface (`command` or `flow`) and the resolved markdown file path so the skipped step can be identified directly from logs and tests.
- Every checked-in Docker Compose file that defines a `server` service is updated to use host networking.
- Each host-networked server service preserves the checked-in host-visible port contract for that stack unless a documented clash requires a different value.
- The checked-in default server port strategy remains `5010`/`5011`/`5012` for `docker-compose.yml`, `5510`/`5511`/`5512` for `docker-compose.local.yml`, and `6010`/`6011`/`6012` for `docker-compose.e2e.yml`.
- Server and client application code continue to be copied into Docker images and built there; the story does not rely on a host source-tree bind mount such as `.:/app` for application code in the final runtime containers.
- Every checked-in Docker Compose file that defines a `playwright-mcp` service is updated to use host networking.
- Compose files that do not currently define a `playwright-mcp` service remain unchanged with respect to Playwright services for this story.
- Each host-networked Playwright MCP service uses a deliberate host port plan so checked-in stacks do not clash when run together.
- The checked-in default Playwright MCP port strategy uses distinct defaults for the existing stacks, keeping `8931` for `docker-compose.local.yml` and using a different checked-in port for `docker-compose.yml`, for example `8932`.
- The Dockerfiles and the relevant `.dockerignore` files are updated together wherever this story changes what checked-in runtime files must be copied into the image, so only required files enter the build context and no host source bind mount is needed for runtime application code.
- The implementation removes any incompatible bridge-style `server` and `playwright-mcp` wiring that cannot coexist with host networking.
- The final host-networked compose path does not introduce new bind mounts for application source trees or checked-in runtime config trees. If container-generated output must persist, it uses Docker-managed volumes for generated output only, while log output may remain host-visible.
- Checked-in runtime MCP endpoint configuration is updated so host-networked stacks are no longer hard-coded only to `http://localhost:5010/mcp`, `http://localhost:5011/mcp`, or `http://playwright-mcp:8931/mcp`.
- The implementation preserves the intentional split between the chat/base CodeInfo MCP endpoint and the other checked-in CodeInfo MCP endpoint rather than collapsing them into one shared URL contract.
- The runtime MCP endpoint overrides are implemented through explicit runtime environment overlays rather than assuming native TOML environment interpolation.
- The checked-in config values identify which MCP override contract they require by using explicit named placeholder tokens rather than by relying on raw hard-coded localhost URLs.
- Placeholder replacement happens before the resolved runtime config is passed to Codex or any related MCP consumer that depends on those endpoint values.
- The story defines explicit environment-variable contracts for the MCP endpoints that vary by environment, keeping `CODEINFO_PLAYWRIGHT_MCP_URL` as a full URL and using `CODEINFO_SERVER_PORT`, `CODEINFO_CHAT_MCP_PORT`, and `CODEINFO_AGENTS_MCP_PORT` as the named server-owned MCP port contracts inside the checked-in localhost URL placeholders.
- The MCP placeholder replacement is implemented once in a shared runtime-config normalization layer and is used by every path that consumes those endpoint values, including config seeding, chat runtime config loading, agent runtime config loading, flow or MCP execution, status probes, wrapper-facing guidance, and representative tests.
- The final end state removes the temporary legacy `CODEINFO_MCP_PORT` fallback so `CODEINFO_CHAT_MCP_PORT` is the single canonical dedicated MCP env contract.
- The checked-in shared-home runtime config files under `codex/` that are actually consumed at runtime are updated alongside `codex_agents/*`, while `config.toml.example` is updated as sample/documentation coverage only.
- The implementation keeps the browser navigation target and the agent control-channel endpoint conceptually separate where that is required for host-networked manual testing.
- The compose wrapper and supporting documentation validate or fail fast on the host-networking prerequisites required by the checked-in `server` and `playwright-mcp` services for the supported environments.
- The documented and validated host-networking prerequisites are explicit: Linux Docker Engine is supported, and Docker Desktop must be version `4.34` or later with host networking enabled before the checked-in host-networked compose services are started.
- Host-networking prerequisite failures are reported before startup with an actionable message that names the affected compose file or service and the missing or incompatible prerequisite.
- Final validation does not assume dedicated `/health` endpoints already exist for the chat MCP port, the agents MCP port, or the Playwright MCP surface. The story either adds explicit readiness checks for those surfaces or validates them through successful port or MCP probes as part of wrapper/test automation.
- The migration explicitly updates current legacy or static defaults that are still checked in, including `CODEINFO_MCP_PORT` usage in env files and hard-coded MCP URLs in the checked-in runtime config files consumed by chat and agents.
- The test plan explicitly adds coverage for the new prerequisites introduced by this story: target-based re-ingest schemas and orchestration, batch result payload recording, blank-markdown skip logging, wrapper preflight validation, and host-networked manual-testing verification.
- Final validation also proves that the host-networked runtime containers are running from image-baked application contents rather than from host source bind mounts, and that any persisted generated output uses Docker-managed volumes except for host-visible logs.
- The resulting local manual-testing setup still supports the existing server and Playwright MCP traffic patterns used by this product, including REST/API access, Codex MCP access, browser control, websocket flows, screenshots, and manual UI verification.

### Out Of Scope

- Replacing the strict single-repository re-ingest execution service with a new multi-repository ingest engine.
- Parallel re-ingest execution for "all repositories".
- General-purpose repository selector changes for every unrelated workflow field in the product unless those fields are required for this story's re-ingest behavior.
- Renaming every existing `sourceId` field across all product surfaces only for terminology cleanup.
- Reworking unrelated workflow step types beyond what is needed to support portable re-ingest selectors, current/all targets, and the resulting runtime metadata.
- Reworking unrelated Playwright MCP behavior outside the manual-testing networking, endpoint, and port-management concerns captured in this story.
- Reworking unrelated server networking behavior beyond what is required to host-network the checked-in `server` services while preserving their current host-visible port contracts.
- Reworking the whole Docker networking model for every service beyond what is required for the checked-in `server` and `playwright-mcp` host-networking implementation.
- Adding brand-new `server` or `playwright-mcp` services to Compose files that do not already define them.

### Questions

- No Further Questions

## Decisions

1. Preserve the existing latest-ingest helper behavior for duplicate case-insensitive repository ids.
   - Question being addressed: If multiple ingested repositories share the same case-insensitive repository id, should workflow re-ingest keep the existing helper behavior of selecting the latest ingest, or should workflows fail fast as ambiguous because they are automation artifacts?
   - Why the question matters: this determines whether machine-portable repository-name selectors stay convenient and backward-compatible or become stricter and potentially reject existing repository layouts.
   - What the answer is: keep the existing helper behavior of selecting the latest ingest.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it preserves the current selector contract already used by the helper, avoids surprising breakage for existing repository-name workflows, and keeps the story focused on portable selector support rather than expanding into a stricter repository-identity redesign.

2. Use a dedicated batch result payload for `target: "all"`.
   - Question being addressed: For `target: "all"`, should conversation history record one existing re-ingest tool result per repository, or should the story introduce a new batch result payload to reduce transcript noise?
   - Why the question matters: this decides the transcript experience, payload contract, persistence work, websocket shape, and test scope for multi-repository re-ingest.
   - What the answer is: introduce a new batch result payload to reduce transcript noise.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the conversation history readable during large multi-repository refresh runs and makes the "all repositories" mode feel like one intentional workflow action rather than a flood of repeated single-repository system messages.

3. Keep Compose files without an existing `playwright-mcp` service out of scope for adding Playwright services, while still converting every checked-in `server` service to host networking.
   - Question being addressed: Should Compose files that do not currently define a `playwright-mcp` service remain out of scope for Playwright host-networking work, and does the new server host-networking scope still apply to those files?
   - Why the question matters: this fixes the real size of the Docker and runtime-config work up front and prevents the story from silently expanding into introducing new Playwright services in additional environments while still making the server host-networking intent explicit.
   - What the answer is: do not add new Playwright services to files that do not already define one, but do convert every checked-in `server` service to host networking.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the story tightly focused on converting the existing Playwright MCP surfaces while still capturing the broader user decision that server host networking is now part of this story across the checked-in stacks.

4. Standardize the Playwright MCP control URL env-var name as `CODEINFO_PLAYWRIGHT_MCP_URL`.
   - Question being addressed: What exact environment variable name should the story standardize on for the Playwright MCP control URL?
   - Why the question matters: this fixes the runtime-overlay contract before implementation so code, compose files, tests, and documentation all target one stable environment variable name.
   - What the answer is: use `CODEINFO_PLAYWRIGHT_MCP_URL`.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it matches the repository's existing `CODEINFO_` naming style, it is specific to the Playwright MCP control channel, and it makes the override intent clear without overloading a generic or ambiguous variable name.

5. Use distinct checked-in default ports for the main and local Playwright MCP stacks.
   - Question being addressed: What checked-in default ports should the existing Playwright MCP compose services use so they do not clash if stacks run together?
   - Why the question matters: this decides the compose defaults, the runtime endpoint values that correspond to those defaults, and whether the checked-in stacks can safely coexist during local development and manual testing.
   - What the answer is: keep `8931` for `docker-compose.local.yml` and use a different checked-in port for `docker-compose.yml`, for example `8932`.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it preserves the existing local manual-testing port contract, avoids an immediate clash with the main stack, and keeps the story focused on explicit per-environment wiring instead of leaving port separation to manual operator discipline.

6. Convert every checked-in `server` service to host networking while preserving its current host-visible ports.
   - Question being addressed: Should the server host-networking scope stop at the manual-testing Playwright container, or should it include the checked-in `server` containers as well?
   - Why the question matters: this changes which Compose files and runtime-config paths must be touched and determines whether server MCP endpoints continue to depend on Docker port mapping or become direct bind-port responsibilities of the host-networked server process.
   - What the answer is: include every checked-in `server` service in the host-networking work and preserve the current host-visible port contract for each stack unless a clash requires a documented change.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it aligns the manual-testing and Codex-runtime networking story around one consistent model, keeps the stack addresses stable for users, and forces the plan to handle the server MCP endpoints honestly instead of only solving the Playwright side.

7. Preserve the checked-in host-visible server port matrix per compose file.
   - Question being addressed: Which host-visible ports must the host-networked server services continue to use after the `ports` mapping layer is removed?
   - Why the question matters: host networking removes the translation layer that previously mapped container ports onto host ports, so the server process itself must bind the intended host-visible ports directly and the plan must lock those values before implementation.
   - What the answer is: keep `5010`/`5011`/`5012` for `docker-compose.yml`, keep `5510`/`5511`/`5512` for `docker-compose.local.yml`, and keep `6010`/`6011`/`6012` for `docker-compose.e2e.yml`.
   - Where the answer came from: direct user answer in this planning conversation plus current checked-in compose port mappings.
   - Why it is the best answer: it preserves the existing external contract for each stack, minimizes surprise for users and scripts, and makes the host-networking change explicit about the bind-port updates it requires inside the server container.

8. Use explicit runtime overlays for MCP endpoints rather than trying to infer behavior from hard-coded port literals.
   - Question being addressed: How should the story handle the fact that checked-in chat and agent runtime configs currently hard-code stack-specific MCP URLs?
   - Why the question matters: this decides whether the implementation remains readable and deterministic or turns into brittle string replacement that only works for some files or some ports.
   - What the answer is: keep `CODEINFO_PLAYWRIGHT_MCP_URL` as a full-URL runtime override, and use named port-based runtime overlays for the server-owned MCP surfaces via `CODEINFO_SERVER_PORT`, `CODEINFO_CHAT_MCP_PORT`, and `CODEINFO_AGENTS_MCP_PORT`, with the checked-in config URLs declaring those placeholders explicitly. This keeps the classic `/mcp` surface on the main server listener instead of introducing a new fourth bind port just for that route.
   - Where the answer came from: direct user answer in this planning conversation plus current repository evidence from runtime-config normalization and checked-in `config.toml` files.
   - Why it is the best answer: it matches the repository's existing Context7 overlay pattern, keeps config files readable, avoids coupling the implementation to accidental hard-coded port literals, and lets the server-owned MCP URLs stay in sync with the actual listener port contracts.

9. Preserve the intentional split between the chat/base CodeInfo MCP endpoint and the other checked-in CodeInfo MCP endpoint.
   - Question being addressed: Should the story collapse the current `5010` versus `5011` CodeInfo MCP usage into one canonical URL, or preserve the split?
   - Why the question matters: this decides whether host networking accidentally changes tool-access boundaries that are currently enforced by pointing different checked-in runtime configs at different MCP surfaces.
   - What the answer is: preserve the split. The current ports are intentional because chat has access to one set of MCP tools and the other checked-in configs deliberately point to another surface, so the host-networking implementation must keep each runtime config pointed at the correct endpoint for the tools it should see.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it preserves the existing access model, avoids silently broadening or narrowing tool visibility, and changes the implementation problem from “pick one port” to “inject the right URL for each intended surface.”

10. Use named placeholders inside checked-in config values to declare which MCP override contract should be resolved before runtime config is passed to Codex.
   - Question being addressed: How should the story make it obvious which environment-provided MCP URL belongs in each checked-in config location without guessing from hard-coded ports at runtime?
   - Why the question matters: if the mapping lives only in replacement code, the implementation becomes brittle and developers have to reverse-engineer which env var should apply to which config entry whenever a new surface is added.
   - What the answer is: let the checked-in config values declare the intended override directly by using named placeholders in the URL, for example `http://localhost:${CODEINFO_SERVER_PORT}/mcp`, `http://localhost:${CODEINFO_CHAT_MCP_PORT}/mcp`, and `http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp`, then resolve those placeholders to the correct environment-provided values before the runtime config is passed to Codex.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the mapping upstream in the config itself, makes the intended override explicit, avoids inferring behavior from raw port literals, and fits the repository’s existing in-memory placeholder-normalization pattern without needing opaque numbered tokens.

11. Replace MCP placeholders in one shared runtime-config layer and require every consuming path to use it.
   - Question being addressed: Which parts of the app need to replace the MCP placeholders with real URLs so chat, agents, status checks, and tests all keep using the correct MCP endpoints?
   - Why the question matters: this repository already loads and uses MCP config in several places, including base-config bootstrap, chat runtime config, agent runtime config, flow execution, MCP tooling, status probes, wrapper scripts, and tests. If the story only patches one of those places, some paths will still see raw placeholders or stale URLs.
   - What the answer is: handle the replacement in one shared runtime-config layer and make sure every path that reads these values goes through it. That includes the checked-in placeholders for `http://localhost:${CODEINFO_SERVER_PORT}/mcp`, `http://localhost:${CODEINFO_CHAT_MCP_PORT}/mcp`, `http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp`, and `CODEINFO_PLAYWRIGHT_MCP_URL`. The consumers in scope include config seeding, chat runtime config loading, agent runtime config loading, flow and MCP execution, status probes, wrapper-facing guidance, and the main tests around those paths.
   - Where the answer came from: direct user answer in this planning conversation agreeing with the previously researched best answer, plus repository evidence in `server/src/config/codexConfig.ts`, `server/src/config/runtimeConfig.ts`, `server/src/routes/chat.ts`, `server/src/agents/config.ts`, `server/src/agents/service.ts`, `server/src/flows/service.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/providers/mcpStatus.ts`, and the related tests under `server/src/test/`.
   - Why it is the best answer: it solves the placeholder problem once upstream instead of patching each path separately, which keeps chat, agents, status checks, and tests aligned.

12. Require compose-wrapper and documentation validation for host-networking prerequisites.
   - Question being addressed: What platform-support and wrapper-validation requirement should this story document for host-networked `server` and `playwright-mcp` services, especially given the checked-in macOS/WSL/Linux compose wrapper behavior and Docker's host-networking constraints?
   - Why the question matters: `network_mode: host` changes how ports work, invalidates the existing `ports`/`networks` service shape, and may behave differently across Docker runtimes. This repository already centralizes Docker runtime differences in wrapper scripts, so the story should decide whether compatibility validation and failure messaging are mandatory rather than leaving developers to discover host-networking problems by trial and error.
   - What the answer is: require the compose wrapper and documentation to validate or clearly fail fast on host-networking prerequisites per environment, and explicitly document the supported host-network contract for the checked-in stacks.
   - Where the answer came from: direct user answer in this planning conversation agreeing with the previously researched best answer, plus repository evidence in `scripts/docker-compose-with-env.sh`, `package.json`, `AGENTS.md`, and this story file.
   - Why it is the best answer: it puts the environment-specific checks in the existing upstream wrapper layer, where this repository already handles Docker runtime differences, instead of expecting developers to diagnose host-networking problems manually.

13. Implement the flow and command re-ingest behavior first, then the MCP/config contract work, and leave the Docker host-network cutover until last.
   - Question being addressed: In what order should this story be implemented so the running local stack does not lose MCP functionality partway through the work?
   - Why the question matters: the checked-in `config.toml` files are visible to the running local stack before the compose services are restarted, so changing placeholder contracts or compose networking too early can break the MCP tools available during development even if the final host ports stay the same.
   - What the answer is: do the flow and command re-ingest behavior work first, including portable selectors, `current` and `all` targets, batch result recording, and empty-markdown skips. After that, do the MCP placeholder and env-contract work, then update the checked-in config files, then update compose and `.env` wiring, and only then perform the host-networking cutover and final restart-based validation.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the MCP tooling available for as long as possible during implementation, isolates the workflow-behavior changes from the environment-contract changes, and pushes the most self-disrupting Docker/networking work to the end when the stack is ready for final validation.

14. Complete and validate a pre-story MCP compatibility pass before implementing the story itself.
   - Question being addressed: Should the repository be prepared in advance so later `config.toml` placeholder changes do not immediately break the running local stack during story implementation?
   - Why the question matters: without this preparation, the running local compose stack can see checked-in `config.toml` edits before it is restarted, while still using older runtime config logic and older dedicated MCP env contracts. That mismatch can break the MCP tools needed to work through the story and its review flow.
   - What the answer is: yes. The repository now has a pre-story compatibility layer that resolves the planned MCP placeholders in memory, temporarily accepts `CODEINFO_CHAT_MCP_PORT` alongside the legacy `CODEINFO_MCP_PORT`, and has been validated after a local compose restart by checking the main server, classic `/mcp`, dedicated MCP, agents MCP, and Playwright MCP endpoints.
   - Where the answer came from: direct user decision in this planning conversation plus the implemented compatibility pre-work and restart validation completed immediately before this plan update.
   - Why it is the best answer: it preserves MCP tooling continuity while the story is being implemented, reduces the risk of the implementation flow failing mid-story for environment-contract reasons, and lets the main story stay focused on the planned behavior and Docker cutover work rather than emergency compatibility fixes.

15. Remove the temporary legacy `CODEINFO_MCP_PORT` fallback by the final end state and keep only `CODEINFO_CHAT_MCP_PORT` as the canonical dedicated MCP env contract.
   - Question being addressed: Should the final end state of this story remove the temporary legacy `CODEINFO_MCP_PORT` fallback and keep only `CODEINFO_CHAT_MCP_PORT` as the canonical dedicated MCP env contract?
   - Why the question matters: the current compatibility layer was added only to keep the running local stack stable while preparing the story. If the plan does not explicitly say whether that legacy fallback must be removed at the end, the implementation may accidentally leave a permanent dual-read contract in place and drift away from the repository's usual clean-cutover pattern.
   - What the answer is: yes. The story should treat the current dual-read support as temporary compatibility only and remove the legacy `CODEINFO_MCP_PORT` fallback by the final end state, leaving `CODEINFO_CHAT_MCP_PORT` as the single canonical dedicated MCP env contract once all checked-in compose files, env files, config placeholders, tests, and docs have been migrated.
   - Where the answer came from: direct user answer in this planning conversation agreeing with the previously researched best answer, plus repository evidence in this story, [config.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config.ts), [startupEnv.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/startupEnv.ts), [env-loading.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/env-loading.test.ts), and story `0000048`.
   - Why it is the best answer: it keeps the current compatibility pre-work explicitly temporary, matches the repository's earlier clean-cutover pattern for env renames, and prevents long-term ambiguity about which dedicated MCP env contract is authoritative.

16. Include the checked-in shared-home runtime configs under `codex/` in the MCP endpoint migration scope.
   - Question being addressed: Should this story update the checked-in shared-home runtime config files under `codex/` as part of the MCP endpoint migration, or only `config.toml.example` and `codex_agents/*`?
   - Why the question matters: the repository currently reads `codex/config.toml` and `codex/chat/config.toml` as active runtime inputs for chat and MCP flows, while `config.toml.example` is only a sample. If the story updates only the examples and agent configs, the checked-in shared-home runtime config can drift and continue to encode the old MCP assumptions.
   - What the answer is: yes, the story should include the checked-in shared-home runtime configs under `codex/` that are actually consumed at runtime, especially `codex/chat/config.toml` and `codex/config.toml` if it is present, alongside `codex_agents/*`. `config.toml.example` should still be updated, but only as documentation/sample coverage rather than being treated as the active runtime source.
   - Where the answer came from: direct user answer in this planning conversation agreeing with the previously researched best answer, plus repository evidence in [runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/runtimeConfig.ts), [codexConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/codexConfig.ts), [chatDefaults.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/chatDefaults.ts), [chat route](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/routes/chat.ts), [codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), [codexConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/codexConfig.test.ts), and [runtimeConfig.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/runtimeConfig.test.ts).
   - Why it is the best answer: it aligns the migration scope with the files the product actually reads at runtime, avoids leaving hidden old MCP assumptions in the checked-in shared-home config, and keeps `config.toml.example` in its proper sample/documentation role.

## Implementation Ideas

- Keep this as a single-repository implementation plan. The runtime behavior may operate on many ingested repositories, but all code, config, Docker, and test changes for this story belong in `codeInfo2`.

### Phase 1: Expand the re-ingest contract without weakening the strict re-ingest service

- Extend the command and flow schemas in `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` so a re-ingest step can be expressed as:
  - legacy explicit `sourceId`;
  - `target: "current"`;
  - `target: "all"`.
- Keep `server/src/ingest/reingestService.ts` strict on one canonical ingested `sourceId`. Do not move selector parsing or target expansion into that service.
- Add one shared orchestration seam above the strict service, likely alongside the existing re-ingest runtime code, that resolves a re-ingest request into one or more canonical repository roots by reusing `server/src/mcpCommon/repositorySelector.ts`.
- Reuse the ownership context that already exists:
  - direct commands resolve their owning repository in `server/src/agents/service.ts`;
  - top-level flows already carry `flowSourceId` in `server/src/flows/service.ts`;
  - nested flow commands already thread both `sourceId` and `flowSourceId` through `server/src/agents/commandItemExecutor.ts`.
- For `target: "all"`, sort the resolved repository list by ascending canonical container path before execution and use that same order everywhere: execution, logs, transcript payloads, and tests.

### Phase 2: Add batch recording and blank-markdown skip behavior at the shared seams

- Introduce one dedicated batch result shape for `target: "all"` in the re-ingest transcript/result path rather than repeating the single-repository payload. The likely seam is the existing re-ingest lifecycle/result code in:
  - `server/src/chat/reingestToolResult.ts`;
  - `server/src/chat/reingestStepLifecycle.ts`;
  - the command and flow call sites in `server/src/agents/commandsRunner.ts` and `server/src/flows/service.ts`.
- Keep single-repository result handling intact for explicit `sourceId` and resolved `current` runs.
- Implement the blank-markdown skip behavior in the shared markdown-backed execution path so commands and flows cannot drift:
  - `server/src/flows/markdownFileResolver.ts`;
  - `server/src/agents/commandItemExecutor.ts`;
  - flow LLM execution in `server/src/flows/service.ts`.
- The skip path should emit one consistent info log that includes the surface, resolved path, and skip reason, then continue safely to the next command item or flow step.

### Phase 3: Finish the shared MCP endpoint normalization and env migration

- Consolidate runtime MCP placeholder handling so checked-in config files hold placeholder or literal marker values, and the runtime materializes final literal MCP URLs before invoking Codex or related consumers.
- Keep `CODEINFO_PLAYWRIGHT_MCP_URL` as the full-URL override and finish the named-port placeholder path for:
  - `CODEINFO_SERVER_PORT`;
  - `CODEINFO_CHAT_MCP_PORT`;
  - `CODEINFO_AGENTS_MCP_PORT`.
- Use the shared runtime normalization path rather than surface-specific replacement code. The main seams are:
  - `server/src/config/runtimeConfig.ts`;
  - `server/src/config/codexConfig.ts`;
  - `server/src/config.ts`;
  - `server/src/config/startupEnv.ts`;
  - `server/src/agents/config.ts`;
  - `server/src/routes/chat.ts`;
  - `server/src/agents/service.ts`.
- Finish the env migration by removing the temporary legacy `CODEINFO_MCP_PORT` fallback once the checked-in env files, compose files, runtime config files, and tests all use `CODEINFO_CHAT_MCP_PORT`.
- Update the checked-in runtime config files that are actually consumed at runtime, not only examples:
  - `codex/config.toml`;
  - `codex/chat/config.toml`;
  - `config.toml.example`;
  - relevant agent configs under `codex_agents/`.

### Phase 4: Move the checked-in server and Playwright MCP compose surfaces to the final Docker/runtime model

- Keep the Docker image model explicit. `server/Dockerfile` and `client/Dockerfile` already build app code inside the image, so the host-networked runtime path should extend that approach instead of relying on host source bind mounts.
- Add the missing Docker packaging work for checked-in runtime assets that are currently mounted from the repo at runtime, especially the server-facing checked-in config and flow directories. Update the relevant `.dockerignore` files at the same time:
  - `.dockerignore`;
  - `server/.dockerignore`;
  - `client/.dockerignore`.
- Update the compose files that this story already scopes:
  - `docker-compose.yml`;
  - `docker-compose.local.yml`;
  - `docker-compose.e2e.yml`.
- For each host-networked `server` or `playwright-mcp` service:
  - remove incompatible `ports` and `networks` service wiring;
  - remove bridge-only assumptions such as service-name MCP URLs where they are no longer valid;
  - keep the startup command and env values aligned to the intended host-visible port.
- Preserve the explicit host-visible port inventory while doing this work:
  - main server `5010/5011/5012`;
  - local server `5510/5511/5512`;
  - e2e server `6010/6011/6012`;
  - local Playwright MCP `8931`;
  - main Playwright MCP uses the already chosen distinct port such as `8932`;
  - local Chrome DevTools `9222`.
- Prefer Docker-managed volumes for generated output that must persist, especially current Playwright output directories, and avoid bind-mounting checked-in source or config trees into the final host-networked runtime containers. The only planned host bind mount exception is logs that are intentionally meant to stay visible on the host.

### Phase 5: Add wrapper preflight and proof-oriented validation

- Extend `scripts/docker-compose-with-env.sh` so host-network prerequisites are validated before startup:
  - supported runtime is Linux Docker Engine or Docker Desktop `4.34+` with host networking enabled;
  - no incompatible compose keys remain on host-networked services;
  - no checked-in host-visible ports needed by this story are already occupied.
- Do not assume dedicated `/health` endpoints already exist on the MCP listeners or the Playwright MCP surface. Validation must either add explicit readiness checks or standardize port or MCP probes for:
  - main server listener;
  - chat MCP listener;
  - agents MCP listener;
  - Playwright MCP listener.
- Expand the current tests instead of assuming the existing harness is enough. Likely extensions are:
  - schema tests for the new re-ingest unions in `server/src/test/unit/agent-commands-schema.test.ts` and `server/src/test/unit/flows-schema.test.ts`;
  - re-ingest orchestration and batch tests near `server/src/test/unit/reingestService.test.ts` and the re-ingest MCP tests;
  - markdown skip coverage near `server/src/test/unit/markdown-file-resolver.test.ts`;
  - runtime placeholder and env migration coverage in `server/src/test/unit/runtimeConfig.test.ts` and related env-loading tests;
  - compose or wrapper validation coverage for host-network preflight behavior.

### Practical implementation order

1. Schema expansion for re-ingest unions in commands and flows.
2. Shared selector or target orchestration above the strict re-ingest service.
3. Batch transcript/result recording for `target: "all"`.
4. Blank-markdown skip handling in the shared markdown-backed execution path.
5. Shared MCP placeholder normalization and env-name migration.
6. Dockerfile, `.dockerignore`, compose, and runtime packaging changes for host networking and no-host-source-bind-mount runtime behavior.
7. Wrapper preflight plus proof-oriented tests and final validation.

### Highest-priority files to inspect first during implementation

- `server/src/agents/commandsSchema.ts`
- `server/src/flows/flowSchema.ts`
- `server/src/agents/commandsRunner.ts`
- `server/src/agents/commandItemExecutor.ts`
- `server/src/agents/service.ts`
- `server/src/flows/service.ts`
- `server/src/flows/markdownFileResolver.ts`
- `server/src/mcpCommon/repositorySelector.ts`
- `server/src/ingest/reingestService.ts`
- `server/src/chat/reingestToolResult.ts`
- `server/src/chat/reingestStepLifecycle.ts`
- `server/src/config/runtimeConfig.ts`
- `server/src/config/codexConfig.ts`
- `server/src/config.ts`
- `server/src/config/startupEnv.ts`
- `server/src/index.ts`
- `docker-compose.yml`
- `docker-compose.local.yml`
- `docker-compose.e2e.yml`
- `server/Dockerfile`
- `client/Dockerfile`
- `.dockerignore`
- `server/.dockerignore`
- `client/.dockerignore`
- `scripts/docker-compose-with-env.sh`

## Test Harnesses

- This story should keep most verification in the harnesses the repository already has. No new harness type is needed for re-ingest schema changes, re-ingest orchestration, batch result payloads, blank-markdown skip behavior, MCP placeholder normalization, or end-to-end runtime checks. Those should extend the existing server `node:test` suites under `server/src/test/unit` and `server/src/test/integration`, the server cucumber suites under `server/src/test/features` and `server/src/test/steps`, the client Jest suites under `client/src/test`, and the existing summary-wrapper entry points in `scripts/test-summary-server-unit.mjs`, `scripts/test-summary-server-cucumber.mjs`, `scripts/test-summary-client.mjs`, and `scripts/test-summary-e2e.mjs`.
- This story does require one genuinely new harness type: a shell-wrapper preflight harness for `scripts/docker-compose-with-env.sh`. The repository currently has no shell-script test runner or shell-wrapper fixture harness, and story `0000050` adds fail-before-start behavior that existing unit, integration, cucumber, client, and Playwright coverage cannot prove cleanly because those harnesses only see application behavior after startup or after a Node runner has already taken control.
- Create that new harness alongside the wrapper code it owns so the responsibility stays in one place:
  - `scripts/test/bats/docker-compose-with-env.bats` should hold the executable shell test cases for wrapper preflight behavior;
  - `scripts/test/bats/test_helper/common.bash` should provide shared repo-root discovery, temp-directory setup, PATH overrides, and reusable assertion helpers;
  - `scripts/test/bats/fixtures/bin/` should contain stub executables such as fake `docker`, `uname`, and any port-probe helper used by the wrapper so tests can force Linux versus Darwin behavior, Docker Desktop host-network support states, docker-context responses, and occupied-port cases without touching the real host daemon;
  - `scripts/test-summary-shell.mjs` should be added as the summary-wrapper entry point for this harness so shell tests follow the same wrapper-first output contract and saved-log behavior already used elsewhere in the repository;
  - root `package.json` should expose that wrapper through one dedicated script such as `test:summary:shell`.
- Use `bats-core` for this new harness. DeepWiki and Context7 both document that Bats keeps Bash test suites maintainable with `.bats` files, shared helper loading, and `setup_file` or `setup` or `teardown` functions. The planned wrapper tests should use `run -1` or `run !` for expected preflight failures and `run --separate-stderr` when the wrapper is expected to place the user-facing prerequisite message on stderr.
- The minimum shell-harness scenarios for this story are:
  - host networking unsupported or disabled for the checked-in compose workflow causes the wrapper to exit before `docker compose` is invoked and prints the missing prerequisite clearly;
  - a checked-in host-visible port required by the selected compose file is already in use, and the wrapper exits before `docker compose` is invoked and names the conflicting port;
  - a supported environment with clear ports reaches the compose exec path and preserves the expected env-file and compose arguments;
  - an unsupported host-network service shape still present in the compose configuration causes a fail-fast wrapper exit before container startup.
- Do not add another new harness type for readiness or listener validation. Those checks should extend the existing compose and e2e path instead of creating a second new framework:
  - startup or teardown proof stays in `scripts/test-summary-e2e.mjs` and the compose wrappers;
  - runtime listener and contract coverage stays in existing server unit or integration suites and any related fixture helpers already under `server/src/test/support`.
- The evidence for this section comes from current repository inspection and external harness documentation:
  - repository facts from `package.json`, `scripts/test-summary-server-unit.mjs`, `scripts/test-summary-server-cucumber.mjs`, `scripts/test-summary-client.mjs`, `scripts/test-summary-e2e.mjs`, `scripts/summary-wrapper-protocol.mjs`, and `scripts/docker-compose-with-env.sh`;
  - shell-harness guidance from DeepWiki and Context7 documentation for `bats-core`, which both describe `.bats` file organization, helper loading, and `run`-based exit-code or stdout or stderr assertions.
