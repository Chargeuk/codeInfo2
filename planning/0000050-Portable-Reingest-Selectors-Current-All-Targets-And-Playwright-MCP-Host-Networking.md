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

For consistency across the story, `reingested`, `skipped`, and `failed` are the user-facing transcript outcomes. Lower-level ingest terminal states such as `completed`, `cancelled`, and `error` may still exist underneath in the strict single-repository service contract, but transcript payloads should expose the normalized user-facing outcome directly.

This story should preserve the current blocking re-ingest semantics. A workflow step should still wait for each re-ingest target to reach a terminal outcome before moving on. Pre-start validation failures should still fail the relevant workflow step early with a clear message. Terminal ingest failures should still be recorded as structured outcomes rather than being silently swallowed.

This story also tightens one part of the markdown-file workflow contract used by commands and flows. If a loaded markdown file resolves successfully but its content is empty or contains only whitespace, the runtime should not try to execute that instruction as an empty prompt. Instead, that specific flow or command step should be skipped, and the system should emit an info-level log entry that makes it clear the step was skipped because the resolved markdown content was empty. This keeps reusable prompt files safe to leave temporarily blank without turning them into confusing no-op agent calls or avoidable failures.

That empty-markdown skip behavior should be implemented with a concrete log contract. The runtime should only skip when the markdown file resolved successfully but the final content is empty after whitespace trimming, and the info-level log entry should explicitly state the execution surface (`command` or `flow`), the resolved markdown file path, and that the step was skipped because the resolved markdown content was empty or whitespace-only.

In addition to the workflow re-ingest work, this story also includes an explicit host-networking implementation for the checked-in manual-testing and runtime containers that expose MCP surfaces. The current stack still relies on bridge networking assumptions for the `playwright-mcp` container and on published-port mapping for the `server` container. The user has now fixed the desired direction for this story: move the checked-in `server` and `playwright-mcp` containers onto host networking where they already exist, so manual testing and Codex MCP connections no longer depend on bridge-only service DNS assumptions.

This host-networking work is not just a one-line Compose change. Docker host networking means each process must bind the actual host-visible port it should use, because Compose `ports` mappings no longer provide the translation layer for that service. The story therefore must preserve the checked-in host-visible port contract unless a change is required to avoid a clash:

- `docker-compose.local.yml` server stays available on host ports `5510`, `5511`, and `5512`, so the local host-networked server process must bind those ports directly;
- `docker-compose.local.yml` Playwright MCP stays available on host port `8931`;
- `docker-compose.yml` server stays available on host ports `5010`, `5011`, and `5012`;
- `docker-compose.yml` Playwright MCP must move to checked-in host port `8932` so the main and local stacks do not clash;
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
- Current schema tooling matters for Task 1. The repo uses Zod `3.25.76`, and current documentation confirms `z.discriminatedUnion()` requires variants that differ on the discriminator value. Because every re-ingest request shape still uses `type: "reingest"`, the new schema union must be modeled as a plain `z.union()` of strict object shapes or an equivalent mutual-exclusion approach rather than as `z.discriminatedUnion('type', ...)`.
- Current transcript persistence already uses `Turn.toolCalls` with `Schema.Types.Mixed` in `server/src/mongo/turn.ts`, so the new batch payload can fit without a Mongo schema migration. Current Mongoose behavior also minimizes empty objects by default, so backward-compatible readers should treat optional nested fields as omitted when absent rather than depending on empty-object persistence.
- Current browser-debugging evidence confirms the local `9222` contract is a Chromium Chrome DevTools Protocol endpoint, not a generic browser-control URL. Playwright documentation only supports `connectOverCDP()` for Chromium-based browsers and accepts either `http://localhost:9222` or a CDP websocket URL, while warning that this remains distinct from the Playwright protocol and lower fidelity than direct Playwright connections.

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
- The checked-in default Playwright MCP port strategy uses distinct defaults for the existing stacks, keeping `8931` for `docker-compose.local.yml` and using `8932` for `docker-compose.yml`.
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
   - What the answer is: keep `8931` for `docker-compose.local.yml` and use checked-in port `8932` for `docker-compose.yml`.
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
- Add one shared orchestration seam above the strict service in the command and flow runners so both `server/src/agents/commandsRunner.ts` and `server/src/flows/service.ts` resolve a re-ingest request into one or more canonical repository roots by reusing `server/src/mcpCommon/repositorySelector.ts`.
- Reuse the ownership context that already exists:
  - direct commands resolve their owning repository in `server/src/agents/service.ts`;
  - top-level flows already carry `flowSourceId` in `server/src/flows/service.ts`;
  - nested flow commands already thread both `sourceId` and `flowSourceId` through `server/src/agents/commandItemExecutor.ts`.
- For `target: "all"`, sort the resolved repository list by ascending canonical container path before execution and use that same order everywhere: execution, logs, transcript payloads, and tests.

### Phase 2: Add batch recording and blank-markdown skip behavior at the shared seams

- Introduce one dedicated batch result shape for `target: "all"` in the re-ingest transcript/result path rather than repeating the single-repository payload. The implementation seam for that work is the existing re-ingest lifecycle/result code in:
  - `server/src/chat/reingestToolResult.ts`;
  - `server/src/chat/reingestStepLifecycle.ts`;
  - the command and flow call sites in `server/src/agents/commandsRunner.ts` and `server/src/flows/service.ts`.
- Keep the single-repository execution flow for explicit `sourceId` and resolved `current` runs, but extend the single-result payload to match the contract defined in `## Message Contracts And Storage Shapes`.
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
  - `codex_agents/coding_agent/config.toml`;
  - `codex_agents/lmstudio_agent/config.toml`;
  - `codex_agents/planning_agent/config.toml`;
  - `codex_agents/research_agent/config.toml`;
  - `codex_agents/tasking_agent/config.toml`;
  - `codex_agents/vllm_agent/config.toml`.

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
  - main Playwright MCP uses checked-in port `8932`;
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
  - add the wrapper and probe entry points that make the final proof path runnable, not just theoretically testable:
    - `scripts/test-summary-shell.mjs` plus a root `package.json` script for the new shell harness;
    - a checked-in main-stack runtime proof wrapper under `scripts/` plus a root `package.json` script that probes the live host-visible ports and MCP surfaces after `npm run compose:up`;
    - any `e2e:test` env injection updates needed so `npm run test:summary:e2e` still points at the host-visible URLs that exist after the host-network cutover.

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

## Feasibility Proof Pass

This remains a single-repository story inside `codeInfo2`. The proof pass below makes the implementation status explicit for each major implementation area so the story does not assume missing seams already exist.

### 1. Re-ingest contract expansion for `sourceId`, `current`, and `all`

- Already existing capabilities:
  - Command and flow files already support a strict `type: "reingest"` step with `sourceId` in `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts`.
  - The ingest layer already has a strict single-repository re-ingest service in `server/src/ingest/reingestService.ts`.
  - Repository lookup by case-insensitive id and by canonical path already exists in `server/src/mcpCommon/repositorySelector.ts`, including the current "latest ingest wins" behavior for duplicate ids.
  - Command and flow execution already carry ownership context that can support a future `current` resolver, including `sourceId` and `flowSourceId` handling in `server/src/agents/commandItemExecutor.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts`.
- Missing prerequisite capabilities:
  - No schema or runtime contract currently accepts `target: "current"` or `target: "all"`; those unions must be added first in `server/src/agents/commandsSchema.ts`, `server/src/flows/flowSchema.ts`, and any validation layers that consume those types.
  - No orchestration seam currently expands one re-ingest request into an ordered list of canonical repositories before calling the strict service.
  - No current runtime path records deterministic `all` ordering or sequential fan-out above `runReingestRepository`.
- Assumptions that are currently invalid:
  - It is not valid to assume that existing re-ingest code can accept `current` or `all` by configuration alone; the current code only understands `sourceId`.
  - It is not valid to assume that `repositorySelector` already powers re-ingest execution semantics; it is a lookup helper, not an `all`-target execution layer.
  - It is not valid to assume that deterministic `all` ordering already exists anywhere in the re-ingest runtime.
- Feasibility and sequencing note:
  - This area is feasible without upstream repository changes because the strict service, repository lookup helper, and ownership context already exist. The prerequisite work is local orchestration and schema expansion inside this repository, and it must happen before any transcript or UI contract work for `target: "all"`.

### 2. Batch result recording and blank-markdown skip behavior

- Already existing capabilities:
  - Single re-ingest transcript payload construction already exists in `server/src/chat/reingestToolResult.ts`, with lifecycle integration in `server/src/chat/reingestStepLifecycle.ts`.
  - Shared markdown resolution already exists in `server/src/flows/markdownFileResolver.ts`.
  - Both commands and flows already call shared markdown-backed execution seams through `server/src/agents/commandItemExecutor.ts` and `server/src/flows/service.ts`.
  - Existing tests already cover markdown resolution and single re-ingest payload behavior in `server/src/test/unit/markdown-file-resolver.test.ts`, `server/src/test/integration/commands.markdown-file.test.ts`, and `server/src/test/unit/reingest-tool-result.test.ts`.
- Missing prerequisite capabilities:
  - There is no dedicated batch result payload for `target: "all"` yet; `server/src/chat/reingestToolResult.ts` currently models one terminal outcome for one `sourceId`.
  - There is no runtime seam yet that accumulates ordered per-repository outcomes into one transcript item for a batch.
  - The strict `ReingestSuccess` contract in `server/src/ingest/reingestService.ts` currently collapses internal ingest `skipped` into terminal `completed`, so the story cannot yet distinguish `reingested` versus `skipped` honestly in transcript payloads.
  - There is no explicit blank-markdown skip contract in the shared execution path; `server/src/agents/commandItemExecutor.ts` currently passes resolved markdown content straight into instruction execution.
- Assumptions that are currently invalid:
  - It is not valid to assume that the current re-ingest transcript payload can represent multiple repositories in one result.
  - It is not valid to assume that empty or whitespace-only markdown content is already skipped; the current code resolves content and passes it through.
  - It is not valid to assume the current tests already prove skip logging or batch payload ordering.
- Feasibility and sequencing note:
  - This area is feasible because the single-result lifecycle and shared markdown resolver already exist. The prerequisite work is the new batch payload shape plus one shared skip guard above the existing execution calls, and those should land immediately after re-ingest target expansion so the batch runtime and transcript contract are designed together.

### 3. MCP endpoint placeholder normalization and env migration

- Already existing capabilities:
  - Runtime config normalization already supports `${ENV}` replacement and direct full-value placeholder replacement in `server/src/config/runtimeConfig.ts`.
  - The codex bootstrap path already rewrites server MCP URLs in `server/src/config/codexConfig.ts`.
  - Distinct MCP listener ports already exist in runtime config and server startup: `server/src/config.ts`, `server/src/mcp2/server.ts`, `server/src/mcpAgents/server.ts`, and `server/src/index.ts`.
  - The temporary env migration seam already exists because `server/src/config.ts` currently reads `CODEINFO_CHAT_MCP_PORT` and falls back to `CODEINFO_MCP_PORT`.
- Missing prerequisite capabilities:
  - The checked-in TOML files under `codex/` and `codex_agents/` have not yet been fully migrated to one explicit placeholder strategy.
  - The codex bootstrap replacement path still includes literal `5010` rewrite behavior in `server/src/config/codexConfig.ts`, so the repository still depends partly on legacy hard-coded MCP URL assumptions.
  - The final end state still needs one shared, audited placeholder contract across runtime config, bootstrap config, env files, tests, and docs before the legacy `CODEINFO_MCP_PORT` fallback can be removed.
- Assumptions that are currently invalid:
  - It is not valid to assume that all checked-in config assets already use the new placeholder contract.
  - It is not valid to assume that the legacy env name can be removed today without first migrating the checked-in configs and tests that still depend on it.
  - It is not valid to assume that all MCP surfaces currently resolve from a single centralized placeholder implementation; some bootstrap behavior still relies on literal rewrites.
- Feasibility and sequencing note:
  - This area is feasible because the runtime already has placeholder normalization and separate MCP listeners. The prerequisite work is a complete local migration sweep plus cleanup of the temporary fallback, and it should happen before Compose host-network cutover so the checked-in config files already describe the final endpoint contract.

### 4. Docker and Compose host-network runtime changes

- Already existing capabilities:
  - The server and client are already built into images from `server/Dockerfile` and `client/Dockerfile`; the story does not need a brand-new image-build system.
  - The checked-in compose files already define the current host-visible port inventory for the server stacks in `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`.
  - Separate MCP listeners already exist in the server runtime, so binding the host-visible server ports directly is technically possible once Compose wiring changes.
- Missing prerequisite capabilities:
  - None of the checked-in compose files currently use `network_mode: host` for the scoped `server` and `playwright-mcp` services.
  - The checked-in compose files still rely on `ports`, bridge networks, `host.docker.internal`, and bind-mounted checked-in runtime assets, so the final host-network runtime model and packaging rules are not implemented yet.
  - The checked-in main stack still configures `playwright-mcp` on `8931`, so the plan’s separate main-stack Playwright port must be made real during implementation to avoid a clash with the local stack.
  - The wrapper and compose definitions do not yet encode the final host-network prerequisite checks or explicit port-conflict validation.
- Assumptions that are currently invalid:
  - It is not valid to assume that current Compose `ports` mappings can stay in place for host-networked services. Official Docker docs say published ports are discarded in host network mode and the container process must bind the intended host port directly.
  - It is not valid to assume that host networking is universally available; official Docker docs say it is supported on Linux Docker Engine and on Docker Desktop `4.34+` only when the feature is enabled.
  - It is not valid to assume that the current bridge-style service DNS and host-gateway assumptions will remain correct after the `server` and `playwright-mcp` services move to host networking.
- Feasibility and sequencing note:
  - This area is feasible because the images, runtime listeners, and port inventory already exist, but it has the heaviest prerequisite work. The config and env migration should finish first, then the Compose and Docker packaging changes can move the checked-in stacks to their final host-network shape without leaving stale endpoint assumptions behind.

### 5. Wrapper preflight and proof-oriented validation

- Already existing capabilities:
  - `scripts/docker-compose-with-env.sh` already centralizes Compose startup, env-file handling, Docker socket resolution, and UID or GID behavior, so there is an existing upstream place to enforce host-network prerequisites.
  - The repository already has wrapper-first test and build patterns in `scripts/summary-wrapper-protocol.mjs`, `scripts/test-summary-server-unit.mjs`, `scripts/test-summary-client.mjs`, `scripts/test-summary-server-cucumber.mjs`, and `scripts/test-summary-e2e.mjs`.
  - The server already exposes `/health` on the main API listener in `server/src/index.ts`, and `server/src/providers/mcpStatus.ts` already has an MCP URL probe helper.
- Missing prerequisite capabilities:
  - The Compose wrapper does not yet perform host-network support checks, port-availability checks, or fail-fast validation for unsupported service shapes.
  - There is no dedicated shell-script harness yet for wrapper preflight behavior; that is why this story now includes the new `## Test Harnesses` section.
  - There is no checked-in proof contract yet for MCP listener readiness on the dedicated MCP listeners or on Playwright MCP.
- Assumptions that are currently invalid:
  - It is not valid to assume the existing wrapper already proves host-network readiness or port safety before `docker compose` runs.
  - It is not valid to assume that `/health` exists for every listener the story needs to validate.
  - It is not valid to assume that the existing e2e path can prove fail-before-start wrapper behavior without the new shell harness.
- Feasibility and sequencing note:
  - This area is feasible because the wrapper and summary-protocol infrastructure already exist. The prerequisite work is explicit preflight logic plus the new shell harness, and those should land alongside the Compose cutover so the final host-network path is validated the same way it is introduced.

## Message Contracts And Storage Shapes

This remains a single-repository contract definition inside `codeInfo2`. The files below are the contract owners and consumers for this story, and the definitions here should be treated as the target shapes for implementation rather than being rediscovered later.

### 1. Re-ingest request contract for command and flow JSON

- Contract owners:
  - `server/src/agents/commandsSchema.ts`
  - `server/src/flows/flowSchema.ts`
- Contract consumers:
  - `server/src/agents/commandItemExecutor.ts`
  - `server/src/agents/commandsRunner.ts`
  - `server/src/agents/service.ts`
  - `server/src/flows/service.ts`
- Target request union:
  - Legacy selector form remains valid:
    ```json
    { "type": "reingest", "sourceId": "<selector-or-path>" }
    ```
  - New current-owner form:
    ```json
    { "type": "reingest", "target": "current" }
    ```
  - New all-repositories form:
    ```json
    { "type": "reingest", "target": "all" }
    ```
- Resolution rules:
  - `sourceId` remains backward compatible, but it now means one of:
    - a case-insensitive repository id;
    - a canonical container path;
    - a matching host path.
  - `target: "current"` resolves from the owning repository already threaded through direct-command, flow, and flow-command execution.
  - `target: "all"` resolves to the ordered list of all currently ingested repositories sorted by ascending canonical container path.
  - A request object must not contain both `sourceId` and `target`.
- Downstream compatibility rule:
  - The strict ingest service in `server/src/ingest/reingestService.ts` stays single-repository. The orchestration layer must resolve any selector or target form into one or more canonical `sourceId` strings before calling the strict service.

### 2. Strict single-repository re-ingest result contract

- Contract owner:
  - `server/src/ingest/reingestService.ts`
- Contract consumers:
  - `server/src/chat/reingestToolResult.ts`
  - `server/src/agents/commandsRunner.ts`
  - `server/src/flows/service.ts`
- Existing fields that stay:
  - `status`
  - `operation`
  - `runId`
  - `sourceId`
  - `durationMs`
  - `files`
  - `chunks`
  - `embedded`
  - `errorCode`
- Required contract extension for this story:
  - Add `resolvedRepositoryId: string | null` so result payloads can identify the selected repository without re-looking it up downstream.
  - Add `completionMode: "reingested" | "skipped" | null` so the runtime can preserve the difference between a completed re-ingest that did work and an internal ingest terminal state of `skipped`.
- Compatibility rule:
  - `status` continues to use the existing terminal values `completed`, `cancelled`, and `error`.
  - `completionMode` is only meaningful when `status === "completed"`. For `cancelled` or `error`, it must be `null`.
  - Existing fields stay in place so current single-repository consumers can be updated in-place without a storage migration.

### 3. Transcript tool-result payload contract

- Contract owners:
  - `server/src/chat/reingestToolResult.ts`
  - `server/src/chat/reingestStepLifecycle.ts`
- Contract consumers:
  - `server/src/chat/interfaces/ChatInterface.ts`
  - `server/src/mongo/repo.ts`
  - `server/src/mongo/turn.ts`
  - client transcript readers that already consume stored `toolCalls`
- Single-repository payload shape:
  - Keep the existing payload kind and step type, but extend it to preserve the request mode and the resolved repository identity:
    ```json
    {
      "kind": "reingest_step_result",
      "stepType": "reingest",
      "targetMode": "sourceId",
      "requestedSelector": "<original selector>",
      "sourceId": "<canonical container path>",
      "resolvedRepositoryId": "<repo id or null>",
      "outcome": "reingested",
      "status": "completed",
      "completionMode": "reingested",
      "operation": "reembed",
      "runId": "<run id>",
      "files": 0,
      "chunks": 0,
      "embedded": 0,
      "errorCode": null
    }
    ```
  - `targetMode` is `"sourceId"` for explicit selector runs and `"current"` for owner-derived runs.
  - `requestedSelector` stores the original `sourceId` string for explicit selector runs and `null` for `current`.
  - `sourceId` keeps its existing meaning as the canonical resolved container path so older consumers do not lose the main identifier they already expect.
  - `outcome` is the normalized user-facing value:
    - `reingested` when `status === "completed"` and `completionMode === "reingested"`;
    - `skipped` when `status === "completed"` and `completionMode === "skipped"`;
    - `failed` when `status === "cancelled"` or `status === "error"`.
- Batch payload shape for `target: "all"`:
  - Introduce a new discriminated payload variant rather than overloading the single-repository shape:
    ```json
    {
      "kind": "reingest_step_batch_result",
      "stepType": "reingest",
      "targetMode": "all",
      "repositories": [
        {
          "sourceId": "<canonical container path>",
          "resolvedRepositoryId": "<repo id or null>",
          "outcome": "reingested",
          "status": "completed",
          "completionMode": "reingested",
          "runId": "<run id or null>",
          "files": 0,
          "chunks": 0,
          "embedded": 0,
          "errorCode": null,
          "errorMessage": null
        }
      ],
      "summary": {
        "total": 1,
        "reingested": 1,
        "skipped": 0,
        "failed": 0
      }
    }
    ```
  - `repositories` must remain in ascending canonical container path order.
  - `outcome` is the normalized user-facing field for each repository item:
    - `reingested` when `status === "completed"` and `completionMode === "reingested"`;
    - `skipped` when `status === "completed"` and `completionMode === "skipped"`;
    - `failed` when `status === "cancelled"` or `status === "error"`.
  - `summary.failed` counts any repository item with `status === "error"` or `status === "cancelled"`.
  - `completionMode` is `null` when `status` is `cancelled` or `error`.
- Validation and compatibility rule:
  - This is a discriminated-union expansion, not a replacement. The existing single payload stays valid, and the new batch payload is added as a second `kind` variant so the repo can extend current Zod and runtime parsing without breaking older stored turns.
  - `outcome` is the normalized transcript-facing field, while `status` and `completionMode` remain the lower-level runtime detail fields needed to preserve the existing strict-service semantics.
  - This matches the repository evidence from `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, and `server/src/chat/interfaces/ChatInterface.ts`, and it also matches the additive discriminated-union guidance gathered from DeepWiki and Context7 for `colinhacks/zod`.

### 4. Turn storage impact

- Storage owner:
  - `server/src/mongo/turn.ts`
- Storage writer:
  - `server/src/mongo/repo.ts`
  - `server/src/chat/reingestStepLifecycle.ts`
- Storage rule for this story:
  - No new Mongo collection or top-level turn fields are required.
  - The existing `Turn.toolCalls: Record<string, unknown> | null` shape remains the storage envelope for both `reingest_step_result` and `reingest_step_batch_result`.
  - `Turn.runtime` remains unchanged for this story; the new re-ingest selector and batch details live inside `toolCalls`, not in a new runtime or conversation flag shape.
- Migration expectation:
  - Existing stored turns with the old single payload remain valid. New code must accept both the old single payload shape and the extended single or batch shapes during read and replay.

### 5. Blank-markdown skip message contract

- Contract owners:
  - `server/src/flows/markdownFileResolver.ts`
  - `server/src/agents/commandItemExecutor.ts`
  - `server/src/flows/service.ts`
- Contract rule:
  - Empty-markdown skip is a log and control-flow contract, not a new persisted storage shape.
  - When a markdown file resolves successfully but trims to empty content, the runtime must emit one info-level log entry with:
    - `surface`: `command` or `flow`;
    - `markdownFile`: the relative markdown reference from the step or command item;
    - `resolvedPath`: the final resolved file path;
    - `reason`: `empty_markdown`;
    - execution context such as `commandName`, `flowName`, or `stepIndex` when available.
  - The skip should not create a synthetic tool-result payload or a new database record format by itself. Existing turn persistence continues unchanged unless the surrounding flow or command already emits its own normal turns.

### 6. Wrapper fail-fast output contract

- Contract owner:
  - `scripts/docker-compose-with-env.sh`
- Contract consumers:
  - human operators;
  - AI agents using wrapper stdout and the saved summary logs;
  - the new shell harness defined in `## Test Harnesses`.
- Contract rule:
  - Host-network prerequisite failures remain operational output, not Mongo-persisted storage.
  - The wrapper must fail before `docker compose` execution and print which compose workflow or service failed preflight, which prerequisite was missing or incompatible, and which host port was conflicting when relevant.
  - This fail-fast output should remain compatible with the repository's existing wrapper-first workflow by keeping diagnostics in wrapper stdout and the saved wrapper log rather than inventing a second persistence surface.
- Evidence note:
  - Repository contract ownership for this section came from `scripts/docker-compose-with-env.sh`, `scripts/summary-wrapper-protocol.mjs`, `server/src/mongo/turn.ts`, `server/src/mongo/repo.ts`, `server/src/chat/reingestToolResult.ts`, and `server/src/chat/reingestStepLifecycle.ts`, with additive union guidance confirmed via DeepWiki and Context7 documentation for `colinhacks/zod`.

## Edge Cases and Failure Modes

- Re-ingest selector resolution edge cases:
  - Duplicate case-insensitive repository ids are not treated as a hard ambiguity for this story. The runtime must keep the existing selector behavior of choosing the latest ingest, and the resulting transcript payload should record the resolved repository id and canonical path so the selection is visible after the fact.
  - `target: "current"` must fail fast with a clear message when the current command or flow does not have an owning repository path available. It must not silently fall back to the working folder, the `codeInfo2` repo, or the first ingested repository.
  - `target: "all"` with zero currently ingested repositories should return one successful batch payload with `summary.total = 0` and an empty ordered `repositories` array, rather than throwing a synthetic failure for an otherwise valid maintenance action.
  - `target: "all"` must preserve deterministic ascending canonical container path order even when repository ids, host paths, or ingest timestamps differ.
- Strict re-ingest validation and terminal-state edge cases:
  - Existing strict validation failures from `server/src/ingest/reingestService.ts` such as `missing`, `non_absolute`, `non_normalized`, `ambiguous_path`, `unknown_root`, `busy`, and `invalid_state` must remain distinguishable after the new selector or target orchestration layer is added. The new layer must not collapse them into one generic error message.
  - Internal ingest terminal state `skipped` currently maps to `completed` in the strict service. The story must preserve that low-level behavior for service compatibility while surfacing the normalized transcript outcome as `skipped`.
  - `WAIT_TIMEOUT`, missing run status, and other deterministic terminal failures must become `failed` transcript outcomes with the underlying `errorCode` preserved.
  - In `target: "all"` mode, a failure for one repository must not abort the remaining repositories. The batch continues sequentially, records the failed repository item, and proceeds to the next repository so the final batch result shows the full estate outcome.
- Blank-markdown edge cases:
  - Only successfully resolved markdown content that trims to empty should be skipped.
  - Missing files, absolute paths, parent-directory traversal, permission failures, invalid UTF-8, or other read errors from `server/src/flows/markdownFileResolver.ts` remain hard failures and must not be reclassified as skips.
  - A markdown file containing only whitespace or blank lines must produce the documented info-level skip log and no synthetic tool-result payload of its own.
- MCP placeholder and env-migration edge cases:
  - Unresolved placeholder tokens must never be passed through silently as runtime MCP URLs. If required placeholder values are missing by the final end state, runtime normalization should fail clearly rather than leaving literal `${CODEINFO_*}` or `CODEINFO_PLAYWRIGHT_MCP_URL` strings in the effective config.
  - During the migration window, mixed `CODEINFO_MCP_PORT` and `CODEINFO_CHAT_MCP_PORT` support remains temporary compatibility only. By the final end state, checked-in env files, tests, and runtime configs must stop depending on `CODEINFO_MCP_PORT`.
  - Checked-in config files that still reference `http://server:...` or other bridge-only MCP assumptions after the host-network cutover are story failures, even if one local environment still happens to resolve them.
- Host-network and wrapper-preflight edge cases:
  - A host-networked service definition that still contains incompatible `ports` or `networks` keys must fail wrapper preflight before `docker compose` starts.
  - Unsupported environments, disabled host networking on Docker Desktop, or occupied checked-in host ports must fail fast before startup with a message that names the affected compose file or service and the reason.
  - The main and local Playwright MCP stacks must never compete for the same checked-in host port. `docker-compose.yml` uses `8932`, and `docker-compose.local.yml` uses `8931`.
  - After host-network cutover, service-name DNS assumptions such as `http://playwright-mcp:8931/...` or `http://server:...` must not remain in runtime paths that are supposed to talk to host-networked services.
- Persistence and transcript compatibility edge cases:
  - Historical turns containing the older single `reingest_step_result` payload must remain readable after the story lands.
  - New `reingest_step_batch_result` payloads must still fit inside the existing `Turn.toolCalls` envelope without requiring a Mongo migration.
  - One `target: "all"` run records one batch result payload, not one synthetic turn pair per repository, so large refresh runs do not flood the transcript.
- Evidence note:
  - Repository failure-mode evidence for this section came from `server/src/ingest/reingestService.ts`, `server/src/test/unit/reingestService.test.ts`, `server/src/flows/markdownFileResolver.ts`, `server/src/test/unit/markdown-file-resolver.test.ts`, `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, `server/src/config/runtimeConfig.ts`, `server/src/config/codexConfig.ts`, `server/src/config.ts`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, and `scripts/docker-compose-with-env.sh`.
  - External host-network failure-mode guidance was cross-checked with DeepWiki on `docker/docs` and Context7 on `/docker/compose`.

## Test Harnesses

- This story should keep most verification in the harnesses the repository already has. No new harness type is needed for re-ingest schema changes, re-ingest orchestration, batch result payloads, blank-markdown skip behavior, MCP placeholder normalization, or end-to-end runtime checks. Those should extend the existing server `node:test` suites under `server/src/test/unit` and `server/src/test/integration`, the server cucumber suites under `server/src/test/features` and `server/src/test/steps`, the client Jest suites under `client/src/test`, and the existing summary-wrapper entry points in `scripts/test-summary-server-unit.mjs`, `scripts/test-summary-server-cucumber.mjs`, `scripts/test-summary-client.mjs`, and `scripts/test-summary-e2e.mjs`.
- This story does require one genuinely new harness type: a shell-wrapper preflight harness for `scripts/docker-compose-with-env.sh`. The repository currently has no shell-script test runner or shell-wrapper fixture harness, and story `0000050` adds fail-before-start behavior that existing unit, integration, cucumber, client, and Playwright coverage cannot prove cleanly because those harnesses only see application behavior after startup or after a Node runner has already taken control.
- Create that new harness alongside the wrapper code it owns so the responsibility stays in one place:
  - `scripts/test/bats/docker-compose-with-env.bats` should hold the executable shell test cases for wrapper preflight behavior;
  - `scripts/test/bats/test_helper/common.bash` should provide shared repo-root discovery, temp-directory setup, PATH overrides, and reusable assertion helpers;
  - `scripts/test/bats/fixtures/bin/` should contain stub executables such as fake `docker`, `uname`, and any port-probe helper used by the wrapper so tests can force Linux versus Darwin behavior, Docker Desktop host-network support states, docker-context responses, and occupied-port cases without touching the real host daemon;
  - `scripts/test/bats/vendor/bats-core/`, `scripts/test/bats/vendor/bats-support/`, and `scripts/test/bats/vendor/bats-assert/` should be checked in so the shell harness can run from a clean checkout without requiring a globally installed Bats runtime;
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

## Proof Path Readiness

- `npm run test:summary:server:unit`
  - Already exists today.
  - Proof-path prerequisite: only the new unit coverage needs to be added; no new runtime or wrapper is required for this proof step to remain runnable.
- `npm run test:summary:shell`
  - Does not exist today.
  - Story prerequisite: add `scripts/test-summary-shell.mjs`, add the root script entry, add the `.bats` files and fixtures, and check in the Bats runtime and helper libraries under `scripts/test/bats/vendor/` so the proof step runs on a clean checkout without global installs.
- `npm run compose:build:summary`
  - Already exists today.
  - Proof-path prerequisite: Dockerfile, `.dockerignore`, and Compose changes must keep using the existing wrapper-first build flow so this command remains the build proof step instead of being replaced by ad hoc raw Docker commands.
- `npm run test:summary:e2e`
  - Already exists today.
  - Proof-path prerequisite: if the host-network cutover changes any host-visible URL or port that the e2e wrapper assumes, the story must update the e2e env injection and related checked-in e2e config at the same time so this wrapper still points at the real runtime addresses when final validation is reached.
- Main-stack runtime proof
  - The compose lifecycle wrappers already exist today as `npm run compose:build`, `npm run compose:up`, and `npm run compose:down`, but there is no dedicated proof wrapper for the host-visible port and MCP probe assertions the story now requires.
  - Story prerequisite: add one checked-in summary wrapper under `scripts/` plus a root `package.json` script that probes the live main-stack host-visible ports `5010`, `5011`, `5012`, and `8932` after `npm run compose:up`, records saved logs, and fails clearly if any required listener or MCP surface is unavailable.
- Local-stack-specific proof
  - The story does not need a second local-runtime automation path beyond the shell harness.
  - Proof-path rule: local-stack-specific host-network validation should be covered by the new shell harness and its preflight assertions, while the live runtime proof remains centered on the existing main-stack and e2e wrappers.

## Final Validation

- Final validation must prove the story works from schema parsing through persisted transcript output, not just that the code compiles.
- Required automated wrappers after implementation:
  - `npm run test:summary:server:unit` passes with coverage for re-ingest request unions, selector or target resolution, strict-service result extensions, single and batch transcript payloads, blank-markdown skips, and runtime-config placeholder normalization.
  - `npm run test:summary:shell` passes once the new shell harness exists, proving host-network preflight failures and success-path wrapper behavior.
  - `npm run compose:build:summary` passes so the changed Dockerfiles, `.dockerignore` files, and Compose definitions build cleanly through the wrapper-first path.
  - `npm run compose:up` followed by the new main-stack proof wrapper passes, then `npm run compose:down` succeeds cleanly.
  - `npm run test:summary:e2e` passes so the e2e stack still works after the host-network and MCP endpoint changes.
- Final runtime proof must also confirm these concrete outputs:
  - `docker-compose.yml` host-networked server surfaces bind `5010`, `5011`, and `5012` directly on the host, and `playwright-mcp` binds `8932`.
  - `docker-compose.local.yml` host-networked server surfaces bind `5510`, `5511`, and `5512` directly on the host, `playwright-mcp` binds `8931`, and the existing Chrome DevTools port remains `9222`.
  - `docker-compose.e2e.yml` host-networked server surfaces bind `6010`, `6011`, and `6012` directly on the host.
  - Checked-in config files resolve the MCP placeholders to literal runtime URLs for the server-owned MCP surfaces and the Playwright override without leaving raw placeholders in the runtime config passed to Codex.
  - Direct `sourceId`, `target: "current"`, and `target: "all"` re-ingest runs all produce the transcript and storage shapes defined in `## Message Contracts And Storage Shapes`.
  - Empty-markdown command or flow steps are skipped with the documented info-level log contract and do not create a new persisted storage shape of their own.

## Task Feasibility Proof Pass

- Repository scope validation:
  - Every task in this story belongs to the single repository `codeInfo2`.
  - No task currently mixes work across repositories, so no repository split is required.

### Task 1. Extend re-ingest schema parsing for command and flow files

- Already existing capabilities:
  - `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` already define the current `reingest` item shape.
  - Matching unit-test files already exist and can be extended.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - `target: "current"` and `target: "all"` parsing does not exist yet, so later tasks must not assume those inputs are valid until this task is complete.

### Task 2. Extend the strict single-repository re-ingest result contract

- Already existing capabilities:
  - `server/src/ingest/reingestService.ts` already owns the strict single-repository contract and validation categories.
  - `server/src/test/unit/reingestService.test.ts` already covers that service.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - Downstream transcript and orchestration tasks cannot assume `resolvedRepositoryId` or `completionMode` exists until this task adds them.

### Task 3. Add shared target orchestration for `sourceId`, `current`, and `all`

- Already existing capabilities:
  - `sourceId` and `flowSourceId` ownership context is already threaded through command and flow execution.
  - `server/src/mcpCommon/repositorySelector.ts` already provides the reusable selector helper.
- Missing prerequisite capabilities:
  - Task 1 must land first so the new `target` inputs can be parsed.
  - Task 2 must land first so the strict service returns the extended result fields needed by later consumers.
- Assumptions currently invalid:
  - There is no existing shared `current` or `all` orchestration layer yet, so later tasks must not assume batch outcomes or current-owner resolution until this task is complete.

### Task 4. Emit and persist the new single and batch re-ingest transcript payloads

- Already existing capabilities:
  - `server/src/chat/reingestToolResult.ts` and `server/src/chat/reingestStepLifecycle.ts` already provide the persistence seam.
  - Existing persisted turn storage already uses `Turn.toolCalls`.
- Missing prerequisite capabilities:
  - Task 2 must land first so the single-result contract carries the extended fields.
  - Task 3 must land first so `target: "all"` produces ordered batch outcomes to persist.
- Assumptions currently invalid:
  - No batch payload shape exists yet, so this task must extend the existing lifecycle rather than assuming a second persistence channel exists.

### Task 5. Skip blank markdown instructions without weakening real markdown failures

- Already existing capabilities:
  - `server/src/flows/markdownFileResolver.ts` already provides the shared markdown resolution seam.
  - Command and flow execution already consume that seam.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - Blank-markdown skip behavior does not exist yet, so this task must add it at the shared seam before either runner can rely on it.

### Task 6. Finalize runtime MCP placeholder normalization

- Already existing capabilities:
  - Shared runtime normalization already exists in `server/src/config/runtimeConfig.ts`.
  - The current codex bootstrap and env readers already exist and can be extended.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - MCP endpoint handling is still fragmented across runtime config, startup logging, status probes, and dedicated MCP listeners, so later migration and Docker tasks must not assume one unified endpoint contract exists until this task is complete.

### Task 7. Migrate checked-in MCP config and env contracts

- Already existing capabilities:
  - The checked-in runtime configs, shared-home configs, and env files already exist and can be migrated in place.
- Missing prerequisite capabilities:
  - Task 6 must land first so the final placeholder contract is defined in one shared runtime layer before checked-in files are rewritten to depend on it.
- Assumptions currently invalid:
  - The checked-in files still rely on legacy env names, hard-coded MCP URLs, and bridge-era assumptions, so Docker and proof tasks must not assume the final checked-in contract exists until this task is complete.

### Task 8. Add a repo-local shell harness

- Already existing capabilities:
  - `scripts/summary-wrapper-protocol.mjs` already defines the saved-log and heartbeat contract.
  - Root package scripts already provide the pattern for summary wrappers.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - `npm run test:summary:shell` and its vendored Bats runtime do not exist yet, so later wrapper-preflight work must not assume a reusable shell proof path exists until this task is complete.

### Task 9. Add host-network wrapper preflight

- Already existing capabilities:
  - `scripts/docker-compose-with-env.sh` already centralizes compose startup behavior.
- Missing prerequisite capabilities:
  - Task 8 must land first so the shell harness exists to prove the new failure paths and success pass-through behavior.
- Assumptions currently invalid:
  - Wrapper-level host-network prerequisite validation does not exist yet, so Docker and compose tasks must not assume early failure messaging is available until this task is complete.

### Task 10. Bake runtime assets into the image-based host-network model

- Already existing capabilities:
  - Existing Dockerfiles already build the app code and can be extended to carry the checked-in runtime assets.
- Missing prerequisite capabilities:
  - Task 7 must land first so the final checked-in MCP configs and env contracts are the ones baked into the image.
- Assumptions currently invalid:
  - The host-networked runtime still depends on repo bind mounts for checked-in runtime assets, so the final compose cutover must not assume image-baked runtime contents exist until this task is complete.

### Task 11. Convert Compose definitions to the final host-network runtime model

- Already existing capabilities:
  - Existing compose files, entrypoint wiring, and local Docker-socket/Testcontainers behavior already exist to extend.
- Missing prerequisite capabilities:
  - Task 7 must land first so the MCP endpoint and env contract is stable before the compose cutover.
  - Task 9 must land first so wrapper preflight exists before the compose cutover is validated.
  - Task 10 must land first so the runtime containers can run from image-baked assets instead of checked-in runtime bind mounts.
- Assumptions currently invalid:
  - The host-network compose model does not exist yet, so proof tasks must not assume service definitions, direct bind ports, or mount rules are final until this task is complete.

### Task 12. Add the main-stack host-network proof wrapper

- Already existing capabilities:
  - Existing summary-wrapper protocol and `scripts/test-summary-e2e.mjs` already provide the wrapper pattern to extend.
- Missing prerequisite capabilities:
  - Task 11 must land first so there is a host-network main stack worth probing.
- Assumptions currently invalid:
  - `npm run test:summary:host-network:main` does not exist yet, so final validation must not depend on that command until this task creates it.

### Task 13. Align the e2e proof path with host-network addresses

- Already existing capabilities:
  - Existing e2e wrapper, env injection, and Playwright config already exist to update.
- Missing prerequisite capabilities:
  - Task 11 must land first so the host-visible address contract is final before e2e paths are repointed to it.
- Assumptions currently invalid:
  - The checked-in e2e path still targets bridge-era assumptions today, so final validation must not assume e2e is aligned with host networking until this task is complete.

### Task 14. Run final validation for Story 0000050

- Already existing capabilities:
  - The repo already has the wrapper-first build and test commands, plus the manual Playwright verification workflow.
- Missing prerequisite capabilities:
  - Tasks 1 through 13 must all be complete first.
- Assumptions currently invalid:
  - None beyond the prerequisite ordering above; this task is only valid once the earlier implementation and proof tasks have landed.

### Task 15. Update documentation and story close-out

- Already existing capabilities:
  - The repo already has the shared documentation files and PR-summary workflow to reuse.
- Missing prerequisite capabilities:
  - Task 14 must land first so the docs and close-out reflect the final validated behavior rather than an earlier draft state.
- Assumptions currently invalid:
  - Documentation and close-out content should not be treated as final until the validation evidence from Task 14 exists.

# Tasks

### Task 1. Extend re-ingest schema parsing for command and flow files

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Add the new re-ingest request union to command and flow schema parsing so JSON files can express `sourceId`, `target: "current"`, and `target: "all"` without yet changing execution behavior. This task is schema-only and is complete when parsing accepts the allowed shapes and rejects the invalid combinations defined in the plan.

#### Documentation Locations

- Zod unions and discriminated unions: Context7 `/colinhacks/zod`. Use this to confirm the allowed union constructors and why same-literal `type: "reingest"` branches cannot use `discriminatedUnion`.
- TypeScript unions and strict typing: https://www.typescriptlang.org/docs/. Use this to confirm the final inferred request types stay narrow and do not silently widen to optional `sourceId` plus optional `target`.

#### Subtasks

1. [ ] In `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts`, read the current `sourceId`-only `reingest` schema together with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`. The exact request contract to copy into code is:
   - `{ "type": "reingest", "sourceId": "<selector-or-path>" }`
   - `{ "type": "reingest", "target": "current" }`
   - `{ "type": "reingest", "target": "all" }`
   - invalid when both `sourceId` and `target` are present.
2. [ ] In `server/src/agents/commandsSchema.ts`, replace the current `AgentCommandReingestItemSchema` with a plain union of strict object shapes or an equivalent mutual-exclusion helper. Do not use `z.discriminatedUnion('type', ...)`, because every allowed variant still has `type: 'reingest'`. The implementation should read like this shape, even if variable names differ:
   ```ts
   z.union([
     z.object({ type: z.literal('reingest'), sourceId: trimmedNonEmptyString }).strict(),
     z.object({ type: z.literal('reingest'), target: z.literal('current') }).strict(),
     z.object({ type: z.literal('reingest'), target: z.literal('all') }).strict(),
   ]);
   ```
3. [ ] In `server/src/flows/flowSchema.ts`, mirror the same `reingest` union for flow steps and keep the rest of the `flowStepUnionSchema()` behavior unchanged. The end result must leave `llm`, `break`, `command`, and `startLoop` validation exactly as-is while only broadening the `reingest` step shape.
4. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that parses a command file containing `{ "type": "reingest", "sourceId": "<selector-or-path>" }`. Purpose: prove the happy-path command schema still accepts explicit selector/path re-ingest items.
5. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that parses a command file containing `{ "type": "reingest", "target": "current" }`. Purpose: prove the command schema accepts the new current-repository target.
6. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that parses a command file containing `{ "type": "reingest", "target": "all" }`. Purpose: prove the command schema accepts the new all-repositories target.
7. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects a command item containing both `sourceId` and `target`. Purpose: prove the union is mutually exclusive instead of silently accepting ambiguous input.
8. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects a command item whose `target` is not `current` or `all`. Purpose: prove invalid target values fail at parse time.
9. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects an empty or whitespace-only `sourceId`. Purpose: prove the command schema does not accept blank selectors.
10. [ ] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects an otherwise valid `reingest` item containing an unexpected extra property. Purpose: prove the strict object shape still rejects undeclared keys.
11. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that parses a flow step containing `{ "type": "reingest", "sourceId": "<selector-or-path>" }`. Purpose: prove the happy-path flow schema still accepts explicit selector/path re-ingest steps.
12. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that parses a flow step containing `{ "type": "reingest", "target": "current" }`. Purpose: prove the flow schema accepts the new current-repository target.
13. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that parses a flow step containing `{ "type": "reingest", "target": "all" }`. Purpose: prove the flow schema accepts the new all-repositories target.
14. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects a flow step containing both `sourceId` and `target`. Purpose: prove flow parsing keeps the same mutual-exclusion rule as command parsing.
15. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects a flow step whose `target` is not `current` or `all`. Purpose: prove invalid flow target values fail at parse time.
16. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects an empty or whitespace-only `sourceId`. Purpose: prove the flow schema does not accept blank selectors.
17. [ ] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects an otherwise valid `reingest` flow step containing an unexpected extra property. Purpose: prove the strict flow step shape still rejects undeclared keys.
18. [ ] Record any new or renamed files for later documentation updates in Task 15. Do not update `README.md`, `design.md`, or `projectStructure.md` in this task unless a new file is created here.
19. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-schema.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/flows-schema.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 2. Extend the strict single-repository re-ingest result contract

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Keep `runReingestRepository()` strict on one canonical repository, but extend its success payload so downstream code can tell which repository was selected and whether a completed run was a real re-ingest or an internal skip. This task is complete when the strict service contract matches the story’s `resolvedRepositoryId` and `completionMode` requirements and has unit coverage.

#### Documentation Locations

- TypeScript types and unions: https://www.typescriptlang.org/docs/. Use this to keep the extended success payload strongly typed while preserving the existing result union.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the exact `node:test` assertion and subtest patterns already used by the repo’s server unit suite.

#### Subtasks

1. [ ] In `server/src/ingest/reingestService.ts`, read the current `ReingestSuccess` type, `runReingestRepository()` return path, and the existing cases in `server/src/test/unit/reingestService.test.ts` together with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`. This task changes only the strict single-repository result contract; it must not move selector parsing into this service.
2. [ ] Update the `ReingestSuccess` payload in `server/src/ingest/reingestService.ts` so it adds these exact fields from the story contract:
   - `resolvedRepositoryId: string | null`
   - `completionMode: "reingested" | "skipped" | null`
   - keep the existing fields `status`, `operation`, `runId`, `sourceId`, `files`, `chunks`, `embedded`, and `errorCode`.
3. [ ] In the same file, preserve the existing validation and terminal status behavior exactly as documented in `## Edge Cases and Failure Modes`:
   - keep `status` as `completed`, `cancelled`, or `error`;
   - keep existing failure codes and retry lists;
   - map internal ingest `skipped` to `status: "completed"` with `completionMode: "skipped"`;
   - keep the exact pre-start validation and busy-state categories unchanged for `missing`, `non_absolute`, `ambiguous_path`, `unknown_root`, `busy`, and `invalid_state`.
4. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a completed re-ingest and asserts `completionMode: "reingested"`. Purpose: prove the happy-path result distinguishes a real re-ingest from other completed outcomes.
5. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises an internal skipped ingest and asserts `completionMode: "skipped"`. Purpose: prove completed no-op behavior is preserved without being mislabeled as a full re-ingest.
6. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a cancelled execution and asserts `completionMode: null`. Purpose: prove cancelled outcomes do not report a misleading completion mode.
7. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a terminal error execution and asserts `completionMode: null`. Purpose: prove error outcomes do not report a misleading completion mode.
8. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a known repository id and asserts `resolvedRepositoryId` is populated. Purpose: prove downstream orchestration can identify the selected repository.
9. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a repository record with no repository id and asserts `resolvedRepositoryId: null`. Purpose: prove the contract is explicit when repository metadata is incomplete.
10. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `missing` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: guard against breaking existing caller expectations while extending the success payload.
11. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `non_absolute` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the exact absolute-path validation contract.
12. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `ambiguous_path` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the existing ambiguous-path failure contract.
13. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `unknown_root` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the existing unknown-root failure contract.
14. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `busy` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the busy-state retry contract.
15. [ ] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `invalid_state` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the invalid-state failure contract.
16. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
17. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/reingestService.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 3. Add shared target orchestration for `sourceId`, `current`, and `all`

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Implement the shared server-side orchestration that resolves the three re-ingest request modes into canonical repository paths before calling the strict service. This task is complete when command and flow execution can resolve `sourceId`, `current`, and `all` correctly, preserve deterministic ordering, return an empty batch for zero repositories, and continue after per-repository failures in `all` mode.

#### Documentation Locations

- TypeScript control flow and helper extraction: https://www.typescriptlang.org/docs/. Use this to structure the shared orchestration helper without widening types or duplicating resolution branches.
- Node.js test runner for targeted unit and integration coverage: https://nodejs.org/api/test.html. Use this for the targeted server tests that prove ordering, fail-fast behavior, and continue-on-failure handling.

#### Subtasks

1. [ ] In `server/src/agents/commandsRunner.ts`, `server/src/flows/service.ts`, `server/src/agents/service.ts`, and `server/src/agents/commandItemExecutor.ts`, trace how `sourceId` and `flowSourceId` are threaded today. Cross-check that with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`, because this task must resolve targets above `runReingestRepository()` rather than changing the strict ingest layer.
2. [ ] Add one shared orchestration helper above `runReingestRepository()` so explicit selectors, `current`, and `all` all resolve to canonical container paths before strict execution begins. Put the shared logic where both the command path and flow path can call it, and reuse `server/src/mcpCommon/repositorySelector.ts` for selector matching instead of duplicating selector rules inside separate runners.
3. [ ] In that shared orchestration helper, implement the `current` resolution rules exactly as written in the story:
   - direct command uses the command owner;
   - top-level flow uses the flow owner;
   - nested flow command uses the command owner, not the parent flow owner;
   - fail fast with a clear pre-start error when the current owner is missing or resolves to a repository that is not currently ingested, with no fallback to any other repository.
4. [ ] In the same orchestration helper, implement `target: "all"` exactly as defined in `## Message Contracts And Storage Shapes`:
   - gather all ingested repositories;
   - sort by ascending canonical container path;
   - execute sequentially;
   - return an empty batch result when there are zero repositories;
   - continue after a per-repository failure and record that failure instead of aborting the batch.
5. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that uses a repo id selector and proves `sourceId` resolution still reaches the canonical repository path. Purpose: preserve the happy-path selector contract for repository ids.
6. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that uses an absolute path selector and proves explicit path-based re-ingest still works. Purpose: preserve backward compatibility for existing path-only workflows.
7. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that sets up duplicate case-insensitive repository ids and proves the selector helper still picks the latest ingest instead of failing ambiguous. Purpose: preserve the existing repository-selector tie-break behavior called for by the story.
8. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises direct-command `target: "current"` on the happy path. Purpose: prove the command owner is used when a command file re-ingests its own repository.
9. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises top-level-flow `target: "current"` on the happy path. Purpose: prove the flow owner is used when a flow step re-ingests the current flow repository.
10. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises nested command-item `target: "current"` on the happy path. Purpose: prove nested command execution uses the command owner rather than the parent flow owner.
11. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "current"` when there is no owning repository. Purpose: prove the step fails fast instead of falling back to another repository.
12. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "current"` when the owner exists in metadata but is not currently ingested. Purpose: prove the missing-ingest error happens before strict execution starts.
13. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "all"` with multiple repositories and asserts ascending canonical path order. Purpose: prove deterministic batch ordering.
14. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "all"` when there are zero ingested repositories. Purpose: prove the corner case returns an empty batch instead of crashing or fabricating work.
15. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "all"` with a failing repository followed by successful or skipped repositories. Purpose: prove the batch continues after failure and preserves later outcomes instead of truncating the run.
16. [ ] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that verifies selector and target orchestration still surfaces the existing strict-service failure categories rather than collapsing them into a generic error. Purpose: preserve downstream error handling expectations.
17. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
18. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --test-name reingest`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/commands.reingest.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 4. Emit and persist the new single and batch re-ingest transcript payloads

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Update the transcript and persistence layer so single re-ingest runs emit the extended single payload and `target: "all"` emits one batch payload while remaining backward compatible with older stored turns. This task is complete when the new payloads are built, persisted, replayed, and read without breaking existing `toolCalls` storage assumptions.

#### Documentation Locations

- Mongoose mixed/object persistence behavior: Context7 `/automattic/mongoose`. Use this to confirm how `Schema.Types.Mixed` and omitted nested fields behave so the batch payload remains backward compatible without a Mongo migration.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the payload-builder and lifecycle tests that exercise the real synthetic-turn persistence path.

#### Subtasks

1. [ ] In `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, `server/src/mongo/turn.ts`, and `server/src/mongo/repo.ts`, read the current synthetic-turn persistence path together with story section `## Message Contracts And Storage Shapes`. This task must stay on the existing `Turn.toolCalls` storage path and must not invent a second persistence channel.
2. [ ] Extend the single payload in `server/src/chat/reingestToolResult.ts` to include the exact fields defined by the story:
   - `targetMode`
   - `requestedSelector`
   - `resolvedRepositoryId`
   - `outcome`
   - existing `status` and `completionMode`
   - keep `sourceId` as the canonical resolved container path for backward compatibility.
3. [ ] Add the new `reingest_step_batch_result` payload variant in the same area with the ordered `repositories` array and `summary` object from `## Message Contracts And Storage Shapes`. The batch payload must represent one `target: "all"` action, not one payload per repository.
4. [ ] Update `server/src/chat/reingestStepLifecycle.ts` so one `target: "all"` run records one batch payload instead of one synthetic turn pair per repository. Reuse the existing synthetic-turn lifecycle and `Turn.toolCalls` persistence path rather than creating a second batch-only persistence channel.
5. [ ] Keep backward compatibility for older stored single payloads by making the payload reader tolerant of both the old and new single-result shapes. In `server/src/mongo/turn.ts`, remember that `toolCalls` stays `Schema.Types.Mixed`, so the read path must tolerate omitted optional nested fields rather than depending on empty-object persistence.
6. [ ] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a single-result payload and asserts the new single payload fields are present. Purpose: prove the happy-path transcript contract now exposes the added single-result fields.
7. [ ] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a selector-driven single-result payload and asserts `targetMode`, `requestedSelector`, and `resolvedRepositoryId` are preserved. Purpose: prove explicit-selector transcript metadata survives serialization.
8. [ ] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a `target: "current"` single-result payload and asserts `targetMode`, `requestedSelector`, and `resolvedRepositoryId` are preserved. Purpose: prove current-target transcript metadata survives serialization.
9. [ ] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a batch payload and asserts repository ordering is preserved. Purpose: prove the batch transcript keeps deterministic repository order.
10. [ ] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a mixed-outcome batch payload and asserts the `summary` counts for `reingested`, `skipped`, and `failed`. Purpose: prove the batch summary can be trusted by UI and logs without recomputation.
11. [ ] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a batch payload containing a failed repository and asserts the repository-level error text is preserved. Purpose: prove failure detail is not dropped from batch transcript entries.
12. [ ] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that persists an empty `target: "all"` run and asserts one batch payload is still stored with an empty repository list. Purpose: prove the empty-batch corner case still leaves an explicit transcript record.
13. [ ] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that exercises a batch run and asserts lifecycle persistence still uses `Turn.toolCalls`. Purpose: prove the new batch mode reuses the existing persistence path instead of creating a second channel.
14. [ ] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that reads an older single-result payload and asserts it still parses correctly. Purpose: prove backward compatibility for already-stored transcript data.
15. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
16. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/reingest-tool-result.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/reingest-step-lifecycle.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 5. Skip blank markdown instructions without weakening real markdown failures

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Implement the shared blank-markdown skip behavior for commands and flows while preserving all existing hard failures for missing files, path traversal, permission errors, and invalid UTF-8. This task is complete when whitespace-only markdown is skipped with the documented info-level log contract and all other markdown errors remain failures.

#### Documentation Locations

- Node.js filesystem and text decoding APIs: https://nodejs.org/api/fs.html and https://nodejs.org/api/util.html. Use these to keep the empty-markdown skip limited to successful reads while preserving current file-error handling.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the unit and integration tests that prove skip-versus-fail behavior.

#### Subtasks

1. [ ] In `server/src/flows/markdownFileResolver.ts`, `server/src/agents/commandItemExecutor.ts`, and `server/src/flows/service.ts`, trace the current markdown resolution path together with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`. The skip must happen once in the shared seam, not as duplicate checks in each runner.
2. [ ] Add the whitespace-only skip behavior only for successfully resolved markdown content. Implement it in the shared resolver or shared execution seam so both direct commands and flows inherit the same behavior automatically.
3. [ ] Emit the documented info-level log contract from that shared seam with these exact keys from the story:
   - `surface`
   - `markdownFile`
   - `resolvedPath`
   - `reason: "empty_markdown"`
   - plus any available command or flow context already present at the call site.
4. [ ] Ensure the skip only applies to successful empty-content reads. Missing files, absolute paths, traversal attempts, permission failures, invalid UTF-8, and other existing resolver errors in `server/src/flows/markdownFileResolver.ts` must still fail exactly as they do today.
5. [ ] Add a server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that exercises a direct command whose resolved markdown file contains only whitespace. Purpose: prove the happy-path skip behavior works for direct command execution.
6. [ ] Add a server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that exercises a flow step whose resolved markdown file contains only whitespace. Purpose: prove the same skip behavior works for flow execution through the shared seam.
7. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that covers a newline-only markdown file. Purpose: prove the skip logic trims line-break-only content correctly.
8. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that covers a space-only markdown file. Purpose: prove the skip logic trims plain-space content correctly.
9. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that asserts the emitted info log includes `surface`, `markdownFile`, `resolvedPath`, and `reason: "empty_markdown"`. Purpose: prove the documented log contract is emitted exactly where operators need it.
10. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises a missing markdown file. Purpose: prove missing-file failures remain hard failures rather than skip cases.
11. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises a traversal attempt. Purpose: prove traversal protection remains a hard failure rather than a skip case.
12. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises a permission-denied read failure. Purpose: prove file permission failures still throw exactly as before.
13. [ ] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises an invalid-UTF-8 decode failure. Purpose: prove decoding failures still throw exactly as before.
14. [ ] Add a server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that verifies no synthetic tool-result payload is created when a markdown-backed step is skipped for empty content. Purpose: prove the skip does not fabricate transcript output.
15. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
16. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/markdown-file-resolver.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/commands.markdown-file.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 6. Finalize runtime MCP placeholder normalization

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Finish the shared runtime placeholder normalization layer before any checked-in config files are migrated. This task is complete when unresolved placeholders fail clearly, all runtime consumers use one shared MCP endpoint contract, and stale hard-coded bypass paths have been removed from the runtime code.

#### Documentation Locations

- TOML syntax basics: https://toml.io/en/v1.1.0. Use this to confirm how literal placeholder strings are represented in checked-in TOML without relying on nonexistent native env interpolation.
- TypeScript config-object shaping: https://www.typescriptlang.org/docs/. Use this to keep the normalized config object strongly typed across the runtime entrypoints.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the server tests that prove placeholder normalization, unresolved-placeholder failure, and endpoint separation.

#### Subtasks

1. [ ] In `server/src/config/runtimeConfig.ts`, `server/src/config/codexConfig.ts`, `server/src/config.ts`, `server/src/config/startupEnv.ts`, `server/src/providers/mcpStatus.ts`, `server/src/index.ts`, `server/src/mcp2/server.ts`, and `server/src/mcpAgents/server.ts`, trace every place that currently resolves or consumes MCP endpoints. Use story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes` as the contract source.
2. [ ] Update the shared runtime normalization path so unresolved required MCP placeholders fail clearly instead of passing raw placeholder text through to the effective config. The required placeholders to keep in view are:
   - `${CODEINFO_SERVER_PORT}`
   - `${CODEINFO_CHAT_MCP_PORT}`
   - `${CODEINFO_AGENTS_MCP_PORT}`
   - `CODEINFO_PLAYWRIGHT_MCP_URL`
3. [ ] Make one shared endpoint contract feed base-config seeding, chat runtime loading, agent runtime loading, provider status probes, startup endpoint reporting, and the dedicated MCP bind surfaces. Keep the intentional split between chat/base MCP and agents MCP intact; do not collapse them into one URL.
4. [ ] Remove any stale runtime-code bypasses that still hard-code MCP URLs or legacy env fallbacks outside the shared normalization path, especially in startup reporting and provider status code.
5. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `${CODEINFO_SERVER_PORT}`. Purpose: prove server-port placeholders normalize through the shared runtime path.
6. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `${CODEINFO_CHAT_MCP_PORT}`. Purpose: prove the chat MCP placeholder normalizes through the shared runtime path.
7. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `${CODEINFO_AGENTS_MCP_PORT}`. Purpose: prove the agents MCP placeholder normalizes through the shared runtime path.
8. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `CODEINFO_PLAYWRIGHT_MCP_URL`. Purpose: prove the Playwright full-URL override normalizes through the same shared contract.
9. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that leaves a required placeholder unresolved and asserts a clear failure. Purpose: prove raw placeholder text cannot leak into the effective runtime config.
10. [ ] Add a server unit test in `server/src/test/unit/codexConfig.test.ts` that loads distinct chat/base and agents MCP values and asserts they remain different. Purpose: prove the intentional endpoint split is preserved by normalization.
11. [ ] Add a server unit test in `server/src/test/unit/chatProviders.test.ts` that keeps browser navigation URLs and MCP control-channel URLs different. Purpose: prove normalization does not collapse unrelated browser and MCP contracts into one value.
12. [ ] Add a server unit test in `server/src/test/unit/chatModels.codex.test.ts` that exercises provider/runtime entrypoints or status probes after the refactor and asserts they use the shared endpoint contract instead of stale hard-coded MCP URLs or legacy env fallbacks. Purpose: prove bypass paths have been removed.
13. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
14. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run test:summary:server:unit -- --test-name runtimeConfig`
2. [ ] `npm run test:summary:server:unit -- --test-name codexConfig`
3. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/chatProviders.test.ts`
4. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/chatModels.codex.test.ts`

#### Implementation notes

- __to_do__

---

### Task 7. Migrate checked-in MCP config and env contracts

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Move the checked-in runtime config files and env files onto the final MCP placeholder and env-variable contract defined by Task 6. This task is complete when checked-in configs use explicit placeholders, checked-in env files use `CODEINFO_CHAT_MCP_PORT` instead of `CODEINFO_MCP_PORT`, and the repo’s checked-in defaults no longer encode bridge-era MCP URLs.

#### Documentation Locations

- TOML format and field syntax: https://toml.io/en/v1.1.0. Use this when rewriting checked-in config files so placeholder tokens remain valid TOML strings and tables.
- TypeScript config-object shaping: https://www.typescriptlang.org/docs/. Use this to keep the config-reader expectations aligned with the migrated checked-in file shapes.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the normalization tests that prove the migrated checked-in files still parse and resolve correctly.

#### Subtasks

1. [ ] Read the checked-in runtime config files and env files that still carry legacy MCP URLs, legacy env names, or bridge-era assumptions. Use story sections `## Message Contracts And Storage Shapes`, `## Edge Cases and Failure Modes`, and `## Final Validation` while you read these exact files:
   - `codex/config.toml`
   - `codex/chat/config.toml`
   - `codex_agents/*/config.toml`
   - `config.toml.example`
   - `server/.env`
   - `server/.env.local`
   - `server/.env.e2e`
2. [ ] Update the checked-in runtime config files to use the explicit placeholder strategy defined in the story for these exact contracts:
   - `CODEINFO_SERVER_PORT`
   - `CODEINFO_CHAT_MCP_PORT`
   - `CODEINFO_AGENTS_MCP_PORT`
   - `CODEINFO_PLAYWRIGHT_MCP_URL`
   - remove hard-coded MCP URLs such as `http://localhost:5010/mcp`, `http://localhost:5011/mcp`, or bridge-era `playwright-mcp` hostnames where the story says placeholders should be used instead.
3. [ ] Update the checked-in env files so they match the final placeholder and port contract and remove checked-in reliance on `CODEINFO_MCP_PORT`. After this task, the checked-in dedicated MCP env name must be `CODEINFO_CHAT_MCP_PORT`.
4. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that loads the checked-in file style with the new placeholder tokens and asserts successful normalization. Purpose: prove the migrated checked-in config format remains runnable.
5. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that sets `CODEINFO_CHAT_MCP_PORT` and asserts the checked-in chat MCP placeholders resolve from that value. Purpose: prove the new env contract is wired correctly.
6. [ ] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that sets only legacy `CODEINFO_MCP_PORT` and asserts chat MCP placeholder normalization fails or remains unsatisfied. Purpose: prove the legacy env name no longer satisfies the checked-in contract.
7. [ ] Add a server unit test in `server/src/test/unit/codexConfig.test.ts` that loads the migrated checked-in config files and asserts no bridge-era `playwright-mcp` hostname or hard-coded localhost MCP URL dependency remains where placeholders are now required. Purpose: prove the checked-in config migration is complete.
8. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
9. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run test:summary:server:unit -- --test-name runtimeConfig`
2. [ ] `npm run test:summary:server:unit -- --test-name codexConfig`

#### Implementation notes

- __to_do__

---

### Task 8. Add a repo-local shell harness

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Create the reusable repo-local shell harness that later wrapper and compose tasks will use for shell-level proofs. This task is complete when `npm run test:summary:shell` works from a clean checkout without a globally installed Bats runtime and includes at least one passing and one intentionally failing harness case.

#### Documentation Locations

- bats-core documentation: https://bats-core.readthedocs.io/en/stable/. Use this for the correct `.bats` file structure, helper loading, and vendored-runtime expectations.
- Node.js child process and stream handling: https://nodejs.org/api/child_process.html and https://nodejs.org/api/stream.html. Use these for the wrapper that runs the shell harness and captures saved-log output cleanly.

#### Subtasks

1. [ ] Read `scripts/summary-wrapper-protocol.mjs`, `scripts/summary-wrapper-protocol-fixture.mjs`, and `package.json` together with story section `## Test Harnesses`. This harness must follow the same saved-log and heartbeat contract as the other repo wrappers.
2. [ ] Add the repo-local shell harness files under `scripts/test/bats/` with this minimum shape so another developer can find everything in one place:
   - `.bats` test file;
   - shared helper file;
   - fixture binaries.
3. [ ] Check in the Bats runtime and helper libraries under `scripts/test/bats/vendor/` so the harness is runnable from a clean checkout with no global Bats installation.
4. [ ] Add `scripts/test-summary-shell.mjs` and the root `package.json` script entry `npm run test:summary:shell` so the shell harness uses the same summary-wrapper protocol fields as the other wrappers: saved log path, heartbeat output, and final guidance.
5. [ ] Create `scripts/test/bats/shell-harness.bats` and add a shell test there that exercises a passing harness fixture. Purpose: prove the vendored Bats harness can execute a normal success case from a clean checkout.
6. [ ] In `scripts/test/bats/shell-harness.bats`, add a shell test that exercises an intentionally failing fixture and asserts the failure is expected. Purpose: prove the harness can report controlled failures without treating them as accidental crashes.
7. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
8. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run test:summary:shell`
2. [ ] Confirm the shell harness run includes at least one expected failing fixture and that the saved output reports that error clearly instead of silently passing.

#### Implementation notes

- __to_do__

---

### Task 9. Add host-network wrapper preflight

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Extend the checked-in compose wrapper so it fails fast when the checked-in host-network requirements are missing or incompatible. This task is complete when the wrapper catches unsupported host networking, incompatible service shapes, and occupied checked-in ports before `docker compose` starts, and those behaviors are covered by the shell harness from Task 8.

#### Documentation Locations

- Docker host networking behavior: DeepWiki `docker/docs` plus https://docs.docker.com/engine/network/tutorials/host/. Use these to confirm the host-network prerequisites and the direct-host-port rules the wrapper must enforce before startup.
- Docker Compose service rules: Context7 `/docker/compose`. Use this to confirm that host-networked services cannot keep incompatible `ports` or `networks` configuration.
- Bash manual: https://www.gnu.org/software/bash/manual/bash.html. Use this for portable shell control flow in `docker-compose-with-env.sh`.

#### Subtasks

1. [ ] Read `scripts/docker-compose-with-env.sh` and the new harness files under `scripts/test/bats/` together with story sections `## Proof Path Readiness` and `## Edge Cases and Failure Modes`. This task must extend the checked-in wrapper, not add a second compose launcher.
2. [ ] Extend `scripts/docker-compose-with-env.sh` so it fails before `docker compose` for these exact prerequisite failures from the story:
   - unsupported host-network environments;
   - Docker Desktop environments where host networking is unavailable or incompatible for the checked-in compose path;
   - disabled host networking where it is required;
   - occupied checked-in host ports;
   - host-networked service definitions that still contain incompatible `ports` or `networks` wiring;
   - and every failure path names the affected compose file or service plus the missing or incompatible prerequisite.
3. [ ] Create `scripts/test/bats/docker-compose-with-env.bats` and add a shell test there that exercises the unsupported host-network environment path. Purpose: prove preflight fails before compose startup when host networking is not supported.
4. [ ] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises a conflicting checked-in host port. Purpose: prove preflight blocks startup when a required host-visible port is already occupied.
5. [ ] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises a host-networked service definition still carrying incompatible `ports` or `networks`. Purpose: prove invalid compose shapes are rejected before `docker compose` runs.
6. [ ] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises the success-path pass-through to compose execution. Purpose: prove the wrapper still hands control to compose when all preflight conditions are satisfied.
7. [ ] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises a compose file without `playwright-mcp`. Purpose: prove preflight does not force new Playwright services into files that are out of scope for this story.
8. [ ] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that asserts failure output names the affected compose file or service. Purpose: prove operators receive actionable preflight errors instead of a generic shell failure.
9. [ ] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that proves the local host-network manual-testing contract still declares Chrome DevTools on `9222`. Purpose: keep the checked-in local CDP validation rule under automated shell-harness coverage.
10. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
11. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run test:summary:shell`
2. [ ] Confirm the saved output reports host-network preflight failures with the affected compose file or service instead of a generic shell error.

#### Implementation notes

- __to_do__

---

### Task 10. Bake runtime assets into the image-based host-network model

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Update the Docker build flow so the checked-in runtime assets needed by the host-networked server are carried by the image instead of being supplied from repo bind mounts at runtime. This task is complete when the server image includes the checked-in runtime assets it needs and only the Dockerfiles or `.dockerignore` files that actually participate in that packaging path are changed.

#### Documentation Locations

- Docker build contexts and ignore files: Context7 `/docker/docs`. Use this to keep the image-baking task focused on required build inputs instead of broadening unrelated image scope.
- Dockerfile reference: Context7 `/docker/docs`. Use this for the correct copy/build layering when moving checked-in runtime assets into the image.

#### Subtasks

1. [ ] Read `server/Dockerfile`, `.dockerignore`, `server/.dockerignore`, `client/.dockerignore`, and the checked-in compose files together with story sections `## Feasibility Proof Pass` and `## Edge Cases and Failure Modes`. Make a concrete list of which checked-in runtime assets are still bind-mounted from the repo today, especially `codex/`, `codex_agents/`, and checked-in flow directories.
2. [ ] Update the Docker build contexts and only the Dockerfiles that actually need to carry checked-in runtime assets so the host-networked server can run without repo bind mounts. Extend the existing build flow instead of introducing alternate Dockerfiles or bespoke startup paths, and do not expand client-image scope unless a checked-in runtime dependency truly requires it.
3. [ ] Update only the `.dockerignore` files that participate in that packaging path so the required runtime assets enter the build context without broadening unrelated image scope. The target outcome from the story is that runtime application code does not depend on a repo source-tree bind mount such as `.:/app`.
4. [ ] Reuse the existing `npm run compose:build:summary` output plus the later runtime/container inspection in Tasks 11 and 14 as the proof path for image-baked assets instead of adding a bespoke new proof script in this task.
5. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
6. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run compose:build:summary`

#### Implementation notes

- __to_do__

---

### Task 11. Convert Compose definitions to the final host-network runtime model

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Convert the checked-in `server` and existing `playwright-mcp` services to the final host-network model using the image-based runtime contents from Task 10. This task is complete when the main, local, and e2e Compose definitions match the story’s host-network rules, preserve the documented host-visible ports, and no longer rely on forbidden source-tree or checked-in runtime bind mounts.

#### Documentation Locations

- Docker Compose service rules: Context7 `/docker/compose`. Use this to apply `network_mode: host` correctly and remove incompatible keys from the scoped services.
- Docker host networking behavior: DeepWiki `docker/docs` plus https://docs.docker.com/engine/network/tutorials/host/. Use these to keep the compose cutover aligned with the checked-in host-visible port matrix and prerequisites.
- Bash manual: https://www.gnu.org/software/bash/manual/bash.html. Use this only where shell-entrypoint behavior must remain correct for the `9222` Chrome DevTools contract.

#### Subtasks

1. [ ] Read `server/entrypoint.sh`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `server/src/test/support/chromaContainer.ts`, and `server/src/test/support/mongoContainer.ts` together with story sections `## Feasibility Proof Pass`, `## Edge Cases and Failure Modes`, and `## Final Validation`. This task is only about checked-in `server` and existing `playwright-mcp` services.
2. [ ] Convert the scoped `server` and existing `playwright-mcp` services to the final host-network definitions with these exact port rules from the story:
   - direct host-visible bind ports for the server listeners;
   - preserve the local Chrome DevTools bind contract on `9222` by keeping the required server entrypoint or environment wiring intact under host networking;
   - `8931` for local Playwright MCP;
   - `8932` for main Playwright MCP;
   - remove incompatible `ports` or `networks` definitions on host-networked services;
   - remove bridge-only service-name MCP URL assumptions;
   - keep compose files that do not already define `playwright-mcp` out of scope so no new Playwright service is introduced by this task.
3. [ ] Preserve the existing local Docker-socket, UID/GID, and Testcontainers-related runtime contract where it is still required for checked-in local workflows, while keeping that exception separate from the forbidden source-tree and checked-in-config bind mounts. Do not add new source-tree mounts to solve runtime issues.
4. [ ] Prove the final host-networked Compose definitions no longer bind-mount application source trees or checked-in runtime asset trees into the runtime containers, and that any remaining persistence is limited to Docker-managed generated-output volumes plus the explicitly host-visible logs, with only deliberate non-source runtime mounts such as the local Docker socket remaining where required.
5. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
6. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run compose:build:summary`
2. [ ] `npm run compose:up`
3. [ ] `npm run test:summary:shell`
4. [ ] Confirm the updated local host-network definition still preserves the checked-in Chrome DevTools `9222` contract and any required Docker-socket/Testcontainers support without reintroducing source-tree bind mounts.
5. [ ] Confirm the generated effective Compose configuration for the scoped host-networked services no longer carries incompatible `ports` or `networks` keys and does not add a new `playwright-mcp` service to compose files that previously lacked one.
6. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 12. Add the main-stack host-network proof wrapper

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Add the checked-in proof wrapper that probes the live main stack after `npm run compose:up`. This task is complete when the main-stack proof path is runnable through one wrapper command and has automated coverage for at least one passing and one failing probe scenario.

#### Documentation Locations

- Playwright connectivity and browser probing: Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype. Use these to confirm `connectOverCDP()` behavior and the expected browser-probe surface for `http://localhost:9222` and related runtime checks.
- Node.js child process and stream handling: https://nodejs.org/api/child_process.html and https://nodejs.org/api/stream.html. Use these for the proof wrapper’s process execution and log-capture behavior.

#### Subtasks

1. [ ] Read `scripts/summary-wrapper-protocol.mjs`, `scripts/summary-wrapper-protocol-fixture.mjs`, `scripts/test-summary-e2e.mjs`, `package.json`, and `docker-compose.yml` together with story sections `## Proof Path Readiness` and `## Final Validation`. This wrapper must reuse the existing wrapper protocol rather than inventing a new command style.
2. [ ] Add one checked-in summary wrapper under `scripts/` that probes the live main-stack host-visible ports `5010`, `5011`, `5012`, and `8932` after `npm run compose:up`. The wrapper must separately prove:
   - the classic `/mcp` route;
   - the dedicated chat MCP route;
   - the agents MCP route;
   - the Playwright MCP route;
   - and it must fail clearly when any required listener or MCP surface is unavailable.
3. [ ] Add the corresponding root `package.json` script entry for that proof wrapper so the checked-in command name becomes the canonical proof path used later by Task 14.
4. [ ] Create `server/src/test/unit/test-summary-host-network-main.test.ts` and add a server unit test there that exercises a passing probe scenario. Purpose: prove the wrapper succeeds when all required main-stack MCP listeners are available.
5. [ ] In `server/src/test/unit/test-summary-host-network-main.test.ts`, add a server unit test that exercises a failing probe scenario. Purpose: prove the wrapper reports an unavailable listener or MCP surface as a controlled failure.
6. [ ] In `server/src/test/unit/test-summary-host-network-main.test.ts`, add a server unit test that asserts the failing probe emits inspectable error output rather than a generic crash. Purpose: prove later diagnosis can rely on saved wrapper output.
7. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
8. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run compose:up`
2. [ ] `npm run test:summary:host-network:main`
3. [ ] Confirm the automated coverage added in this task includes at least one failing probe case for the new proof wrapper and checks the reported error output.
4. [ ] `npm run compose:down`

#### Implementation notes

- __to_do__

---

### Task 13. Align the e2e proof path with host-network addresses

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Update the checked-in e2e env injection, config, and test assumptions so the e2e proof path follows the real host-visible addresses after the host-network cutover. This task is complete when the checked-in e2e wrapper and tests no longer depend on bridge-era URLs or ports and still keep browser navigation targets separate from MCP control-channel targets.

#### Documentation Locations

- Playwright config and base URL handling: Context7 `/microsoft/playwright`. Use this to keep the checked-in Playwright config and e2e wrapper aligned with the final host-visible addresses.
- Docker/Compose environment wiring: Context7 `/docker/compose`. Use this to confirm how the e2e stack should receive host-visible URLs after the host-network cutover.

#### Subtasks

1. [ ] Read `scripts/test-summary-e2e.mjs`, `docker-compose.e2e.yml`, `.env.e2e`, `e2e/playwright.config.ts`, and the checked-in `e2e` tests together with story sections `## Proof Path Readiness` and `## Final Validation`.
2. [ ] Update any checked-in e2e env injection, checked-in e2e config, or test assumptions that would otherwise still point at stale bridge-era URLs or ports after the host-network cutover. The end result must use the real host-visible addresses from the story’s port matrix.
3. [ ] Keep browser navigation targets and MCP control-channel targets as separate contracts where the story requires them. Do not replace one with the other just because both are host-visible URLs.
4. [ ] Add or update an e2e test in `e2e/env-runtime-config.spec.ts` that asserts the runtime uses the intended host-visible base URL instead of a stale bridge-only address. Purpose: prove the browser-facing side of the e2e path has moved to the host-network contract.
5. [ ] Add or update an e2e test in `e2e/env-runtime-config.spec.ts` that asserts any MCP control-channel URL uses the intended host-visible value instead of a stale bridge-only address. Purpose: prove the control-channel side of the e2e path has moved to the host-network contract.
6. [ ] Add or update an e2e test in `e2e/env-runtime-config.spec.ts` that asserts the browser base URL and MCP control-channel URL remain separate values where the env contract expects them to differ. Purpose: prove the host-network cutover did not collapse navigation and control endpoints into one contract.
7. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
8. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run test:summary:e2e`

#### Implementation notes

- __to_do__

---

### Task 14. Run final validation for Story 0000050

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

This task proves the completed story against the acceptance criteria. It must rerun the wrapper-first build and test paths, prove the runtime behavior with the new proof wrappers, and capture the final manual verification evidence that the rest of the close-out will reference.

#### Documentation Locations

- Docker/Compose runtime validation: Context7 `/docker/compose` plus https://docs.docker.com/engine/network/tutorials/host/. Use these for the final host-network runtime checks and port expectations.
- Playwright runtime validation: Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype. Use these for the final browser-control and CDP validation work.
- Cucumber guide for reliable automated test execution: https://cucumber.io/docs/guides/continuous-integration/. Use this because this task runs the checked-in cucumber wrapper as part of the final validation pass and needs a current guide under the required `/docs/guides/` path.

#### Subtasks

1. [ ] Re-read `## Acceptance Criteria` and `## Final Validation` before starting this task. This task is the acceptance-criteria gate, so do not rely on memory or earlier task notes alone.
2. [ ] Run the wrapper-first build and test paths required by the story and record the saved-output locations that later close-out notes will reference. Keep the exact commands aligned with the `#### Testing` list in this task.
3. [ ] Inspect the running containers and Compose definitions to prove the host-network runtime is using image-baked application contents rather than host source bind mounts, with only Docker-managed generated-output volumes plus the explicitly host-visible logs remaining.
4. [ ] Verify the final runtime still supports the required traffic patterns on the documented host-visible endpoints:
   - REST/API access;
   - classic `/mcp`;
   - dedicated chat MCP;
   - agents MCP;
   - Playwright browser control;
   - websocket flows;
   - screenshot capture;
   - manual UI verification;
   - and the local manual-testing Chrome DevTools contract on `9222`, keeping that `9222` endpoint as a distinct Chromium CDP surface rather than treating it as interchangeable with the Playwright MCP control URL.
5. [ ] Use Playwright MCP tools to manually verify the running product and save screenshots to `test-results/screenshots/` using the filename pattern `0000050-10-<short-name>.png`. Capture enough screenshots to prove the validated UI and runtime state from this task, not just that the page loads.
6. [ ] Record any later documentation deltas for Task 15. Do not update shared docs in this task unless a new file is created here.
7. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run test:summary:server:unit`
5. [ ] `npm run test:summary:server:cucumber`
6. [ ] `npm run test:summary:shell`
7. [ ] `npm run compose:up`
8. [ ] `npm run test:summary:host-network:main`
9. [ ] `npm run compose:down`
10. [ ] `npm run test:summary:e2e`

#### Implementation notes

- __to_do__

---

### Task 15. Update documentation and story close-out

- Repository Name: `codeInfo2`
- Task Status: __to_do__
- Git Commits: **to_do**

#### Overview

Update the shared documentation and prepare the finished story for review after Task 14 has produced the final validated behavior. This task is complete when the repo docs match the implemented contracts and the pull-request summary clearly explains the final server, runtime, wrapper, and proof-path changes.

#### Documentation Locations

- Docker/Compose runtime documentation: Context7 `/docker/compose` plus https://docs.docker.com/engine/network/tutorials/host/. Use these when updating docs so the host-network contract and prerequisites are described accurately.
- Playwright runtime and screenshot documentation: Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype. Use these when documenting the proof wrappers, screenshots, and Chrome DevTools validation behavior.
- Cucumber guides for validation workflow context: https://cucumber.io/docs/guides/testable-architecture/ and https://cucumber.io/docs/guides/continuous-integration/. Use these to keep the close-out notes grounded in reliable automated test usage rather than UI-only proof.
- Any external documentation sources recorded in the earlier tasks when they introduced new commands or runtime contracts

#### Subtasks

1. [ ] Update `README.md` with any new commands, proof wrappers, or runtime expectations introduced by this story. Use the saved outputs and verified command names from Task 14 instead of guessing final command text.
2. [ ] Update `design.md` so it documents these exact items from the implemented story:
   - the re-ingest request union;
   - the single and batch re-ingest payloads;
   - the blank-markdown skip behavior;
   - the host-networked runtime and proof-wrapper flow.
3. [ ] Update `docs/developer-reference.md` so it no longer documents stale MCP URLs, stale env-var names, or bridge-only networking assumptions after the host-network and `CODEINFO_CHAT_MCP_PORT` cutover.
4. [ ] Update `projectStructure.md` with every new or changed file path created by this story, including wrappers, tests, vendored shell-harness runtime files, and any new server modules.
5. [ ] Write the pull-request summary covering all tasks in this story, including server contract changes, Docker/runtime changes, wrapper changes, proof-path additions, and the validation evidence captured in Task 14.
6. [ ] Run repo-wide lint and format gates as the last subtask for this task.

#### Testing

1. [ ] Review the saved outputs and screenshots from Task 14 and confirm the documentation and PR summary match the final validated behavior.

#### Implementation notes

- __to_do__

---
