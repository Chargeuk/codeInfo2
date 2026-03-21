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
- The dedicated batch result payload for `target: "all"` also contains a summary block with explicit `total`, `reingested`, `skipped`, and `failed` counts so the UI, logs, and tests can assert the whole batch outcome without recalculating it from the per-repository entries.
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
- The final host-networked runtime proves that the checked-in runtime assets required by the stack, including the `codex/` and `codex_agents/` trees and any checked-in flow directory used by that stack, are available from image contents instead of from host source bind mounts.
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
  - the main-stack proof wrapper and the final validation task both show the classic `/mcp`, dedicated chat MCP, dedicated agents MCP, and Playwright MCP surfaces reachable on their documented host-visible endpoints instead of only proving that the containers started.
  - Checked-in config files resolve the MCP placeholders to literal runtime URLs for the server-owned MCP surfaces and the Playwright override without leaving raw placeholders in the runtime config passed to Codex.
  - Direct `sourceId`, `target: "current"`, and `target: "all"` re-ingest runs all produce the transcript and storage shapes defined in `## Message Contracts And Storage Shapes`.
  - Empty-markdown command or flow steps are skipped with the documented info-level log contract and do not create a new persisted storage shape of their own.

## Task Feasibility Proof Pass

- Repository scope validation:
  - Every task in this story belongs to the single repository `codeInfo2`.
  - No task currently mixes work across repositories, so no repository split is required.

## Repository Ownership Audit

- Story ownership result:
  - This story affects exactly one repository: `codeInfo2`.
  - No task in this story should be split across repositories because there is no second repository involved in the planned work.
- Step-level ownership rule for the finalised task list:
  - Every task, subtask, testing step, and final validation step below belongs exclusively to repository `codeInfo2`.
  - No subtask, testing step, or final validation step in this story touches any other repository.
  - No cross-repository prerequisite or `npm link` proof path is required for this story because there is no library-consumer repository split.
- Sequencing consequence:
  - All task sequencing, proof paths, and final validation steps below should be interpreted as single-repository `codeInfo2` work only.

## Traceability And Proof Pass

### Description And Major Requirement Traceability

- Portable re-ingest definitions must keep existing `sourceId` steps working while also accepting portable selectors instead of machine-specific absolute paths.
  - Implemented by Task 1 subtasks 1-3 and Task 3 subtasks 2, 7, and 8.
  - Proved by Task 1 Testing steps 1-3, Task 3 Testing steps 1-3, and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Regression and error coverage comes from Task 1 subtasks 7-17 and Task 3 subtasks 9 and 18.
- `target: "current"` must resolve by the owning repository of the currently executing command or flow file, including the nested-command ownership rule.
  - Implemented by Task 3 subtasks 1-5.
  - Proved by Task 3 subtasks 10-14 and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Error and corner-case coverage comes from Task 3 subtasks 13 and 14.
- `target: "all"` must run sequentially in ascending canonical container path order, continue after per-repository failures, and record one dedicated batch result payload.
  - Implemented by Task 3 subtasks 4-5 and Task 4 subtasks 2-17.
  - Proved by Task 3 subtasks 15-18, Task 4 subtasks 10-17, and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Corner-case coverage comes from Task 3 subtask 16 and Task 4 subtasks 14-15. Error and mixed-outcome coverage comes from Task 3 subtask 17 and Task 4 subtasks 12-13.
- The strict single-repository re-ingest service must remain the canonical execution layer and must not absorb selector parsing or multi-repository orchestration.
  - Implemented by Task 2 subtasks 1-3 and Task 3 subtasks 2-5.
  - Proved by Task 2 subtasks 4-15, Task 3 subtask 18, Task 15 subtask 3, and Task 15 Testing steps 1, 3, and 4.
  - Regression coverage comes from Task 2 subtasks 10-15.
- Blank or whitespace-only markdown files must be skipped only after a successful read, with the documented info log contract, while all real resolver failures remain hard failures.
  - Implemented by Task 5 subtasks 1-4.
  - Proved by Task 5 subtasks 5-14 and Task 15 subtask 7 plus Testing steps 1, 3, and 4.
  - Error and corner-case coverage comes from Task 5 subtasks 7-13.
- Checked-in MCP config, env, and runtime consumers must move to one shared placeholder-normalization contract with explicit placeholders and no permanent legacy `CODEINFO_MCP_PORT` fallback.
  - Implemented by Task 6 subtasks 1-4 and Task 7 subtasks 1-3.
  - Proved by Task 6 subtasks 5-15, Task 7 subtasks 4-8, and Task 15 subtasks 4 and 7 plus Testing steps 1, 3, and 4.
  - Regression and error coverage comes from Task 6 subtasks 9-15 and Task 7 subtasks 5-8.
- Checked-in `server` and existing `playwright-mcp` Compose services must move to host networking while preserving the documented port matrix, avoiding source-tree runtime bind mounts, and failing fast when prerequisites are missing.
  - Implemented by Task 8 subtasks 1-7, Task 9 subtasks 1-10, Task 10 subtasks 1-4, Task 11 subtasks 1-4, Task 12 subtasks 1-7, and Task 13 subtasks 1-6.
  - Proved by Task 8 Testing steps 1-3, Task 9 Testing steps 1-3, Task 10 Testing step 1, Task 11 Testing steps 1-4, Task 12 subtasks 2-7 plus Testing steps 1-7, Task 13 Testing steps 1-8, and Task 15 subtasks 2-7 plus Testing steps 1-10.
  - Regression, error, and corner-case coverage comes from Task 9 subtasks 4-10, Task 12 subtasks 5-7, and Task 13 subtasks 4-6.
- Final validation must prove the whole story end to end, not only isolated task behavior, and documentation must reflect the validated end state.
  - Implemented by Task 15 subtasks 1-10 and Task 16 subtasks 1-5.
  - Proved by Task 15 Testing steps 1-10 and Task 16 Testing step 1.
  - Regression and scope-drift coverage comes from Task 15 subtasks 3-8 and Task 16 subtasks 1-5.

### Acceptance Criteria Traceability

- Existing path-based re-ingest remains valid, portable selector support is added, selector matching stays aligned with `repositorySelector`, and duplicate case-insensitive ids still pick the latest ingest.
  - Implemented by Task 1 subtasks 1-3 and Task 3 subtasks 2 and 7-9.
  - Proved by Task 1 subtasks 4-17, Task 3 subtasks 7-9, and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Regression and corner cases are covered by Task 1 subtasks 7-17 and Task 3 subtask 9.
- Direct command, top-level flow, and nested command-item `target: "current"` behavior all resolve to the correct owner, and missing or not-ingested owners fail fast.
  - Implemented by Task 3 subtasks 1-5.
  - Proved by Task 3 subtasks 10-14 and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Error coverage comes from Task 3 subtasks 13-14.
- `target: "all"` exists, runs sequentially, uses ascending canonical container path order, waits for terminal outcomes, and preserves deterministic behavior.
  - Implemented by Task 3 subtasks 4-5.
  - Proved by Task 3 subtasks 15-17 and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Corner-case coverage comes from Task 3 subtask 16 and mixed-outcome coverage comes from Task 3 subtask 17.
- `target: "all"` writes one dedicated batch result payload whose entries preserve repository identity, canonical container path, normalized outcome, and failure text when needed.
  - Implemented by Task 4 subtasks 2-6.
  - Proved by Task 4 subtasks 10-17 and Task 15 subtasks 1-4 plus Testing steps 1, 3, 4, and 6.
  - Corner-case and error coverage comes from Task 4 subtasks 12-15 and 17-18.
- The low-level strict service remains canonical, and structured re-ingest result recording still works for direct commands, flow re-ingest steps, and nested command execution.
  - Implemented by Task 2 subtasks 1-3, Task 3 subtasks 2-5, and Task 4 subtasks 2-6.
  - Proved by Task 2 subtasks 4-15, Task 3 subtask 18, Task 4 subtasks 7-18, and Task 15 subtasks 1-4 plus Testing steps 1, 3, and 4.
  - Regression coverage comes from Task 2 subtasks 10-15 and Task 4 subtask 18.
- Empty or whitespace-only markdown is skipped rather than executed, and the info-level log includes the surface and resolved path.
  - Implemented by Task 5 subtasks 1-4.
  - Proved by Task 5 subtasks 5-9 and Task 15 subtask 7 plus Testing steps 1, 3, and 4.
  - Error coverage comes from Task 5 subtasks 10-13.
- Every checked-in Compose file that currently defines `server` moves to host networking, preserves the checked-in server port matrix, keeps app code image-baked, and removes incompatible bridge wiring and forbidden runtime source mounts.
  - Implemented by Task 10 subtasks 1-4 and Task 11 subtasks 1-4. The checked-in `server` inventory for this story is explicitly `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`.
  - Proved by Task 10 Testing step 1, Task 11 subtasks 2-4 plus Testing steps 1-4, and Task 15 subtasks 3-5 plus Testing steps 7-10.
  - Regression and mount-safety coverage comes from Task 11 subtask 4 and Task 15 subtask 5.
- Every checked-in Compose file that currently defines `playwright-mcp` moves to host networking, files without that service stay out of scope, and the main/local stacks keep distinct default Playwright MCP ports.
  - Implemented by Task 9 subtasks 2-10 and Task 11 subtasks 1-2. The checked-in `playwright-mcp` inventory for this story is explicitly `docker-compose.yml` and `docker-compose.local.yml`.
  - Proved by Task 9 subtasks 4-10, Task 11 subtasks 2-4 plus Testing steps 1-4, and Task 15 subtasks 4-6 plus Testing steps 7-10.
  - Error and out-of-scope coverage comes from Task 9 subtasks 8-10.
- Checked-in runtime MCP config moves off hard-coded localhost and bridge hostnames, preserves the intentional chat-versus-agents endpoint split, uses explicit placeholders plus runtime overlays, and replaces placeholders before runtime consumers see them.
  - Implemented by Task 6 subtasks 1-4 and Task 7 subtasks 1-3.
  - Proved by Task 6 subtasks 5-15, Task 7 subtasks 4-8, and Task 15 subtasks 4-5 plus Testing steps 1, 3, and 4.
  - Error and regression coverage comes from Task 6 subtasks 9-15 and Task 7 subtasks 5-8.
- The final MCP env contract uses `CODEINFO_SERVER_PORT`, `CODEINFO_CHAT_MCP_PORT`, `CODEINFO_AGENTS_MCP_PORT`, and `CODEINFO_PLAYWRIGHT_MCP_URL`, the shared normalization layer is used by all runtime consumers, and the legacy `CODEINFO_MCP_PORT` fallback is removed.
  - Implemented by Task 6 subtasks 2-4 and Task 7 subtasks 2-3.
  - Proved by Task 6 subtasks 5-15, Task 7 subtasks 4-8, and Task 15 subtasks 4-5 plus Testing steps 1, 3, and 4.
  - Regression and error coverage comes from Task 6 subtasks 10-15 and Task 7 subtasks 5-7.
- The checked-in shared-home runtime configs under `codex/` are migrated alongside `codex_agents/*`, browser URLs stay separate from control-channel URLs, and host-network prerequisites fail fast with actionable messages.
  - Implemented by Task 7 subtasks 1-3, Task 9 subtasks 1-10, and Task 13 subtasks 1-3.
  - Proved by Task 7 subtasks 4-8, Task 9 subtasks 4-10, Task 13 subtasks 4-6, and Task 15 subtasks 4-7 plus Testing steps 1-10.
  - Error and corner-case coverage comes from Task 9 subtasks 4-10 and Task 13 subtasks 4-6.
- Final validation proves listener readiness, config migration, wrapper preflight, image-baked runtime contents, generated-output volume rules, and the full manual-testing traffic patterns.
  - Implemented by Task 12 subtasks 1-7, Task 13 subtasks 1-6, and Task 15 subtasks 1-10.
  - Proved by Task 12 subtasks 5-7 plus Testing steps 1-7, Task 13 Testing steps 1-8, and Task 15 subtasks 2-8 plus Testing steps 1-10.
  - Regression coverage comes from Task 12 subtasks 5-7, Task 13 subtasks 4-6, and Task 15 subtasks 4-7.

### Out Of Scope Traceability

- No new multi-repository ingest engine replaces the strict single-repository service.
  - Guarded by Task 2 subtasks 1-3, Task 3 subtasks 2-5, and Task 15 subtask 3.
- No parallel `target: "all"` execution is introduced.
  - Guarded by Task 3 subtask 4 and Task 15 subtask 3.
- No unrelated repository-selector expansion is added outside re-ingest.
  - Guarded by Task 1 subtasks 1-3, Task 3 subtasks 2-5, and Task 15 subtask 3.
- No broad `sourceId` terminology cleanup is attempted across unrelated surfaces.
  - Guarded by Task 1 subtasks 1-3, Task 4 subtasks 2 and 5, and Task 15 subtask 3.
- No unrelated workflow step types are reworked.
  - Guarded by Task 1 subtask 3, Task 5 subtasks 1-4, and Task 15 subtask 3.
- No unrelated Playwright MCP behavior is reworked beyond networking, endpoint, and port concerns.
  - Guarded by Task 9 subtasks 2-10, Task 11 subtask 2, Task 13 subtasks 1-3, and Task 15 subtask 3.
- No unrelated server networking model is reworked beyond the checked-in `server` host-network cutover and its required proof paths.
  - Guarded by Task 6 subtasks 1-4, Task 11 subtasks 1-4, and Task 15 subtask 3.
- No whole-stack Docker networking redesign is attempted beyond the scoped `server` and existing `playwright-mcp` services.
  - Guarded by Task 9 subtasks 2-10, Task 11 subtasks 1-4, and Task 15 subtask 3.
- No brand-new `server` or `playwright-mcp` services are added to Compose files that do not already define them.
  - Guarded by Task 9 subtask 8, Task 11 subtask 2, and Task 15 subtask 3.

## Manual Playwright-MCP Log Evidence

- During each Manual Playwright-MCP validation step in this story, inspect the running log stream through the product’s checked-in log surfaces for that environment, including the Logs page plus any saved wrapper output created earlier in the same task.
- Task 1 log marker: `DEV-0000050:T01:reingest_request_shape_accepted`
  - Expected outcome: `surface`, `targetMode`, `requestedSelector`, and `schemaSource` are present, and `targetMode` matches the request that was triggered.
- Task 2 log marker: `DEV-0000050:T02:reingest_strict_result_normalized`
  - Expected outcome: `sourceId`, `resolvedRepositoryId`, `status`, and `completionMode` are present, and `completionMode` matches the terminal strict-service result.
- Task 3 log marker: `DEV-0000050:T03:reingest_targets_resolved`
  - Expected outcome: `surface`, `targetMode`, `requestedSelector`, `resolvedCount`, and `resolvedPaths` are present, and `resolvedPaths` are in ascending canonical path order for `all`.
- Task 4 log marker: `DEV-0000050:T04:reingest_payload_persisted`
  - Expected outcome: `payloadKind`, `targetMode`, `repositoryCount`, and `conversationId` are present, and `payloadKind` matches the single-versus-batch transcript shape that was persisted.
- Task 5 log marker: `DEV-0000050:T05:markdown_step_skipped`
  - Expected outcome: `surface`, `markdownFile`, `resolvedPath`, and `reason: "empty_markdown"` are present, and the log appears only for successfully resolved whitespace-only markdown.
- Task 6 log marker: `DEV-0000050:T06:mcp_endpoints_normalized`
  - Expected outcome: `classicMcpUrl`, `chatMcpUrl`, `agentsMcpUrl`, `playwrightMcpUrl`, and `placeholderFree` are present, and `placeholderFree` is `true`.
- Task 7 log marker: `DEV-0000050:T07:checked_in_mcp_contract_loaded`
  - Expected outcome: `configPath`, `chatPortVar`, `agentsPortVar`, `playwrightUrlVar`, and `legacyFallbackUsed` are present, and `legacyFallbackUsed` is `false`.
- Task 8 log marker: `DEV-0000050:T08:shell_harness_ready`
  - Expected outcome: `suiteCount`, `vendorMode`, and `targetedRunSupported` are present in the shell-harness wrapper output, and `suiteCount` is greater than zero.
- Task 9 log marker: `DEV-0000050:T09:compose_preflight_result`
  - Expected outcome: `composeFile`, `result`, `playwrightServicePresent`, and `checkedPorts` are present, and the happy-path manual check sees `result: "passed"`.
- Task 10 log marker: `DEV-0000050:T10:image_runtime_assets_baked`
  - Expected outcome: `imageName`, `runtimeAssetRoots`, and `sourceBindMountRequired` are present, and `sourceBindMountRequired` is `false`.
- Task 11 log marker: `DEV-0000050:T11:host_network_runtime_ready`
  - Expected outcome: `composeFile`, `serverPorts`, `playwrightPort`, and `sourceBindMountCount` are present, and the active stack’s ports match the story contract with `sourceBindMountCount: 0` for source/config trees.
- Task 12 log marker: `DEV-0000050:T12:main_stack_probe_completed`
  - Expected outcome: `classicMcp`, `chatMcp`, `agentsMcp`, `playwrightMcp`, and `result` are present, and `result` is `passed`.
- Task 13 log marker: `DEV-0000050:T13:e2e_host_network_config_verified`
  - Expected outcome: `browserBaseUrl`, `mcpControlUrl`, and `baseUrlMatchesMcp` are present, both URLs are host-visible, and `baseUrlMatchesMcp` is `false` when the contracts are intentionally separate.
- Task 15 final-validation log marker (historical runtime name retained): `DEV-0000050:T14:story_validation_completed`
  - Expected outcome: `traceabilityPass`, `manualChecksPassed`, `screenshotCount`, and `proofWrapperPassed` are present, and each final-validation boolean is `true`.

### Task 1. Extend re-ingest schema parsing for command and flow files

- Already existing capabilities:
  - `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` already define the current `reingest` item shape.
  - Matching unit-test files already exist and can be extended.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - This assumption has now been resolved by Task 1. Later tasks may assume `target: "current"` and `target: "all"` parse successfully, but they must not assume those target modes execute yet until Task 3 lands the shared orchestration layer.

### Task 2. Extend the strict single-repository re-ingest result contract

- Already existing capabilities:
  - `server/src/ingest/reingestService.ts` already owns the strict single-repository contract and validation categories.
  - `server/src/test/unit/reingestService.test.ts` already covers that service.
- Missing prerequisite capabilities:
  - None before this task begins.
- Assumptions currently invalid:
  - This assumption has now been resolved by Task 2. Later tasks may assume `resolvedRepositoryId` and `completionMode` exist on the strict single-repository result contract, but they must not assume transcript persistence or batch payload support exists yet until Task 4 lands.

### Task 3. Add shared target orchestration for `sourceId`, `current`, and `all`

- Already existing capabilities:
  - `sourceId` and `flowSourceId` ownership context is already threaded through command and flow execution.
  - `server/src/mcpCommon/repositorySelector.ts` already provides the reusable selector helper.
- Missing prerequisite capabilities:
  - These prerequisites have now been satisfied by Tasks 1 and 2, so Task 3 can build on parsed `target` inputs and the extended strict result contract.
- Assumptions currently invalid:
  - This assumption has now been resolved by Task 3. Later tasks may assume shared `current` and `all` orchestration exists and returns ordered intermediate outcomes, but they must not assume transcript persistence or final batch payload shapes exist yet until Task 4 lands.

### Task 4. Emit and persist the new single and batch re-ingest transcript payloads

- Already existing capabilities:
  - `server/src/chat/reingestToolResult.ts` and `server/src/chat/reingestStepLifecycle.ts` already provide the persistence seam.
  - Existing persisted turn storage already uses `Turn.toolCalls`.
- Missing prerequisite capabilities:
  - These prerequisites have now been satisfied by Tasks 2 and 3, so Task 4 can assume the strict result contract already carries the extended fields and the orchestration layer already produces ordered single-target and batch-target intermediate outcomes.
- Assumptions currently invalid:
  - This assumption has now been resolved by Task 4. Later tasks may assume the single-result and batch-result transcript payloads exist and persist through `Turn.toolCalls`, but they must not assume blank-markdown skipping, MCP config migration, or Docker/runtime proof-path work exists yet.

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

### Task 14. Restore repo-wide lint and format gates for story close-out

- Already existing capabilities:
  - The repo already has the root `npm run lint`, `npm run lint:fix`, `npm run format`, and `npm run format:check` commands, the current blocker research, and the exact failing file list.
- Missing prerequisite capabilities:
  - Tasks 1 through 13 must all be complete first.
- Assumptions currently invalid:
  - The original final-validation task assumed repo-wide lint and format cleanup could be completed honestly inside runtime proof work, but the blocker showed that this is a separate prerequisite baseline task with its own file-scoped fixes and ignore-rule change.

### Task 15. Run final validation for Story 0000050

- Already existing capabilities:
  - The repo already has the wrapper-first build and test commands, plus the manual Playwright verification workflow.
- Missing prerequisite capabilities:
  - Tasks 1 through 14 must all be complete first.
- Assumptions currently invalid:
  - The historical runtime proof marker name `DEV-0000050:T14:story_validation_completed` and the already-captured `0000050-14-*` screenshot prefix remain in place for compatibility with pre-repair evidence, even though this is now Task 15.

### Task 16. Update documentation and story close-out

- Already existing capabilities:
  - The repo already has the shared documentation files and PR-summary workflow to reuse.
- Missing prerequisite capabilities:
  - Task 14 must restore the clean repo-wide lint/format baseline first, and Task 15 must land first so the docs and close-out reflect the final validated behavior rather than an earlier draft state.
- Assumptions currently invalid:
  - Documentation and close-out content should not be treated as final until the validation evidence from Task 15 exists.

# Tasks

### Task 1. Extend re-ingest schema parsing for command and flow files

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `99483e19` `DEV-[50] - Complete Task 1 reingest schema parsing`

#### Overview

Add the new re-ingest request union to command and flow schema parsing so JSON files can express `sourceId`, `target: "current"`, and `target: "all"` without yet changing execution behavior. This task is schema-only and is complete when parsing accepts the allowed shapes and rejects the invalid combinations defined in the plan.

#### Documentation Locations

- Zod unions and discriminated unions: Context7 `/colinhacks/zod`. Use this to confirm the allowed union constructors and why same-literal `type: "reingest"` branches cannot use `discriminatedUnion`.
- TypeScript unions and strict typing: https://www.typescriptlang.org/docs/. Use this to confirm the final inferred request types stay narrow and do not silently widen to optional `sourceId` plus optional `target`.

#### Subtasks

1. [x] In `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts`, read the current `sourceId`-only `reingest` schema together with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`. The exact request contract to copy into code is:
   - `{ "type": "reingest", "sourceId": "<selector-or-path>" }`
   - `{ "type": "reingest", "target": "current" }`
   - `{ "type": "reingest", "target": "all" }`
   - invalid when both `sourceId` and `target` are present.
2. [x] In `server/src/agents/commandsSchema.ts`, replace the current `AgentCommandReingestItemSchema` with a plain union of strict object shapes or an equivalent mutual-exclusion helper. Do not use `z.discriminatedUnion('type', ...)`, because every allowed variant still has `type: 'reingest'`. The implementation should read like this shape, even if variable names differ:
   ```ts
   z.union([
     z
       .object({ type: z.literal('reingest'), sourceId: trimmedNonEmptyString })
       .strict(),
     z
       .object({ type: z.literal('reingest'), target: z.literal('current') })
       .strict(),
     z
       .object({ type: z.literal('reingest'), target: z.literal('all') })
       .strict(),
   ]);
   ```
3. [x] In `server/src/flows/flowSchema.ts`, mirror the same `reingest` union for flow steps and keep the rest of the `flowStepUnionSchema()` behavior unchanged. The end result must leave `llm`, `break`, `command`, and `startLoop` validation exactly as-is while only broadening the `reingest` step shape.
4. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that parses a command file containing `{ "type": "reingest", "sourceId": "<selector-or-path>" }`. Purpose: prove the happy-path command schema still accepts explicit selector/path re-ingest items.
5. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that parses a command file containing `{ "type": "reingest", "target": "current" }`. Purpose: prove the command schema accepts the new current-repository target.
6. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that parses a command file containing `{ "type": "reingest", "target": "all" }`. Purpose: prove the command schema accepts the new all-repositories target.
7. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects a command item containing both `sourceId` and `target`. Purpose: prove the union is mutually exclusive instead of silently accepting ambiguous input.
8. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects a command item whose `target` is not `current` or `all`. Purpose: prove invalid target values fail at parse time.
9. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects an empty or whitespace-only `sourceId`. Purpose: prove the command schema does not accept blank selectors.
10. [x] Add a server unit test in `server/src/test/unit/agent-commands-schema.test.ts` that rejects an otherwise valid `reingest` item containing an unexpected extra property. Purpose: prove the strict object shape still rejects undeclared keys.
11. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that parses a flow step containing `{ "type": "reingest", "sourceId": "<selector-or-path>" }`. Purpose: prove the happy-path flow schema still accepts explicit selector/path re-ingest steps.
12. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that parses a flow step containing `{ "type": "reingest", "target": "current" }`. Purpose: prove the flow schema accepts the new current-repository target.
13. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that parses a flow step containing `{ "type": "reingest", "target": "all" }`. Purpose: prove the flow schema accepts the new all-repositories target.
14. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects a flow step containing both `sourceId` and `target`. Purpose: prove flow parsing keeps the same mutual-exclusion rule as command parsing.
15. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects a flow step whose `target` is not `current` or `all`. Purpose: prove invalid flow target values fail at parse time.
16. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects an empty or whitespace-only `sourceId`. Purpose: prove the flow schema does not accept blank selectors.
17. [x] Add a server unit test in `server/src/test/unit/flows-schema.test.ts` that rejects an otherwise valid `reingest` flow step containing an unexpected extra property. Purpose: prove the strict flow step shape still rejects undeclared keys.
18. [x] Add or update the structured manual-validation log marker `DEV-0000050:T01:reingest_request_shape_accepted` in the command or flow execution path that first consumes the parsed re-ingest item. Include `surface`, `targetMode`, `requestedSelector`, and `schemaSource`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove the schema shape accepted by Task 1 is the one that actually reached runtime.
19. [x] Record any new or renamed files for later documentation updates in Task 16. Do not update `README.md`, `design.md`, or `projectStructure.md` in this task unless a new file is created here.
20. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
21. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Read the current command and flow re-ingest schema owners together with the story contract so the accepted Task 1 shapes stayed aligned with the plan.
- Replaced the command re-ingest parser with a strict plain `z.union` of `sourceId`, `target: "current"`, and `target: "all"` variants so we avoided the invalid same-literal discriminated-union approach.
- Broadened the flow re-ingest step shape with the same three strict variants while leaving the non-reingest flow validation rules untouched.
- Kept the existing command schema happy-path `sourceId` parsing test in place while treating it as the required explicit-selector coverage for this task.
- Added command-schema coverage for `target: "current"` so the new current-target request shape is accepted at parse time.
- Added command-schema coverage for `target: "all"` so the new all-target request shape is accepted at parse time.
- Added command-schema coverage that rejects mixed `sourceId` plus `target` input so the request union stays mutually exclusive.
- Added command-schema coverage that rejects unsupported target values so invalid re-ingest target names fail during parsing.
- Added command-schema coverage that rejects blank `sourceId` values after trimming so selector input cannot degrade to whitespace.
- Kept the existing strict extra-property rejection test in place as the required command re-ingest strictness coverage.
- Kept the existing flow-schema happy-path `sourceId` parsing test in place while treating it as the required explicit-selector coverage for flow steps.
- Added flow-schema coverage for `target: "current"` so the flow parser accepts the new current-target shape.
- Added flow-schema coverage for `target: "all"` so the flow parser accepts the new batch-target shape.
- Added flow-schema coverage that rejects mixed `sourceId` plus `target` input so flow parsing matches the command mutual-exclusion rule.
- Added flow-schema coverage that rejects unsupported target values so invalid flow target names fail at parse time.
- Added flow-schema coverage that rejects blank `sourceId` values after trimming so flow selectors cannot be whitespace-only.
- Kept the existing strict extra-property rejection test in place as the required flow re-ingest strictness coverage.
- Added the `DEV-0000050:T01:reingest_request_shape_accepted` marker in the first command, nested-command, and flow execution seams that consume parsed re-ingest items, and made unsupported target modes fail explicitly until Task 3 lands the real orchestration.
- No new or renamed files were introduced during Task 1, so the follow-up documentation delta for Task 16 is only that existing schema, test, and runtime-consumption files changed.
- Ran `npm run lint`, then `npm run lint:fix`, then `npm run lint` again; the repo-wide command still fails on an unrelated pre-existing warning in `client/src/components/chat/SharedTranscript.tsx`, but no remaining lint issues were left in the Task 1 files.
- Ran `npm run format:check`, then `npm run format`, then `npm run format:check` again; the repo-wide command still fails on unrelated formatting drift plus the intentionally invalid JSON fixture `server/src/test/fixtures/flows/invalid-json.json`, and `npx prettier --check` passed for all Task 1 files after the cleanup.
- `npm run build:summary:server` passed cleanly with `warning_count: 0` and wrapper guidance `agent_action: skip_log`, so the Task 1 server build gate is complete without log inspection.
- `npm run test:summary:server:unit` passed cleanly with `1306` tests run, `1306` passed, `0` failed, and wrapper guidance `agent_action: skip_log`, so the Task 1 schema and runtime-marker changes are covered by the full server unit suite.
- `npm run test:summary:server:cucumber` passed cleanly with `71` tests run, `71` passed, `0` failed, and wrapper guidance `agent_action: skip_log`, so the Task 1 changes did not regress the checked-in cucumber flow coverage.

---

### Task 2. Extend the strict single-repository re-ingest result contract

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `d365fa36`

#### Overview

Keep `runReingestRepository()` strict on one canonical repository, but extend its success payload so downstream code can tell which repository was selected and whether a completed run was a real re-ingest or an internal skip. This task is complete when the strict service contract matches the story’s `resolvedRepositoryId` and `completionMode` requirements and has unit coverage.

#### Documentation Locations

- TypeScript types and unions: https://www.typescriptlang.org/docs/. Use this to keep the extended success payload strongly typed while preserving the existing result union.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the exact `node:test` assertion and subtest patterns already used by the repo’s server unit suite.

#### Subtasks

1. [x] In `server/src/ingest/reingestService.ts`, read the current `ReingestSuccess` type, `runReingestRepository()` return path, and the existing cases in `server/src/test/unit/reingestService.test.ts` together with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`. This task changes only the strict single-repository result contract; it must not move selector parsing into this service.
2. [x] Update the `ReingestSuccess` payload in `server/src/ingest/reingestService.ts` so it adds these exact fields from the story contract:
   - `resolvedRepositoryId: string | null`
   - `completionMode: "reingested" | "skipped" | null`
   - keep the existing fields `status`, `operation`, `runId`, `sourceId`, `files`, `chunks`, `embedded`, and `errorCode`.
3. [x] In the same file, preserve the existing validation and terminal status behavior exactly as documented in `## Edge Cases and Failure Modes`:
   - keep `status` as `completed`, `cancelled`, or `error`;
   - keep existing failure codes and retry lists;
   - map internal ingest `skipped` to `status: "completed"` with `completionMode: "skipped"`;
   - keep the exact pre-start validation and busy-state categories unchanged for `missing`, `non_absolute`, `ambiguous_path`, `unknown_root`, `busy`, and `invalid_state`.
4. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a completed re-ingest and asserts `completionMode: "reingested"`. Purpose: prove the happy-path result distinguishes a real re-ingest from other completed outcomes.
5. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises an internal skipped ingest and asserts `completionMode: "skipped"`. Purpose: prove completed no-op behavior is preserved without being mislabeled as a full re-ingest.
6. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a cancelled execution and asserts `completionMode: null`. Purpose: prove cancelled outcomes do not report a misleading completion mode.
7. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a terminal error execution and asserts `completionMode: null`. Purpose: prove error outcomes do not report a misleading completion mode.
8. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a known repository id and asserts `resolvedRepositoryId` is populated. Purpose: prove downstream orchestration can identify the selected repository.
9. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that exercises a repository record with no repository id and asserts `resolvedRepositoryId: null`. Purpose: prove the contract is explicit when repository metadata is incomplete.
10. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `missing` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: guard against breaking existing caller expectations while extending the success payload.
11. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `non_absolute` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the exact absolute-path validation contract.
12. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `ambiguous_path` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the existing ambiguous-path failure contract.
13. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `unknown_root` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the existing unknown-root failure contract.
14. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `busy` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the busy-state retry contract.
15. [x] Add a server unit test in `server/src/test/unit/reingestService.test.ts` that verifies the `invalid_state` validation failure still returns the same code, message, and retry-after semantics as before. Purpose: preserve the invalid-state failure contract.
16. [x] Add or update the structured manual-validation log marker `DEV-0000050:T02:reingest_strict_result_normalized` in the strict re-ingest service or its immediate caller. Include `sourceId`, `resolvedRepositoryId`, `status`, and `completionMode`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove the Task 2 result contract reaches runtime unchanged.
17. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
18. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
19. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Read the strict re-ingest service and its existing unit coverage together with the story contract so the new fields landed in the service itself instead of leaking selector logic into Task 2.
- Extended `ReingestSuccess` with additive `resolvedRepositoryId` and `completionMode` fields so downstream tasks can distinguish the selected repo and a real re-ingest versus an internal skip without changing the existing result envelope.
- Preserved the strict terminal-state contract by keeping `status` limited to `completed`, `cancelled`, or `error` while mapping internal `skipped` to `status: "completed"` plus `completionMode: "skipped"`.
- Added unit coverage that proves completed runs now expose `completionMode: "reingested"` on the happy path.
- Added unit coverage that proves internal skipped runs surface `completionMode: "skipped"` without changing the outward `completed` status.
- Added unit coverage that proves cancelled runs keep `completionMode: null`.
- Added unit coverage that proves terminal error runs keep `completionMode: null`.
- Added unit coverage that proves a known repo record surfaces `resolvedRepositoryId` directly from the strict service result.
- Added unit coverage that proves missing repo-id metadata results in `resolvedRepositoryId: null` instead of a guessed fallback value.
- Added focused regression coverage that proves the `missing` validation failure still returns the strict `INVALID_PARAMS` contract with retry guidance intact.
- Added focused regression coverage that proves the `non_absolute` validation failure still returns the strict `INVALID_PARAMS` contract with the same reason and message.
- Added focused regression coverage that proves the `ambiguous_path` validation failure still returns the strict `INVALID_PARAMS` contract with the same reason and message.
- Added focused regression coverage that proves the `unknown_root` validation failure still returns the strict `NOT_FOUND` contract with retry guidance intact.
- Added focused regression coverage that proves the `busy` validation failure still returns the strict `BUSY` contract with retry guidance intact.
- Added focused regression coverage that proves the `invalid_state` validation failure still returns the strict `INVALID_PARAMS` contract with the unsupported-argument message preserved.
- Added the `DEV-0000050:T02:reingest_strict_result_normalized` marker in the strict service so the normalized Task 2 result contract is observable before later orchestration and transcript tasks build on it.
- No new or renamed files were introduced during Task 2, so the follow-up documentation delta for Task 16 is only that the strict service, its direct unit test, and shared test helper builders changed.
- Ran `npm run lint`, then `npm run lint:fix`, then `npm run lint` again; the repo-wide command still fails on the same unrelated pre-existing warning in `client/src/components/chat/SharedTranscript.tsx`, but no remaining lint issues were left in the Task 2 files.
- Ran `npm run format:check`, then `npm run format`, then `npm run format:check` again; the repo-wide command still fails on unrelated formatting drift plus the intentionally invalid JSON fixture `server/src/test/fixtures/flows/invalid-json.json`, and `npx prettier --check` passed for all Task 2 files after the cleanup.
- `npm run build:summary:server` first exposed missing additive `ReingestSuccess` fields in older test fixtures, and the rerun passed cleanly with `warning_count: 0` and wrapper guidance `agent_action: skip_log` after those helpers were updated.
- `npm run test:summary:server:unit` first failed on four Task 2 regressions, then the targeted wrapper rerun confirmed the fixes and the full rerun passed cleanly with `1313` tests run, `1313` passed, `0` failed, and wrapper guidance `agent_action: skip_log`.
- `npm run test:summary:server:cucumber` passed cleanly with `71` tests run, `71` passed, `0` failed, and wrapper guidance `agent_action: skip_log`, so the strict-result changes did not regress the checked-in cucumber coverage.

---

### Task 3. Add shared target orchestration for `sourceId`, `current`, and `all`

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `b1ee9436`

#### Overview

Implement the shared server-side orchestration that resolves the three re-ingest request modes into canonical repository paths before calling the strict service. This task is complete when command and flow execution can resolve `sourceId`, `current`, and `all` correctly, preserve deterministic ordering, return an empty batch for zero repositories, and continue after per-repository failures in `all` mode. A junior developer should treat each subtask below as standalone and keep the exact request contract, ownership rules, and deterministic ordering rule visible while working.

#### Documentation Locations

- TypeScript control flow and helper extraction: https://www.typescriptlang.org/docs/. Use this to structure the shared orchestration helper without widening types or duplicating resolution branches.
- Node.js test runner for targeted unit and integration coverage: https://nodejs.org/api/test.html. Use this for the targeted server tests that prove ordering, fail-fast behavior, and continue-on-failure handling.
- Mermaid flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the re-ingest target-resolution diagram so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] In `server/src/agents/commandsRunner.ts`, `server/src/flows/service.ts`, `server/src/agents/service.ts`, and `server/src/agents/commandItemExecutor.ts`, trace how `sourceId` and `flowSourceId` are threaded today. Keep these exact rules visible while you work: direct command current-owner = command file repository; top-level flow current-owner = flow file repository; nested command current-owner = command file repository; `target: "all"` = ascending canonical container path order. Also keep the task docs open while doing this step: TypeScript docs at https://www.typescriptlang.org/docs/, Node test docs at https://nodejs.org/api/test.html, and Mermaid docs via Context7 `/mermaid-js/mermaid`.
2. [x] Add one shared orchestration helper above `runReingestRepository()` so explicit selectors, `current`, and `all` all resolve to canonical container paths before strict execution begins. Put the shared logic where both the command path and flow path can call it, and reuse `server/src/mcpCommon/repositorySelector.ts` for selector matching instead of duplicating selector rules inside separate runners.
3. [x] In that shared orchestration helper, implement the `current` resolution rules exactly as written in the story:
   - direct command uses the command owner;
   - top-level flow uses the flow owner;
   - nested flow command uses the command owner, not the parent flow owner;
   - fail fast with a clear pre-start error when the current owner is missing or resolves to a repository that is not currently ingested, with no fallback to any other repository.
4. [x] In the same orchestration helper, implement `target: "all"` exactly as defined in `## Message Contracts And Storage Shapes`:
   - gather all ingested repositories;
   - sort by ascending canonical container path;
   - execute sequentially;
   - return an empty batch result when there are zero repositories;
   - continue after a per-repository failure and record that failure instead of aborting the batch.
5. [x] In `server/src/agents/commandItemExecutor.ts`, `server/src/agents/commandsRunner.ts`, and `server/src/flows/service.ts`, extend the intermediate re-ingest execution result types so command items and flow steps can carry either a resolved single-target result or a batch/all-target result. The new intermediate contract must keep enough data for transcript building, including `targetMode`, `requestedSelector`, and ordered per-repository outcomes where `target: "all"` is used.
6. [x] Add a server unit test in `server/src/test/unit/agent-commands-runner.test.ts` that exercises a `target: "all"` re-ingest result and asserts the intermediate runner/executor contract carries `targetMode`, `requestedSelector`, and ordered per-repository outcomes instead of one `sourceId`. Purpose: prove the new internal batch-result seam exists before transcript building consumes it.
7. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that uses a repo id selector and proves `sourceId` resolution still reaches the canonical repository path. Purpose: preserve the happy-path selector contract for repository ids.
8. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that uses an absolute path selector and proves explicit path-based re-ingest still works. Purpose: preserve backward compatibility for existing path-only workflows.
9. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that sets up duplicate case-insensitive repository ids and proves the selector helper still picks the latest ingest instead of failing ambiguous. Purpose: preserve the existing repository-selector tie-break behavior called for by the story.
10. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises direct-command `target: "current"` on the happy path. Purpose: prove the command owner is used when a command file re-ingests its own repository.
11. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises top-level-flow `target: "current"` on the happy path. Purpose: prove the flow owner is used when a flow step re-ingests the current flow repository.
12. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises nested command-item `target: "current"` on the happy path. Purpose: prove nested command execution uses the command owner rather than the parent flow owner.
13. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "current"` when there is no owning repository. Purpose: prove the step fails fast instead of falling back to another repository.
14. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "current"` when the owner exists in metadata but is not currently ingested. Purpose: prove the missing-ingest error happens before strict execution starts.
15. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "all"` with multiple repositories and asserts ascending canonical path order. Purpose: prove deterministic batch ordering.
16. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "all"` when there are zero ingested repositories. Purpose: prove the corner case returns an empty batch instead of crashing or fabricating work.
17. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that exercises `target: "all"` with a failing repository followed by successful or skipped repositories. Purpose: prove the batch continues after failure and preserves later outcomes instead of truncating the run.
18. [x] Add a server integration test in `server/src/test/integration/commands.reingest.test.ts` that verifies selector and target orchestration still surfaces the existing strict-service failure categories rather than collapsing them into a generic error. Purpose: preserve downstream error handling expectations.
19. [x] If this task introduces a new shared orchestration helper file, update `projectStructure.md` after the helper and its tests are in place. Document the exact helper file path, the updated test file path, and the purpose of the new orchestration seam so later developers can find the selector-resolution entry point.
20. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the `sourceId`, `current`, and `all` re-ingest orchestration flow. Purpose: document the new target-resolution architecture, ownership-resolution rules, the intermediate re-ingest result contract, and deterministic batch ordering in the repository design doc immediately after implementation.
21. [x] Add or update the structured manual-validation log marker `DEV-0000050:T03:reingest_targets_resolved` in the shared orchestration helper. Include `surface`, `targetMode`, `requestedSelector`, `resolvedCount`, and `resolvedPaths`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove the correct owner or ordered repository list was resolved before execution begins.
22. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
23. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
24. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Traced the current direct-command, top-level flow, and nested command-item re-ingest paths so Task 3 can add one shared orchestration seam above the strict Task 2 service while preserving the owner rules for `current` and the ordered batch requirement for `all`.
- Added `server/src/ingest/reingestExecution.ts` as the shared orchestration seam above the strict Task 2 service so command, flow, and flow-command execution now resolve explicit selectors, `current`, and `all` in one place by reusing the existing repository-selector helper.
- Implemented the `current` rules in that shared helper so direct commands use the command owner, top-level flows use the flow owner, nested flow commands use the command owner, and missing or not-ingested owners fail before the strict service starts.
- Implemented `target: "all"` in the shared helper with ascending canonical container-path ordering, sequential execution, empty-batch success, and continue-after-failure normalization for per-repository outcomes.
- Extended the command and flow execution seams to carry a shared single-versus-batch intermediate contract with `targetMode`, `requestedSelector`, and ordered repository outcomes so Task 4 can consume one real orchestration shape instead of reverse-engineering runner logs.
- Added the `DEV-0000050:T03:reingest_targets_resolved` marker in the shared orchestration helper so later manual validation can prove the resolved owner path or ordered batch target list before execution starts.
- Added runner coverage that proves a direct-command `target: "all"` result now carries `targetMode`, `requestedSelector`, and ordered per-repository outcomes in the intermediate execution seam before transcript persistence changes land in Task 4.
- Added direct-command integration coverage for repo-id selectors, explicit path selectors, duplicate case-insensitive ids, direct-command `target: "current"`, ordered `target: "all"` execution, empty-batch `target: "all"`, and preserved strict-service failure messaging.
- Added flow integration coverage for top-level `target: "current"` resolution, nested command-item `target: "current"` resolution, missing-owner failure, and not-currently-ingested owner failure so the owner rules are proven on the actual flow surfaces that thread `flowSourceId` and command ownership differently.
- Updated `projectStructure.md` to record the new `server/src/ingest/reingestExecution.ts` helper and the Task 3 test touchpoints so later Docker and transcript tasks can find the orchestration seam quickly.
- Updated `design.md` with the Task 3 orchestration contract and Mermaid flowchart, and the later Task 16 documentation delta is that README/developer-reference still need the final story-wide command and proof updates after the later runtime and Docker tasks land.
- Recorded the Task 16 follow-up doc delta explicitly: Task 3 touched only `design.md` and `projectStructure.md`, while the shared end-user and developer docs stay deferred until the later runtime, compose, and proof tasks settle the final story-wide contract.
- Ran `npm run lint`, then `npm run lint:fix`, then `npm run lint` again exactly as required; repo-wide baseline warnings still remain in unrelated client and older server test files, but a targeted `npx eslint` pass confirmed every Task 3 file is clean.
- Ran `npm run format:check`, then `npm run format`, then `npm run format:check` again; repo-wide Prettier still stops on the pre-existing intentionally invalid fixture `server/src/test/fixtures/flows/invalid-json.json`, and a targeted `npx prettier --check` pass confirmed the Task 3 files and plan/docs touched here are formatted correctly.
- `npm run build:summary:server` passed cleanly with `warning_count: 0` and `agent_action: skip_log`, so the shared orchestration seam and its updated callers compile in the full server workspace path before Task 3 close-out.
- `npm run test:summary:server:unit` passed cleanly with `tests run: 1325`, `passed: 1325`, `failed: 0`, and `agent_action: skip_log`; the saved wrapper log is `test-results/server-unit-tests-2026-03-21T05-18-45-252Z.log`.
- `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`; the saved wrapper log is `test-results/server-cucumber-tests-2026-03-21T05-28-38-970Z.log`.

---

### Task 4. Emit and persist the new single and batch re-ingest transcript payloads

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `527f6a33`

#### Overview

Update the transcript and persistence layer so single re-ingest runs emit the extended single payload and `target: "all"` emits one batch payload while remaining backward compatible with older stored turns. This task is complete when the new payloads are built, persisted, replayed, and read without breaking existing `toolCalls` storage assumptions. A junior developer should treat each subtask below as standalone and keep the exact payload contract visible while working.

#### Documentation Locations

- Mongoose mixed/object persistence behavior: Context7 `/automattic/mongoose`. Use this to confirm how `Schema.Types.Mixed` and omitted nested fields behave so the batch payload remains backward compatible without a Mongo migration.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the payload-builder and lifecycle tests that exercise the real synthetic-turn persistence path.
- Mermaid sequence or flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the single-result and batch-result transcript lifecycle diagrams so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] In `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, `server/src/mongo/turn.ts`, and `server/src/mongo/repo.ts`, read the current synthetic-turn persistence path together with story section `## Message Contracts And Storage Shapes`. Keep these contract rules visible while you work: single results stay backward compatible on `sourceId`; batch results use one payload for the whole `target: "all"` run; each batch entry must carry resolved repository identity, canonical path, normalized outcome, and failure text when failed. Also keep the task docs open while doing this step: Mongoose docs via Context7 `/automattic/mongoose`, Node test docs at https://nodejs.org/api/test.html, and Mermaid docs via Context7 `/mermaid-js/mermaid`.
2. [x] Extend the single payload in `server/src/chat/reingestToolResult.ts` to include the exact fields defined by the story:
   - `targetMode`
   - `requestedSelector`
   - `resolvedRepositoryId`
   - `outcome`
   - existing `status` and `completionMode`
   - keep `sourceId` as the canonical resolved container path for backward compatibility.
3. [x] Add the new `reingest_step_batch_result` payload variant in the same area with the ordered `repositories` array and `summary` object from `## Message Contracts And Storage Shapes`. The batch payload must represent one `target: "all"` action, not one payload per repository.
4. [x] Update `server/src/chat/reingestStepLifecycle.ts` so one `target: "all"` run records one batch payload instead of one synthetic turn pair per repository. Reuse the existing synthetic-turn lifecycle and `Turn.toolCalls` persistence path rather than creating a second batch-only persistence channel.
5. [x] Keep backward compatibility for older stored single payloads by making the payload reader tolerant of both the old and new single-result shapes. In `server/src/mongo/turn.ts`, remember that `toolCalls` stays `Schema.Types.Mixed`, so the read path must tolerate omitted optional nested fields rather than depending on empty-object persistence.
6. [x] In `server/src/chat/reingestStepLifecycle.ts`, update the synthetic-turn helpers that currently assume one `sourceId` and one terminal status (`getReingestPayload`, `buildUserTurnContent`, and `buildAssistantTurnContent`, or their replacements) so batch payloads produce one human-readable batch transcript pair instead of pretending to be a single-repository result.
7. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a single-result payload and asserts the new single payload fields are present. Purpose: prove the happy-path transcript contract now exposes the added single-result fields.
8. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a selector-driven single-result payload and asserts `targetMode`, `requestedSelector`, and `resolvedRepositoryId` are preserved. Purpose: prove explicit-selector transcript metadata survives serialization.
9. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a `target: "current"` single-result payload and asserts `targetMode`, `requestedSelector`, and `resolvedRepositoryId` are preserved. Purpose: prove current-target transcript metadata survives serialization.
10. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a batch payload and asserts repository ordering is preserved. Purpose: prove the batch transcript keeps deterministic repository order.
11. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a batch payload and asserts each repository entry preserves the resolved repository identity and canonical container path fields. Purpose: prove the batch transcript carries the per-repository identity data required by the story contract.
12. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a mixed-outcome batch payload and asserts the `summary` counts for `reingested`, `skipped`, and `failed`. Purpose: prove the batch summary can be trusted by UI and logs without recomputation.
13. [x] Add a server unit test in `server/src/test/unit/reingest-tool-result.test.ts` that builds a batch payload containing a failed repository and asserts the repository-level error text is preserved. Purpose: prove failure detail is not dropped from batch transcript entries.
14. [x] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that persists an empty `target: "all"` run and asserts one batch payload is still stored with an empty repository list. Purpose: prove the empty-batch corner case still leaves an explicit transcript record.
15. [x] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that persists an empty `target: "all"` run and asserts the batch `summary` object is still present with zeroed counts. Purpose: prove empty-batch payloads remain structurally complete instead of omitting summary data.
16. [x] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that exercises a batch run and asserts lifecycle persistence still uses `Turn.toolCalls`. Purpose: prove the new batch mode reuses the existing persistence path instead of creating a second channel.
17. [x] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that exercises batch synthetic-turn content and asserts the user/assistant turn text summarizes the batch instead of naming a single `sourceId`. Purpose: prove the lifecycle no longer treats `target: "all"` as a disguised single-repository result.
18. [x] Add a server unit test in `server/src/test/unit/reingest-step-lifecycle.test.ts` that reads an older single-result payload and asserts it still parses correctly. Purpose: prove backward compatibility for already-stored transcript data.
19. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the single-result and batch-result transcript lifecycle, including the one-payload `target: "all"` rule, the synthetic-turn content path, and the reused `Turn.toolCalls` persistence path. Purpose: document the new transcript contract and persistence architecture at the point where it changes.
20. [x] Add or update the structured manual-validation log marker `DEV-0000050:T04:reingest_payload_persisted` in the transcript lifecycle code. Include `payloadKind`, `targetMode`, `repositoryCount`, and `conversationId`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove the persisted payload shape matches the story contract.
21. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
22. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
23. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Traced the current re-ingest payload builder, synthetic-turn lifecycle, and `Turn.toolCalls` mixed persistence path, and re-checked the task docs so Task 4 stays on the existing storage channel while adding one batch payload for `target: "all"` and additive single-result fields.
- Extended the single transcript payload with `targetMode`, `requestedSelector`, `resolvedRepositoryId`, normalized `outcome`, and `completionMode` while keeping `sourceId` as the canonical resolved path for backward compatibility.
- Added the `reingest_step_batch_result` payload variant with ordered repositories and a `summary` object so one `target: "all"` run can persist one structured batch payload instead of fabricating one transcript payload per repository.
- Updated the synthetic-turn lifecycle so both single and batch tool results persist through the existing `Turn.toolCalls` path, and added the Task 4 payload-persisted log marker with payload kind, target mode, repository count, and conversation id.
- Made the lifecycle payload reader tolerant of older stored single-result shapes by normalizing omitted optional fields from the mixed `toolCalls` container instead of depending on every new nested field being present.
- Updated the synthetic user and assistant turn content helpers so batch re-ingest persistence now summarizes the whole `target: "all"` run instead of pretending it was one single-repository result.
- Added payload-builder coverage for the extended single-result metadata, current-target metadata, ordered batch repositories, batch summary counts, and preserved repository-level failure text so the transcript contract is pinned down before persistence consumers use it.
- Added lifecycle coverage for empty-batch persistence, zeroed batch summaries, continued use of `Turn.toolCalls`, batch-oriented synthetic turn text, and older single-result payload parsing, then reran the targeted wrapper until the payload and lifecycle suite was green.
- Updated `design.md` with the Task 4 single-versus-batch transcript lifecycle, including the one-payload batch rule, synthetic turn path, mixed-payload reader normalization, and the reused `Turn.toolCalls` persistence channel.
- Added the `DEV-0000050:T04:reingest_payload_persisted` marker in the lifecycle code so later manual validation can prove which payload kind and target mode were persisted for a conversation.
- Recorded the Task 16 follow-up doc delta explicitly: Task 4 updates only `design.md`, while the shared README and developer-reference close-out remains deferred until the later runtime, Docker, and proof tasks finalize the story-wide user contract.
- Ran `npm run lint`, then `npm run lint:fix`, then `npm run lint` again exactly as required; repo-wide baseline warnings still remain in unrelated client and older server test files, but a targeted `npx eslint` pass confirmed every Task 4 file is clean.
- Ran `npm run format:check`, then `npm run format`, then `npm run format:check` again; repo-wide Prettier still stops on the pre-existing intentionally invalid fixture `server/src/test/fixtures/flows/invalid-json.json`, and a targeted `npx prettier --check` pass confirmed the Task 4 files and plan/docs touched here are formatted correctly.
- `npm run build:summary:server` passed cleanly with `warning_count: 0` and `agent_action: skip_log`, so the transcript builder and lifecycle changes compile in the full server workspace before Task 4 close-out.
- `npm run test:summary:server:unit` passed cleanly with `tests run: 1333`, `passed: 1333`, `failed: 0`, and `agent_action: skip_log`; the saved wrapper log is `test-results/server-unit-tests-2026-03-21T05-47-55-319Z.log`.
- `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, `failed: 0`, and `agent_action: skip_log`; the saved wrapper log is `test-results/server-cucumber-tests-2026-03-21T05-57-47-162Z.log`.

---

### Task 5. Skip blank markdown instructions without weakening real markdown failures

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `665bcc9c`

#### Overview

Implement the shared blank-markdown skip behavior for commands and flows while preserving all existing hard failures for missing files, path traversal, permission errors, and invalid UTF-8. This task is complete when whitespace-only markdown is skipped with the documented info-level log contract and all other markdown errors remain failures.

#### Documentation Locations

- Node.js filesystem and text decoding APIs: https://nodejs.org/api/fs.html and https://nodejs.org/api/util.html. Use these to keep the empty-markdown skip limited to successful reads while preserving current file-error handling.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the unit and integration tests that prove skip-versus-fail behavior.
- Mermaid flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the blank-markdown resolution and skip flow so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] In `server/src/flows/markdownFileResolver.ts`, `server/src/agents/commandItemExecutor.ts`, and `server/src/flows/service.ts`, trace the current markdown resolution path together with story sections `## Message Contracts And Storage Shapes` and `## Edge Cases and Failure Modes`. The skip must happen once in the shared seam, not as duplicate checks in each runner.
2. [x] Add the whitespace-only skip behavior only for successfully resolved markdown content. Implement it in the shared resolver or shared execution seam so both direct commands and flows inherit the same behavior automatically.
3. [x] Emit the documented info-level log contract from that shared seam with these exact keys from the story:
   - `surface`
   - `markdownFile`
   - `resolvedPath`
   - `reason: "empty_markdown"`
   - plus any available command or flow context already present at the call site.
4. [x] Ensure the skip only applies to successful empty-content reads. Missing files, absolute paths, traversal attempts, permission failures, invalid UTF-8, and other existing resolver errors in `server/src/flows/markdownFileResolver.ts` must still fail exactly as they do today.
5. [x] Add a server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that exercises a direct command whose resolved markdown file contains only whitespace. Purpose: prove the happy-path skip behavior works for direct command execution.
6. [x] Add a server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that exercises a flow step whose resolved markdown file contains only whitespace. Purpose: prove the same skip behavior works for flow execution through the shared seam.
7. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that covers a newline-only markdown file. Purpose: prove the skip logic trims line-break-only content correctly.
8. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that covers a space-only markdown file. Purpose: prove the skip logic trims plain-space content correctly.
9. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that asserts the emitted info log includes `surface`, `markdownFile`, `resolvedPath`, and `reason: "empty_markdown"`. Purpose: prove the documented log contract is emitted exactly where operators need it.
10. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises a missing markdown file. Purpose: prove missing-file failures remain hard failures rather than skip cases.
11. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises a traversal attempt. Purpose: prove traversal protection remains a hard failure rather than a skip case.
12. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises a permission-denied read failure. Purpose: prove file permission failures still throw exactly as before.
13. [x] Add a server unit test in `server/src/test/unit/markdown-file-resolver.test.ts` that exercises an invalid-UTF-8 decode failure. Purpose: prove decoding failures still throw exactly as before.
14. [x] Add a server integration test in `server/src/test/integration/commands.markdown-file.test.ts` that verifies no synthetic tool-result payload is created when a markdown-backed step is skipped for empty content. Purpose: prove the skip does not fabricate transcript output.
15. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the blank-markdown resolution path, the skip decision point, and the preserved hard-failure paths for missing, traversal, permission, and decoding errors. Purpose: document the shared command/flow execution behavior where the skip contract changes.
16. [x] Add or update the structured manual-validation log marker `DEV-0000050:T05:markdown_step_skipped` in the shared markdown resolution or execution seam. Include `surface`, `markdownFile`, `resolvedPath`, and `reason: "empty_markdown"`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove empty markdown is skipped for the documented reason instead of silently ignored.
17. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
18. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
19. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Traced the markdown-backed command and flow execution paths through the shared resolver metadata seam before editing; the main nuance is that top-level flow markdown and direct-command markdown converge at different call sites, so the skip signal needs to be shared without duplicating trim checks.
- Added `prepareMarkdownInstruction(...)` in the markdown resolver so successful reads now branch once into `instruction` vs `skip`; direct commands, top-level flows, and nested flow commands all consume that shared result without changing hard-failure behavior.
- Added the Task 5 skip marker `DEV-0000050:T05:markdown_step_skipped` with the documented keys plus available command/flow context, and short-circuited empty markdown before any agent execution or transcript/tool-call persistence.
- Added the Task 5 integration and unit coverage for whitespace-only skips, preserved missing/traversal/permission/UTF-8 failures, and the no-toolCalls regression guard; the remaining work is lint/format plus wrapper validation.
- Recorded the Task 5 design delta in `design.md`; broader shared-doc updates stay deferred to Task 16.
- `npm run lint` still hits the known repo-wide `SharedTranscript.tsx` warning after `lint:fix`, but I restored the unrelated auto-fix spillover and rechecked the Task 5 server files with targeted `npx eslint`, which passed cleanly.
- `npm run format:check` still fails on the repo-wide baseline set and the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json` fixture even after `npm run format`; I reversed the unrelated formatting spillover and confirmed the Task 5 files with targeted `npx prettier --check`, which passed cleanly.
- `npm run build:summary:server` passed cleanly with `warning_count: 0`, so no build-log inspection was needed before moving to the wrapper test suites.
- The first `npm run test:summary:server:unit` run caught one Task 5 regression: the new flow skip integration fixture was missing the required `identifier`, so it failed with `FLOW_INVALID`; after fixing the fixture, the full wrapper rerun passed with `tests run: 1343`, `passed: 1343`, and `failed: 0`.
- `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, so Task 5 validation is complete and the story can move on to Task 6.

---

### Task 6. Finalize runtime MCP placeholder normalization

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **2803fd5f**

#### Overview

Finish the shared runtime placeholder normalization layer before any checked-in config files are migrated. This task is complete when unresolved placeholders fail clearly, all runtime consumers use one shared MCP endpoint contract, and stale hard-coded bypass paths have been removed from the runtime code. A junior developer should treat each subtask below as standalone and keep the full endpoint contract visible while working.

#### Documentation Locations

- TOML syntax basics: https://toml.io/en/v1.1.0. Use this to confirm how literal placeholder strings are represented in checked-in TOML without relying on nonexistent native env interpolation.
- TypeScript config-object shaping: https://www.typescriptlang.org/docs/. Use this to keep the normalized config object strongly typed across the runtime entrypoints.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the server tests that prove placeholder normalization, unresolved-placeholder failure, and endpoint separation.
- Mermaid flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the shared MCP placeholder-normalization and endpoint-resolution flow so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] In `server/src/config/runtimeConfig.ts`, `server/src/config/codexConfig.ts`, `server/src/config.ts`, `server/src/config/startupEnv.ts`, `server/src/providers/mcpStatus.ts`, `server/src/index.ts`, `server/src/mcp2/server.ts`, and `server/src/mcpAgents/server.ts`, trace every place that currently resolves or consumes MCP endpoints. Keep these exact contracts visible while you work: `${CODEINFO_SERVER_PORT}` = classic `/mcp`; `${CODEINFO_CHAT_MCP_PORT}` = chat MCP; `${CODEINFO_AGENTS_MCP_PORT}` = agents MCP; `CODEINFO_PLAYWRIGHT_MCP_URL` = full URL override; the chat/base and agents MCP endpoints must stay intentionally separate. Also keep the task docs open while doing this step: TOML docs at https://toml.io/en/v1.1.0, TypeScript docs at https://www.typescriptlang.org/docs/, Node test docs at https://nodejs.org/api/test.html, and Mermaid docs via Context7 `/mermaid-js/mermaid`.
2. [x] Update the shared runtime normalization path so unresolved required MCP placeholders fail clearly instead of passing raw placeholder text through to the effective config. The required placeholders to keep in view are:
   - `${CODEINFO_SERVER_PORT}`
   - `${CODEINFO_CHAT_MCP_PORT}`
   - `${CODEINFO_AGENTS_MCP_PORT}`
   - `CODEINFO_PLAYWRIGHT_MCP_URL`
3. [x] Make one shared endpoint contract feed base-config seeding, chat runtime loading, agent runtime loading, provider status probes, startup endpoint reporting, and the dedicated MCP bind surfaces. Keep the intentional split between chat/base MCP and agents MCP intact; do not collapse them into one URL.
4. [x] Remove any stale runtime-code bypasses that still hard-code MCP URLs or legacy env fallbacks outside the shared normalization path, especially in startup reporting and provider status code. This includes replacing the generic `MCP_URL` / `http://localhost:${port}/mcp` fallback in `server/src/providers/mcpStatus.ts` with the same normalized chat/base MCP endpoint contract used by the rest of the runtime.
5. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `${CODEINFO_SERVER_PORT}`. Purpose: prove server-port placeholders normalize through the shared runtime path.
6. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `${CODEINFO_CHAT_MCP_PORT}`. Purpose: prove the chat MCP placeholder normalizes through the shared runtime path.
7. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `${CODEINFO_AGENTS_MCP_PORT}`. Purpose: prove the agents MCP placeholder normalizes through the shared runtime path.
8. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that resolves a checked-in config using `CODEINFO_PLAYWRIGHT_MCP_URL`. Purpose: prove the Playwright full-URL override normalizes through the same shared contract.
9. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that sets both a port-derived MCP placeholder input and `CODEINFO_PLAYWRIGHT_MCP_URL`, then asserts the full Playwright URL override wins. Purpose: prove the override-precedence contract is explicit instead of depending on replacement order.
10. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that leaves a required placeholder unresolved and asserts a clear failure. Purpose: prove raw placeholder text cannot leak into the effective runtime config.
11. [x] Add a server unit test in `server/src/test/unit/codexConfig.test.ts` that loads distinct chat/base and agents MCP values and asserts they remain different. Purpose: prove the intentional endpoint split is preserved by normalization.
12. [x] Add a server unit test in `server/src/test/unit/chatProviders.test.ts` that keeps browser navigation URLs and MCP control-channel URLs different. Purpose: prove normalization does not collapse unrelated browser and MCP contracts into one value.
13. [x] Create `server/src/test/unit/mcpStatus.test.ts` and add a server unit test there that verifies provider-status probing uses the shared normalized chat/base MCP endpoint instead of the legacy generic fallback path. Purpose: prove `mcpStatus.ts` no longer bypasses the shared endpoint contract.
14. [x] In `server/src/test/unit/mcpStatus.test.ts`, add a server unit test that verifies the status probe fails clearly when the normalized MCP endpoint is unresolved or unreachable. Purpose: prove provider status reporting does not silently fall back to a hidden localhost assumption.
15. [x] Add a server unit test in `server/src/test/unit/chatModels.codex.test.ts` that exercises provider/runtime entrypoints or status probes after the refactor and asserts they use the shared endpoint contract instead of stale hard-coded MCP URLs or legacy env fallbacks. Purpose: prove bypass paths have been removed.
16. [x] If this task creates `server/src/test/unit/mcpStatus.test.ts` or any shared normalization helper file, update `projectStructure.md` after those files are in place. Document the new file path and its role in the runtime endpoint contract so the repository structure doc reflects the added normalization coverage.
17. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the shared MCP placeholder-normalization flow, including placeholder resolution, unresolved-placeholder failure, the provider-status probe path, the intentional split between chat/base and agents MCP endpoints, and the precedence of the full Playwright override over derived localhost placeholder URLs. Purpose: document the runtime-config architecture where the contract is introduced.
18. [x] Add or update the structured manual-validation log marker `DEV-0000050:T06:mcp_endpoints_normalized` in the shared runtime normalization path. Include `classicMcpUrl`, `chatMcpUrl`, `agentsMcpUrl`, `playwrightMcpUrl`, and `placeholderFree`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove the effective runtime endpoints are fully normalized and placeholder-free.
19. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
20. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
21. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Traced the Task 6 runtime endpoint consumers before editing; the main gaps are that placeholder replacement lives in `runtimeConfig.ts` without a single exported endpoint contract, `mcpStatus.ts` still bypasses that path via `MCP_URL`, and startup reporting still assembles classic MCP URLs separately.
- Added `server/src/config/mcpEndpoints.ts` as the shared MCP endpoint contract so runtime placeholder replacement, Codex config seeding, startup reporting, and dedicated MCP listener ports all resolve the same classic/chat/agents/Playwright values.
- Removed the old provider-status bypass by switching `server/src/providers/mcpStatus.ts` to the shared contract and added focused regression coverage in the new `server/src/test/unit/mcpStatus.test.ts`.
- Added the Task 6 runtime regressions across `runtimeConfig.test.ts`, `codexConfig.test.ts`, `chatProviders.test.ts`, and `chatModels.codex.test.ts`, including unresolved-placeholder failure and Playwright-override precedence.
- Updated `design.md` and `projectStructure.md` for the new normalization seam and its proof path, and recorded the Task 16 doc follow-up as a later shared-doc delta only.
- `npm run lint` still fails on the pre-existing `client/src/components/chat/SharedTranscript.tsx` warning after `npm run lint:fix`; Task 6 files are clean via targeted `npx eslint`.
- `npm run format:check` still fails repo-wide on the baseline formatting set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those spillover edits were restored and the Task 6 files passed targeted `npx prettier --check`.
- `npm run build:summary:server` initially failed because the seeded TOML template in `codexConfig.ts` treated `${CODEINFO_SERVER_PORT}` as a JavaScript interpolation; escaping that placeholder fixed the build, and the rerun passed with `warning_count: 0`.
- `npm run test:summary:server:unit` passed cleanly after the Task 6 contract refactor with `tests run: 1355`, `passed: 1355`, and `failed: 0`, so the new runtime-config, status-probe, and provider-surface coverage is live.
- `npm run test:summary:server:cucumber` also passed cleanly with `tests run: 71`, `passed: 71`, and `failed: 0`, so Task 6 finished on the required wrapper-first validation path.

---

### Task 7. Migrate checked-in MCP config and env contracts

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **5a53b06a**

#### Overview

Move the checked-in runtime config files and env files onto the final MCP placeholder and env-variable contract defined by Task 6. This task is complete when checked-in configs use explicit placeholders, checked-in env files use `CODEINFO_CHAT_MCP_PORT` instead of `CODEINFO_MCP_PORT`, and the repo’s checked-in defaults no longer encode bridge-era MCP URLs.

#### Documentation Locations

- TOML format and field syntax: https://toml.io/en/v1.1.0. Use this when rewriting checked-in config files so placeholder tokens remain valid TOML strings and tables.
- TypeScript config-object shaping: https://www.typescriptlang.org/docs/. Use this to keep the config-reader expectations aligned with the migrated checked-in file shapes.
- Node.js test runner: https://nodejs.org/api/test.html. Use this for the normalization tests that prove the migrated checked-in files still parse and resolve correctly.

#### Subtasks

1. [x] Read the checked-in runtime config files and env files that still carry legacy MCP URLs, legacy env names, or bridge-era assumptions. Use story sections `## Message Contracts And Storage Shapes`, `## Edge Cases and Failure Modes`, and `## Final Validation` while you read these exact files:
   - `codex/config.toml`
   - `codex/chat/config.toml`
   - `codex_agents/*/config.toml`
   - `config.toml.example`
   - `server/.env`
   - `server/.env.local`
   - `server/.env.e2e`
   - `.env.e2e`
2. [x] Update the checked-in runtime config files to use the explicit placeholder strategy defined in the story for these exact contracts:
   - `CODEINFO_SERVER_PORT`
   - `CODEINFO_CHAT_MCP_PORT`
   - `CODEINFO_AGENTS_MCP_PORT`
   - `CODEINFO_PLAYWRIGHT_MCP_URL`
   - remove hard-coded MCP URLs such as `http://localhost:5010/mcp`, `http://localhost:5011/mcp`, or bridge-era `playwright-mcp` hostnames where the story says placeholders should be used instead.
3. [x] Update the checked-in env files so they match the final placeholder and port contract and remove checked-in reliance on `CODEINFO_MCP_PORT`. Keep the wrapper-consumed root `.env.e2e` file aligned with the server-owned env defaults so the existing e2e wrapper and compose scripts read the same contract the code expects. After this task, the checked-in dedicated MCP env name must be `CODEINFO_CHAT_MCP_PORT`.
4. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that loads the checked-in file style with the new placeholder tokens and asserts successful normalization. Purpose: prove the migrated checked-in config format remains runnable.
5. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that sets `CODEINFO_CHAT_MCP_PORT` and asserts the checked-in chat MCP placeholders resolve from that value. Purpose: prove the new env contract is wired correctly.
6. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that loads the checked-in root `.env.e2e` file shape and asserts the e2e wrapper's MCP placeholders resolve from the actual repo-root env file it uses. Purpose: prove the story updates the real e2e env entrypoint instead of only the server-local copy.
7. [x] Add a server unit test in `server/src/test/unit/runtimeConfig.test.ts` that sets only legacy `CODEINFO_MCP_PORT` and asserts chat MCP placeholder normalization fails or remains unsatisfied. Purpose: prove the legacy env name no longer satisfies the checked-in contract.
8. [x] Add a server unit test in `server/src/test/unit/codexConfig.test.ts` that loads the migrated checked-in config files and asserts no bridge-era `playwright-mcp` hostname or hard-coded localhost MCP URL dependency remains where placeholders are now required. Purpose: prove the checked-in config migration is complete.
9. [x] Add or update the structured manual-validation log marker `DEV-0000050:T07:checked_in_mcp_contract_loaded` in the checked-in config or env bootstrap path. Include `configPath`, `chatPortVar`, `agentsPortVar`, `playwrightUrlVar`, and `legacyFallbackUsed`. Purpose: later Manual Playwright-MCP validation checks this exact log line to prove the checked-in contract is loaded from the final env names and no legacy fallback remains active.
10. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
11. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
12. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Audited the exact Task 7 file set and confirmed the current checked-in split: `codex/chat/config.toml`, `config.toml.example`, and `codex_agents/lmstudio_agent/config.toml` still point at classic `5010`, while the coding/planning/research/tasking agent configs still point at dedicated `5011` and some still hard-code `playwright-mcp:8931`.
- Migrated the checked-in runtime configs onto explicit placeholders: classic `5010` entries now use `${CODEINFO_SERVER_PORT}`, dedicated `5011` entries now use `${CODEINFO_CHAT_MCP_PORT}`, and the checked-in Playwright entries now use the direct `CODEINFO_PLAYWRIGHT_MCP_URL` token instead of the bridge-era `playwright-mcp` hostname.
- Updated the checked-in env files to the final Task 7 contract by replacing `CODEINFO_MCP_PORT` with `CODEINFO_CHAT_MCP_PORT` in `server/.env` and by adding the MCP port inventory to `.env.e2e` so the wrapper-owned e2e env file now carries the same endpoint contract as the server-owned files.
- Removed the legacy `CODEINFO_MCP_PORT` fallback from runtime normalization and startup env inventory so checked-in placeholder resolution now depends on `CODEINFO_CHAT_MCP_PORT` explicitly.
- Added Task 7 regression coverage for checked-in file normalization, repo-root `.env.e2e` loading, legacy-env failure, checked-in config migration, and the new `DEV-0000050:T07:checked_in_mcp_contract_loaded` marker.
- `npm run lint` still fails repo-wide on the pre-existing `client/src/components/chat/SharedTranscript.tsx` warning after `npm run lint:fix`; the Task 7 TypeScript files are clean via targeted `npx eslint`.
- `npm run format:check` still fails repo-wide on the baseline formatting set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those spillover edits were restored, supported Task 7 files passed targeted `npx prettier --check`, and this repo’s Prettier setup still does not expose a `toml` parser for direct `.toml` checks.
- `npm run build:summary:server` passed cleanly with `warning_count: 0`, so the Task 7 migration compiles against the server workspace before the runtime tests run.
- The first full unit wrapper still failed because the summary wrappers were spawning their own env maps without `CODEINFO_PLAYWRIGHT_MCP_URL`; wiring that env into `scripts/test-summary-server-unit.mjs` and `scripts/test-summary-server-cucumber.mjs`, then tightening the legacy-env regression test to prove `CODEINFO_MCP_PORT` is ignored instead of reused, brought the full rerun to `1361` passed and `0` failed in `test-results/server-unit-tests-2026-03-21T08-14-10-031Z.log`.
- `npm run test:summary:server:cucumber` also passed cleanly at `71` passed and `0` failed in `test-results/server-cucumber-tests-2026-03-21T08-24-17-674Z.log`, so the checked-in MCP contract migration now clears both wrapper-first server validation gates.

---

### Task 8. Add a repo-local shell harness

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **32dfcf26**

#### Overview

Create the reusable repo-local shell harness that later wrapper and compose tasks will use for shell-level proofs. This task is complete when `npm run test:summary:shell` works from a clean checkout without a globally installed Bats runtime, discovers every checked-in `.bats` suite under `scripts/test/bats/` by default, supports targeted `--file` runs for later tasks, and includes at least one passing and one intentionally failing harness case.

#### Documentation Locations

- bats-core documentation: https://bats-core.readthedocs.io/en/stable/. Use this for the correct `.bats` file structure, helper loading, and vendored-runtime expectations.
- Node.js child process and stream handling: https://nodejs.org/api/child_process.html and https://nodejs.org/api/stream.html. Use these for the wrapper that runs the shell harness and captures saved-log output cleanly.

#### Subtasks

1. [x] Read `scripts/summary-wrapper-protocol.mjs`, `scripts/summary-wrapper-protocol-fixture.mjs`, and `package.json` together with story section `## Test Harnesses`. This harness must follow the same saved-log and heartbeat contract as the other repo wrappers.
2. [x] Add the repo-local shell harness files under `scripts/test/bats/` with this minimum shape so another developer can find everything in one place:
   - `.bats` test file;
   - shared helper file;
   - fixture binaries.
3. [x] Check in the Bats runtime and helper libraries under `scripts/test/bats/vendor/` so the harness is runnable from a clean checkout with no global Bats installation.
4. [x] Add `scripts/test-summary-shell.mjs` and the root `package.json` script entry `npm run test:summary:shell` so the shell harness uses the same summary-wrapper protocol fields as the other wrappers: saved log path, heartbeat output, and final guidance.
5. [x] Implement `scripts/test-summary-shell.mjs` so it discovers every checked-in `.bats` file under `scripts/test/bats/` by default and supports one or more `--file <path>` selectors for targeted later-task runs. The wrapper must fail clearly when a requested `.bats` file does not exist and must record which shell suites were executed in the saved log so Task 9 and later tasks can prove their own files ran.
6. [x] Create `scripts/test/bats/shell-harness.bats` and add a shell test there that exercises a passing harness fixture. Purpose: prove the vendored Bats harness can execute a normal success case from a clean checkout.
7. [x] In `scripts/test/bats/shell-harness.bats`, add a shell test that exercises an intentionally failing fixture and asserts the failure is expected. Purpose: prove the harness can report controlled failures without treating them as accidental crashes.
8. [x] Update `projectStructure.md` after all new shell-harness files are added in this task. Document `scripts/test-summary-shell.mjs`, the `scripts/test/bats/` tree, and the vendored Bats runtime paths so the repository structure doc reflects the new shell-test harness entry points.
9. [x] Add or update the structured wrapper log marker `DEV-0000050:T08:shell_harness_ready` in `scripts/test-summary-shell.mjs`. Include `suiteCount`, `vendorMode`, and `targetedRunSupported`. Purpose: later Manual Playwright-MCP validation checks this exact wrapper log line in the saved shell-harness output to prove the checked-in shell harness exists and is ready to run scoped suites.
10. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
11. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
12. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Confirmed Task 8 will extend the existing summary-wrapper contract rather than inventing a separate shell runner, and used the Bats docs to keep the vendored runtime, helper loading, and targeted file execution aligned with a clean-checkout workflow.
- Added the checked-in shell harness under `scripts/test/bats/`, vendored `bats-core` plus `bats-support` and `bats-assert`, and exposed it through `npm run test:summary:shell` so a clean checkout can run shell proofs without a global Bats install.
- Implemented default `.bats` discovery, targeted `--file` support, suite logging, and the `DEV-0000050:T08:shell_harness_ready` marker in `scripts/test-summary-shell.mjs`, then proved both default and targeted wrapper runs against `scripts/test/bats/shell-harness.bats`.
- Added one passing and one expected-failure fixture-backed shell test in `scripts/test/bats/shell-harness.bats`, plus the shared helper and fixture-bin layout that Task 9 can extend for Docker-wrapper preflight simulation.
- Updated `projectStructure.md` immediately after the new wrapper, harness tree, fixture binaries, and vendored runtime directories were in place so Task 8 leaves the repository structure doc pointing at the new shell-proof entry points.
- `npm run lint` still fails repo-wide on the existing non-Task-8 warning set after `npm run lint:fix`, but the Task 8 files were kept clean and the harness-specific files were validated with `npx prettier --check`, `bash -n`, and live `npm run test:summary:shell` runs.
- `npm run format:check` still fails repo-wide on the known baseline set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those spillover edits were restored so only the Task 8 files remain changed.
- `npm run build:summary:server` passed cleanly with `warning_count: 0`, so the new shell wrapper and vendored harness tree do not break the server workspace build path.
- `npm run test:summary:server:unit` passed cleanly at `1361` passed and `0` failed in `test-results/server-unit-tests-2026-03-21T08-36-05-794Z.log`, so the new shell harness files and wrapper entrypoint do not regress the full server unit/integration suite.
- `npm run test:summary:server:cucumber` also passed cleanly at `71` passed and `0` failed in `test-results/server-cucumber-tests-2026-03-21T08-46-20-600Z.log`, so the Task 8 shell-harness additions clear the full wrapper-first server validation loop.

---

### Task 9. Add host-network wrapper preflight

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **2786cceb**

#### Overview

Extend the checked-in compose wrapper so it fails fast when the checked-in host-network requirements are missing or incompatible. This task is complete when the wrapper catches unsupported host networking, incompatible service shapes, and occupied checked-in ports before `docker compose` starts, and those behaviors are covered by the shell harness from Task 8.

#### Documentation Locations

- Docker host networking behavior: DeepWiki `docker/docs` plus https://docs.docker.com/engine/network/tutorials/host/. Use these to confirm the host-network prerequisites and the direct-host-port rules the wrapper must enforce before startup.
- Docker Compose service rules: Context7 `/docker/compose`. Use this to confirm that host-networked services cannot keep incompatible `ports` or `networks` configuration.
- Bash manual: https://www.gnu.org/software/bash/manual/bash.html. Use this for portable shell control flow in `docker-compose-with-env.sh`.

#### Subtasks

1. [x] Read `scripts/docker-compose-with-env.sh` and the new harness files under `scripts/test/bats/` together with story sections `## Proof Path Readiness` and `## Edge Cases and Failure Modes`. This task must extend the checked-in wrapper, not add a second compose launcher.
2. [x] Extend `scripts/docker-compose-with-env.sh` so it fails before `docker compose` for these exact prerequisite failures from the story:
   - unsupported host-network environments;
   - Docker Desktop environments where host networking is unavailable or incompatible for the checked-in compose path;
   - disabled host networking where it is required;
   - occupied checked-in host ports;
   - host-networked service definitions that still contain incompatible `ports` or `networks` wiring;
   - and every failure path names the affected compose file or service plus the missing or incompatible prerequisite.
3. [x] Extend the shell-harness helper files or fixture binaries under `scripts/test/bats/` so the preflight tests can simulate unsupported host networking, occupied host ports, incompatible Compose service shapes, compose pass-through, and compose files without `playwright-mcp` without depending on the developer's real Docker host state. Keep these simulations deterministic so Task 9 remains runnable on a normal workstation and inside CI.
4. [x] Create `scripts/test/bats/docker-compose-with-env.bats` and add a shell test there that exercises the unsupported host-network environment path. Purpose: prove preflight fails before compose startup when host networking is not supported.
5. [x] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises a conflicting checked-in host port. Purpose: prove preflight blocks startup when a required host-visible port is already occupied.
6. [x] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises a host-networked service definition still carrying incompatible `ports` or `networks`. Purpose: prove invalid compose shapes are rejected before `docker compose` runs.
7. [x] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises the success-path pass-through to compose execution. Purpose: prove the wrapper still hands control to compose when all preflight conditions are satisfied.
8. [x] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that exercises a compose file without `playwright-mcp`. Purpose: prove preflight does not force new Playwright services into files that are out of scope for this story.
9. [x] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that asserts failure output names the affected compose file or service. Purpose: prove operators receive actionable preflight errors instead of a generic shell failure.
10. [x] In `scripts/test/bats/docker-compose-with-env.bats`, add a shell test that proves the local host-network manual-testing contract still declares Chrome DevTools on `9222`. Purpose: keep the checked-in local CDP validation rule under automated shell-harness coverage.
11. [x] Update `projectStructure.md` after `scripts/test/bats/docker-compose-with-env.bats` is added. Document the new shell-test file path and its relationship to `scripts/docker-compose-with-env.sh` so the repository structure doc shows where host-network preflight coverage lives.
12. [x] Add or update the structured wrapper log marker `DEV-0000050:T09:compose_preflight_result` in `scripts/docker-compose-with-env.sh`. Include `composeFile`, `result`, `playwrightServicePresent`, and `checkedPorts`, and make sure both pass and fail outcomes are logged with the same marker. Purpose: later Manual Playwright-MCP validation checks this exact line to prove the host-network preflight ran and produced an explicit result.
13. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
14. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
15. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.

#### Implementation notes

- Re-read the checked-in compose wrapper, the vendored Bats harness from Task 8, and the Docker host-network docs before editing so Task 9 extends the existing launcher and enforces the real host-network prerequisites instead of inventing a second path.
- Confirmed Task 9 will stay inside `scripts/docker-compose-with-env.sh` and the Task 8 Bats harness, and pulled the Docker Compose host-network rules up front so the preflight can reject `ports`/`networks` on host-networked services instead of guessing later.
- Extended `scripts/docker-compose-with-env.sh` with one checked-in preflight path that parses rendered compose JSON, rejects invalid host-network service shapes, checks the story port matrix, and emits `DEV-0000050:T09:compose_preflight_result` on both pass and fail paths before any real compose startup.
- Added deterministic Task 9 shell fixtures under `scripts/test/bats/fixtures/` plus `scripts/test/bats/docker-compose-with-env.bats`, so unsupported host networking, occupied host ports, invalid host-network service shapes, compose pass-through, no-Playwright files, actionable failure output, and the local `9222` Chrome DevTools contract are all covered without depending on the host Docker state.
- Updated `projectStructure.md` as soon as the new wrapper-preflight shell suite and fake-Docker fixtures existed, so the repository structure doc now points directly at the Task 9 coverage seam and the wrapper it exercises.
- No shared-doc updates beyond the new file ledger were needed in Task 9, so any broader documentation deltas remain deferred for Task 16.
- `npm run lint` still fails repo-wide on the existing baseline warning set even after `npm run lint:fix`, but none of the Task 9 files participate in that TypeScript-only lint surface and the broad auto-fix spillover was restored before continuing.
- `npm run format:check` still fails repo-wide on the existing baseline file set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those changes were restored and the Task 9 markdown/json files plus shell scripts were revalidated with targeted `prettier --check` and `bash -n`.
- `npm run build:summary:server` passed cleanly with `warning_count: 0`, so the new host-network preflight logic and Task 9 shell fixtures did not disturb the server workspace build path.
- `npm run test:summary:server:unit` passed cleanly at `1361` passed and `0` failed in `test-results/server-unit-tests-2026-03-21T09-03-08-800Z.log`, so the Task 9 compose-wrapper preflight and fake-Docker shell fixtures clear the full server unit/integration wrapper.
- `npm run test:summary:server:cucumber` passed cleanly at `71` passed and `0` failed in `test-results/server-cucumber-tests-2026-03-21T09-03-08-807Z.log`, so the Task 9 wrapper and shell-fixture additions did not regress the checked-in cucumber proof path.

---

### Task 10. Bake runtime assets into the image-based host-network model

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **ea88ae47**

#### Overview

Update the Docker build flow so the checked-in runtime assets needed by the host-networked server are carried by the image instead of being supplied from repo bind mounts at runtime. This task is complete when the server image includes the checked-in runtime assets it needs and only the Dockerfiles or `.dockerignore` files that actually participate in that packaging path are changed.

#### Documentation Locations

- Docker build contexts and ignore files: Context7 `/docker/docs`. Use this to keep the image-baking task focused on required build inputs instead of broadening unrelated image scope.
- Dockerfile reference: Context7 `/docker/docs`. Use this for the correct copy/build layering when moving checked-in runtime assets into the image.
- Mermaid flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the image-baked runtime-asset packaging flow so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] Read `server/Dockerfile`, `.dockerignore`, `server/.dockerignore`, `client/.dockerignore`, and the checked-in compose files together with story sections `## Feasibility Proof Pass` and `## Edge Cases and Failure Modes`. Make a concrete list of which checked-in runtime assets are still bind-mounted from the repo today, especially `codex/`, `codex_agents/`, and checked-in flow directories.
2. [x] Update the Docker build contexts and only the Dockerfiles that actually need to carry checked-in runtime assets so the host-networked server can run without repo bind mounts. Extend the existing build flow instead of introducing alternate Dockerfiles or bespoke startup paths, and do not expand client-image scope unless a checked-in runtime dependency truly requires it.
3. [x] Update only the `.dockerignore` files that participate in that packaging path so the required runtime assets enter the build context without broadening unrelated image scope. The target outcome from the story is that runtime application code does not depend on a repo source-tree bind mount such as `.:/app`.
4. [x] Reuse the existing `npm run compose:build:summary` output plus the later runtime/container inspection in Tasks 11 and 14 as the proof path for image-baked assets instead of adding a bespoke new proof script in this task.
5. [x] Update `design.md` with a Mermaid diagram and supporting text that describe how checked-in runtime assets move from the repository into the image-based host-network runtime. Purpose: document the packaging architecture change that removes checked-in runtime bind mounts from the host-network model.
6. [x] Add or update the structured log marker `DEV-0000050:T10:image_runtime_assets_baked` in the Docker packaging or compose-build summary path. Include `imageName`, `runtimeAssetRoots`, and `sourceBindMountRequired`. Purpose: later Manual Playwright-MCP validation checks this exact line to prove the built image contains the required runtime assets without depending on source-tree mounts.
7. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
8. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
9. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run compose:build:summary` If status is `failed`, or item counts indicate failures or unknown states in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing targets.

#### Implementation notes

- Re-read the server Docker packaging path, the participating `.dockerignore` files, and the checked-in compose mounts together with the story feasibility and edge-case sections before editing so Task 10 stays on image-baked runtime assets rather than drifting into the later compose cutover.
- Confirmed the checked-in runtime trees still coming from repo bind mounts today are `codex/`, `codex_agents/`, `flows/`, `flows-sandbox/`, `e2e/fixtures/`, and `e2e/fixtures/repo/`, while the root `.dockerignore` already excludes only the sensitive `auth.json` files rather than the runtime trees themselves.
- Updated only `server/Dockerfile` in the packaging path so the runtime stage now bakes `codex`, `codex_agents`, `flows`, `flows-sandbox`, and the e2e fixture roots directly into the server image instead of assuming those checked-in trees arrive later through repo bind mounts.
- Kept the `.dockerignore` change narrow by documenting that Task 10 intentionally leaves the runtime trees in scope while continuing to exclude checked-in credential files such as `codex/**/auth.json` and `codex_agents/**/auth.json`.
- Reused the existing compose-build proof path by emitting `DEV-0000050:T10:image_runtime_assets_baked` from `scripts/compose-build-summary.mjs` with the baked runtime asset roots and `sourceBindMountRequired: false` instead of creating a one-off build script.
- Added a Task 10 design note and Mermaid packaging flow to `design.md`, and no broader shared-doc changes were needed yet beyond that required new design documentation.
- `npm run lint` still fails repo-wide on the existing baseline warning set even after `npm run lint:fix`, but the Task 10 files were kept isolated and the broad auto-fix spillover was restored before the task continued.
- `npm run format:check` still fails repo-wide on the existing baseline file set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those changes were restored and the Task 10 files were rechecked with targeted `prettier --check`, `node --check`, and `git diff --check`.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, and `DEV-0000050:T10:image_runtime_assets_baked {"imageName":"codeinfo2-server","runtimeAssetRoots":["/app/codex","/app/codex_agents","/app/flows","/app/flows-sandbox","/fixtures","/data"],"sourceBindMountRequired":false}`, so the image-baked runtime asset contract is now visible on the wrapper-first build proof path.

---

### Task 11. Convert Compose definitions to the final host-network runtime model

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **a0bd47f9**

#### Overview

Convert the checked-in `server` and existing `playwright-mcp` services to the final host-network model using the image-based runtime contents from Task 10. This task is complete when the main, local, and e2e Compose definitions match the story’s host-network rules, preserve the documented host-visible ports, and no longer rely on forbidden source-tree or checked-in runtime bind mounts, with those outcomes proved by checked-in code, rendered Compose inspection, and wrapper-first build coverage. The first live main-stack `compose:up` proof now belongs to Task 12 onward because the blocker proved that startup requires a host environment where the fixed main-stack ports are genuinely free. A junior developer should treat each subtask below as standalone and keep the exact port matrix and allowed-mount rules visible while working.

#### Documentation Locations

- Docker Compose service rules: Context7 `/docker/compose`. Use this to apply `network_mode: host` correctly and remove incompatible keys from the scoped services.
- Docker host networking behavior: DeepWiki `docker/docs` plus https://docs.docker.com/engine/network/tutorials/host/. Use these to keep the compose cutover aligned with the checked-in host-visible port matrix and prerequisites.
- Bash manual: https://www.gnu.org/software/bash/manual/bash.html. Use this only where shell-entrypoint behavior must remain correct for the `9222` Chrome DevTools contract.
- Mermaid deployment or flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the host-network runtime topology so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] Read `server/entrypoint.sh`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `server/src/test/support/chromaContainer.ts`, and `server/src/test/support/mongoContainer.ts` together with story sections `## Feasibility Proof Pass`, `## Edge Cases and Failure Modes`, and `## Final Validation`. Keep these exact rules visible while you work: local server binds `5510/5511/5512`, local Chrome DevTools stays on `9222`, local Playwright MCP stays on `8931`, main Playwright MCP stays on `8932`, host-networked services must not keep `ports` or `networks`, and source-tree / checked-in runtime bind mounts must not remain. Also keep the task docs open while doing this step: Docker Compose docs via Context7 `/docker/compose`, Docker host-network docs via DeepWiki `docker/docs` plus https://docs.docker.com/engine/network/tutorials/host/, Bash docs at https://www.gnu.org/software/bash/manual/bash.html, and Mermaid docs via Context7 `/mermaid-js/mermaid`.
2. [x] Before editing the compose files, run a repository search for checked-in Compose files and confirm the scoped inventory still matches the story assumptions:
   - files in scope for `server`: `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`;
   - files in scope for `playwright-mcp`: `docker-compose.yml` and `docker-compose.local.yml`;
   - no additional checked-in Compose file that defines `server` or `playwright-mcp` has appeared since the story was planned.
     If the inventory has changed, update the story plan before changing code so the implementation does not silently miss a checked-in runtime surface.
3. [x] Convert the scoped `server` and existing `playwright-mcp` services to the final host-network definitions with these exact port rules from the story:
   - direct host-visible bind ports for the server listeners;
   - preserve the local Chrome DevTools bind contract on `9222` by keeping the required server entrypoint or environment wiring intact under host networking;
   - `8931` for local Playwright MCP;
   - `8932` for main Playwright MCP;
   - remove incompatible `ports` or `networks` definitions on host-networked services;
   - remove bridge-only service-name MCP URL assumptions;
   - keep compose files that do not already define `playwright-mcp` out of scope so no new Playwright service is introduced by this task.
4. [x] Preserve the existing local Docker-socket, UID/GID, and Testcontainers-related runtime contract where it is still required for checked-in local workflows, while keeping that exception separate from the forbidden source-tree and checked-in-config bind mounts. Do not add new source-tree mounts to solve runtime issues.
5. [x] Prove the final host-networked Compose definitions no longer bind-mount application source trees or checked-in runtime asset trees into the runtime containers, and that any remaining persistence is limited to Docker-managed generated-output volumes plus the explicitly host-visible logs, with only deliberate non-source runtime mounts such as the local Docker socket remaining where required. Use the checked-in wrapper script with the `config` subcommand for this inspection instead of ad-hoc compose invocations so the same env-file and UID/GID rules are applied during validation.
6. [x] After the compose definitions are updated, inspect the rendered wrapper-driven Compose output and write down the exact services and mount types that remain. The expected end state is:
   - no bind mount for the repository root;
   - no bind mount for checked-in runtime config trees such as `codex/`, `codex_agents/`, or checked-in flow directories;
   - only Docker-managed volumes for generated output;
   - only deliberate non-source bind mounts such as logs or the local Docker socket where the story explicitly allows them.
7. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the final host-network runtime topology, the preserved host-visible port matrix, and the allowed remaining runtime mounts. Purpose: document the checked-in runtime architecture after the compose cutover lands.
8. [x] Add or update the structured runtime log marker `DEV-0000050:T11:host_network_runtime_ready` during stack startup or readiness reporting. Include `composeFile`, `serverPorts`, `playwrightPort`, and `sourceBindMountCount`. Purpose: later Manual Playwright-MCP validation checks this exact line to prove the running stack uses the expected host-network contract and has not reintroduced source/config bind mounts.
9. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
10. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
11. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run compose:build:summary` If status is `failed`, or item counts indicate failures or unknown states in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing targets.

#### Implementation notes

- Re-read the scoped Compose files, `server/entrypoint.sh`, the chroma/mongo Testcontainers helpers, and the story feasibility, edge-case, and final-validation sections together before editing so the Task 11 cutover stays anchored to the fixed host-network port matrix and the allowed-mount rules.
- Re-checked the checked-in Compose inventory with a repository search and confirmed the Task 11 scope still matches the story assumptions: `server` exists only in `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`, while `playwright-mcp` exists only in `docker-compose.yml` and `docker-compose.local.yml`.
- Converted the scoped `server` and existing `playwright-mcp` services to `network_mode: host`, removed incompatible `ports`/`networks` keys from those services, moved the main Playwright MCP port to `8932`, and rewired the local/e2e server listeners to bind their checked-in host-visible ports directly inside the container.
- Kept the allowed local runtime exceptions intact by preserving the Docker socket, UID/GID wiring, and Testcontainers-related settings in `docker-compose.local.yml` while removing the forbidden checked-in runtime-tree bind mounts from the host-networked server services.
- Proved the rendered wrapper-driven Compose output no longer includes repository-root or checked-in runtime-tree bind mounts on the scoped host-network services; the remaining server-side binds are limited to host-visible logs, the external ingest/workdir bind, the host Codex auth-copy source, the local Docker socket where required, and the corp-certs directory, while Playwright output now persists through Docker-managed named volumes.
- Recorded the exact rendered mount inventory for the scoped services: `docker-compose.yml` server keeps bind mounts for `logs`, the host ingest/workdir path, `/host/codex`, and corp certs while `playwright-mcp` uses named volume `playwright-output-main`; `docker-compose.local.yml` server keeps those same binds plus `/var/run/docker.sock` and `playwright-mcp` uses named volume `playwright-output-local`; `docker-compose.e2e.yml` server keeps only `/host/codex`, `logs`, and corp certs.
- Updated `design.md` with the Task 11 host-network topology section and Mermaid diagram so the checked-in architecture doc now shows the final server/playwright host ports, the local `9222` CDP split, the named Playwright output volumes, and the remaining allowed mounts after the compose cutover.
- Added the Task 11 startup marker `DEV-0000050:T11:host_network_runtime_ready` in `server/src/index.ts`, driven by compose-provided runtime metadata so each checked-in stack reports its active compose file, host-visible server ports, Playwright port, and source bind-mount count during startup.
- Carry forward for Task 16: document the final host-network compose contract, the main/local/e2e port matrix, the named Playwright output volumes, and the remaining allowed non-source mounts (`logs`, host Codex auth copy source, and the local Docker socket).
- `npm run lint` still fails repo-wide on the pre-existing baseline warning in `client/src/components/chat/SharedTranscript.tsx` even after `npm run lint:fix`, but the Task 11 files were rechecked with targeted `eslint` and are clean.
- `npm run format:check` still fails repo-wide on the existing baseline set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those changes were restored and the Task 11 files were revalidated with targeted `prettier --check` plus `git diff --check`.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, and the existing Task 10 packaging marker still reports `sourceBindMountRequired: false`, so the Compose cutover builds cleanly on the wrapper-first image path.
- Planning repair: Task 11 originally tried to own the first live main-stack `npm run compose:up` proof, but the blocker showed those checks depend on host-level port availability rather than on whether the Compose cutover code is correct. The task now closes on the checked-in code change, rendered Compose proof, contract tests, and wrapper-first compose build, while the first live main-stack startup and manual proof move to Task 12 onward where that dedicated host-environment requirement can be stated honestly.
- Planning repair trigger: the original live main-stack startup proof stopped at `npm run compose:up` because Task 9 preflight correctly detected host port `5010` already occupied before any new containers were started. I confirmed the conflict is not from the checked-in main stack: `ss -ltnp '( sport = :5010 )'` shows `node` listening on `*:5010` as `pid=1` inside this agent container, while `docker ps` only shows the older local stack on `5510/5511/5512` and `8931`. The missing capability is an available host `5010/5011/5012` range for the checked-in main-stack host-network proof path from inside this environment; because `pid=1` is the session’s own long-lived process, I cannot free that port without killing the workspace container. That is why the story now moves the first live main-stack startup proof into Task 12 onward instead of keeping it inside Task 11.
- **BLOCKING ANSWER** Repository precedent, gathered by direct repo inspection because the `code_info` MCP tool was not available in this session, says the current blocker is environmental rather than architectural. [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh) was explicitly built in Task 9 to fail before startup when required host-network ports are occupied, and [server/src/test/unit/host-network-compose-contract.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/host-network-compose-contract.test.ts) already proves the checked-in compose files, port matrix, and forbidden-mount rules separately from live startup. That means the repo already distinguishes between "config/build proof can run here" and "live host-network proof requires the target host ports to be genuinely free", so the blocker does not prove the Compose cutover itself is wrong.
- **BLOCKING ANSWER** External precedent points to the same fix boundary. Official Docker host-network guidance says host-network containers share the host network namespace and published ports are ignored in host mode, so a service binds the real host port directly ([Docker host network driver](https://docs.docker.com/engine/network/tutorials/host/); Context7 `/docker/docs`). Official Compose docs say `network_mode: host` cannot be combined with `ports` or `networks`, and the service must use the host port directly instead of bridge-era publishing ([Compose services reference](https://docs.docker.com/reference/compose-file/services/); Context7 `/docker/compose`). DeepWiki research over `docker/docs` and `docker/compose` confirms there is no Compose-level escape hatch that makes a host-network service start successfully while its required host port is already occupied; the supported choices are to free the port or run in an environment with a different agreed port contract.
- **BLOCKING ANSWER** Issue-resolution research reached the same conclusion in practice. Official Docker troubleshooting guidance and current web references for "address already in use" / "port is already allocated" errors consistently treat the real fixes as either stopping the conflicting listener or changing the application port choice; Docker does not kill unrelated host processes, and `docker compose config` / `--dry-run` only validate configuration, not host-port availability. That matches the local evidence exactly: `ss -ltnp '( sport = :5010 or sport = :5011 or sport = :5012 )'` proves `pid=1` inside this workspace container already owns the main-stack host-network port range, so no amount of Compose-file correctness can make `npm run compose:up` bind those same ports honestly inside this environment.
- **BLOCKING ANSWER** The chosen fix is therefore: keep the Task 11 code changes, keep the blocker note, and complete Task 11 testing steps 2-5 plus Tasks 12-14 only in a dedicated host environment where `5010/5011/5012` and `8932` are actually free. That fits the current repo state because Task 11's static proof surface is already complete here, while the remaining undone proof steps are specifically live host-network runtime checks whose entire purpose is to prove real host-port ownership. Rejected alternatives are not suitable: changing the checked-in main-stack port matrix would violate the story contract, disabling the Task 9 preflight would make the proof dishonest, using `docker compose config` or `--dry-run` as a substitute would not prove live binding, and killing `pid=1` from inside this session would destroy the workspace container rather than solve the story.

---

### Task 12. Add the main-stack host-network proof wrapper

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **cfcda5ef**

#### Overview

Add the checked-in proof wrapper that probes the live main stack after `npm run compose:up`. This task is complete when the main-stack proof path is runnable through one wrapper command, has automated coverage for at least one passing and one failing probe scenario, and is executed in a host environment where the fixed main-stack ports are genuinely free. A junior developer should treat each subtask below as standalone and keep the exact proof endpoints visible while working.

#### Documentation Locations

- Playwright connectivity and browser probing: Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype. Use these to confirm `connectOverCDP()` behavior and the expected browser-probe surface for `http://localhost:9222` and related runtime checks.
- Node.js child process and stream handling: https://nodejs.org/api/child_process.html and https://nodejs.org/api/stream.html. Use these for the proof wrapper’s process execution and log-capture behavior.
- Mermaid flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the main-stack proof-wrapper probe flow so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] Read `scripts/summary-wrapper-protocol.mjs`, `scripts/summary-wrapper-protocol-fixture.mjs`, `scripts/test-summary-e2e.mjs`, `package.json`, and `docker-compose.yml` together with story sections `## Proof Path Readiness` and `## Final Validation`. Keep these exact endpoints visible while you work: classic MCP on `5010`, chat MCP on `5011`, agents MCP on `5012`, and main Playwright MCP on `8932`. Also keep the task docs open while doing this step: Playwright docs via Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype, Node child-process docs at https://nodejs.org/api/child_process.html and https://nodejs.org/api/stream.html, and Mermaid docs via Context7 `/mermaid-js/mermaid`.
2. [x] Before running any live main-stack wrapper or manual proof in this task, verify the target host environment has the fixed main-stack host-network port range free: `5010`, `5011`, `5012`, and `8932`. If Task 9 preflight reports any of those ports already occupied, stop and move this task to a dedicated host environment that can satisfy the checked-in main-stack contract; do not change the story’s port matrix to work around that environment.
3. [x] Add one checked-in summary wrapper under `scripts/` that probes the live main-stack host-visible ports `5010`, `5011`, `5012`, and `8932` after `npm run compose:up`. The wrapper must separately prove:
   - the classic `/mcp` route;
   - the dedicated chat MCP route;
   - the agents MCP route;
   - the Playwright MCP route;
   - and it must fail clearly when any required listener or MCP surface is unavailable.
4. [x] Add the corresponding root `package.json` script entry for that proof wrapper so the checked-in command name becomes `npm run test:summary:host-network:main`, and treat that wrapper command as the canonical reusable proof path used later by Task 15.
5. [x] Split the host-network probe logic into a reusable helper module that both the checked-in wrapper and automated tests can call. The helper must accept injected probe dependencies or endpoint overrides so `server/src/test/unit/test-summary-host-network-main.test.ts` can simulate passing and failing listener states without needing a live Compose stack.
6. [x] Create `server/src/test/unit/test-summary-host-network-main.test.ts` and add a server unit test there that exercises a passing probe scenario. Purpose: prove the wrapper succeeds when all required main-stack MCP listeners are available.
7. [x] In `server/src/test/unit/test-summary-host-network-main.test.ts`, add a server unit test that exercises a failing probe scenario. Purpose: prove the wrapper reports an unavailable listener or MCP surface as a controlled failure.
8. [x] In `server/src/test/unit/test-summary-host-network-main.test.ts`, add a server unit test that asserts the failing probe emits inspectable error output rather than a generic crash. Purpose: prove later diagnosis can rely on saved wrapper output.
9. [x] Update `projectStructure.md` after the new proof-wrapper script, any new shared probe helper module, and `server/src/test/unit/test-summary-host-network-main.test.ts` are added. Document the new wrapper command file path and its dedicated unit-test file so the repository structure doc points to the host-network proof entry points.
10. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the main-stack proof-wrapper probe flow and the host-visible endpoints it validates. Purpose: document the new proof-path architecture at the point where it is introduced.
11. [x] Add or update the structured wrapper log marker `DEV-0000050:T12:main_stack_probe_completed` in the main-stack proof wrapper. Include `classicMcp`, `chatMcp`, `agentsMcp`, `playwrightMcp`, and `result`. Purpose: later Manual Playwright-MCP validation checks this exact line to prove the reusable proof wrapper saw the expected host-network listeners and MCP surfaces.
12. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
13. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
14. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
3. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.
4. [x] `npm run compose:build:summary` If status is `failed`, or item counts indicate failures or unknown states in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing targets.
5. [x] Before `npm run compose:up`, verify the target host can actually offer the fixed main-stack ports `5010`, `5011`, `5012`, and `8932`. If Task 9 preflight reports those ports already occupied, stop and move this task to a dedicated host environment instead of changing the checked-in port contract.
6. [x] `npm run compose:up`
7. [x] Use the Playwright MCP tools against `http://host.docker.internal:5001` to manually confirm the proof-wrapper-related runtime behavior covered by this task, verify the relevant story behavior from the running UI and stack, and confirm there are no logged errors in the debug console. Also check the running logs and saved wrapper output for `DEV-0000050:T11:host_network_runtime_ready` with the main-stack port contract intact and `DEV-0000050:T12:main_stack_probe_completed` with `result: "passed"` and each MCP field reported as reachable.
8. [x] `npm run compose:down`

#### Implementation notes

- Planning repair: Task 12 now owns the first live main-stack `compose:up` proof because the Task 11 blocker proved that those checks depend on a host environment with the fixed main-stack ports free. The wrapper work itself still belongs here, but this task must stop and move to a dedicated host if Task 9 preflight reports the main-stack port range already occupied.
- Re-read the shared summary-wrapper protocol, the existing e2e wrapper, `package.json`, and the main compose file together, then cross-checked Playwright `connectOverCDP()` and Mermaid flowchart syntax in Context7 so the new Task 12 proof wrapper can reuse the existing wrapper contract while probing the fixed main-stack ports honestly.
- Added `scripts/test-summary-host-network-main.mjs` as the checked-in Task 12 wrapper so the main-stack proof path now probes classic/chat/agents/Playwright MCP reachability with the same summary-wrapper heartbeat and saved-log contract used elsewhere in the repo.
- Added `server/src/test/support/hostNetworkMainProbe.mjs` as the reusable probe helper with injectable probe dependencies and endpoint overrides, so the live wrapper and automated tests share one reachability contract instead of duplicating endpoint logic while still remaining visible inside the server Docker build.
- Added `server/src/test/unit/test-summary-host-network-main.test.ts` with explicit passing, failing, and inspectable-error scenarios so the Task 12 probe contract is covered without requiring a live Compose stack.
- Updated `projectStructure.md` and `design.md` once the new helper, wrapper, and unit-test file existed, including a Mermaid flow for the new main-stack proof path and the fixed host-visible endpoints it validates.
- Carry forward for Task 16: document the new `npm run test:summary:host-network:main` command, the `host.docker.internal`-aware probe host selection, and the Task 12 saved-log marker contract alongside the final host-network proof workflow.
- `npm run build:summary:server` initially failed because the first helper import lived outside the server tree and TypeScript could not see its declarations; moving the shared probe into `server/src/test/support/` fixed that path cleanly, and the wrapper rerun passed with `warning_count: 0`.
- `npm run test:summary:server:cucumber` passed cleanly on the first full rerun with `tests run: 71`, `passed: 71`, and `failed: 0`, so the new Task 12 files did not disturb the existing feature-suite contract.
- `npm run compose:build:summary` initially failed because the server Docker build did not copy the root `scripts/` helper into `/app`; moving the shared helper into `server/src/test/support/` resolved the build-context gap honestly, and the rerun passed with `items passed: 2`, `items failed: 0`.
- The first live wrapper run surfaced one real protocol nuance instead of a missing listener: Playwright MCP on `8932` rejected the probe with `406 Not Acceptable` until the shared helper sent `Accept: application/json, text/event-stream` and learned to parse the event-stream style `initialize` response payload, after which the reusable wrapper passed cleanly.
- `npm run lint` still fails repo-wide on the existing 14-warning baseline even after `npm run lint:fix`, but the Task 12 JavaScript/TypeScript files are clean under targeted `npx eslint`, and the shell-side Task 9 carry-forward changes passed `bash -n` plus the focused Bats regression for docker-host port probing.
- `npm run format:check` still fails repo-wide on the existing broad baseline plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those spillover edits were restored and the Task 12 files passed targeted `npx prettier --check` plus `git diff --check`.
- Verified the fixed main-stack ports were genuinely free before the live proof cycle by stopping the stack and probing `5010`, `5011`, `5012`, and `8932` through `docker run --network host --entrypoint node codeinfo2-server ...`, which returned all four ports as `occupied: false`.
- `npm run compose:up` then passed the Task 9 preflight with `DEV-0000050:T09:compose_preflight_result {"composeFile":"docker-compose.yml","result":"passed","playwrightServicePresent":true,"checkedPorts":[5010,5011,5012,8932]}` and the stack reached healthy startup on the checked-in main host-network contract.
- The fresh live proof cycle passed end to end: `npm run test:summary:host-network:main` reported all four MCP surfaces reachable with `DEV-0000050:T12:main_stack_probe_completed {"classicMcp":"reachable","chatMcp":"reachable","agentsMcp":"reachable","playwrightMcp":"reachable","result":"passed"}`, the browser UI loaded cleanly at `http://host.docker.internal:5001`, the console showed no errors, and the server log still recorded `DEV-0000050:T11:host_network_runtime_ready` with `serverPorts:[5010,5011,5012]`, `playwrightPort:8932`, and `sourceBindMountCount:0`.
- `npm run compose:down` completed cleanly after the live proof cycle, returning the main stack to a stopped state before final close-out.
- The final full unit rerun needed one stale expectation repair in `server/src/test/unit/host-network-compose-contract.test.ts`: the e2e server contract now pins `CODEINFO_SERVER_PORT=6010` directly, so the placeholder-era assertion was updated and the rerun then passed with `tests run: 1368`, `passed: 1368`, and `failed: 0`.

---

### Task 13. Align the e2e proof path with host-network addresses

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: **91300ff0**

#### Overview

Update the checked-in e2e env injection, config, and test assumptions so the e2e proof path follows the real host-visible addresses after the host-network cutover. This task is complete when the checked-in e2e wrapper and tests no longer depend on bridge-era URLs or ports and still keep browser navigation targets separate from MCP control-channel targets. A junior developer should treat each subtask below as standalone and keep the exact browser-vs-MCP URL split visible while working.

#### Documentation Locations

- Playwright config and base URL handling: Context7 `/microsoft/playwright`. Use this to keep the checked-in Playwright config and e2e wrapper aligned with the final host-visible addresses.
- Docker/Compose environment wiring: Context7 `/docker/compose`. Use this to confirm how the e2e stack should receive host-visible URLs after the host-network cutover.
- Mermaid flowchart syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` with the e2e host-visible address and env-injection flow so the Mermaid syntax matches the current specification.

#### Subtasks

1. [x] Read `scripts/test-summary-e2e.mjs`, `docker-compose.e2e.yml`, `.env.e2e`, `e2e/playwright.config.ts`, and the checked-in `e2e` tests together with story sections `## Proof Path Readiness` and `## Final Validation`. Keep these exact rules visible while you work: browser navigation URL and MCP control-channel URL are separate contracts; both must be host-visible after the cutover; neither may fall back to bridge-only hostnames. Also keep the task docs open while doing this step: Playwright docs via Context7 `/microsoft/playwright`, Docker/Compose docs via Context7 `/docker/compose`, and Mermaid docs via Context7 `/mermaid-js/mermaid`.
2. [x] Update any checked-in e2e env injection, checked-in e2e config, or test assumptions that would otherwise still point at stale bridge-era URLs or ports after the host-network cutover. The end result must use the real host-visible addresses from the story’s port matrix.
3. [x] Keep browser navigation targets and MCP control-channel targets as separate contracts where the story requires them. Do not replace one with the other just because both are host-visible URLs.
4. [x] Add or update an e2e test in `e2e/env-runtime-config.spec.ts` that asserts the runtime uses the intended host-visible base URL instead of a stale bridge-only address. Purpose: prove the browser-facing side of the e2e path has moved to the host-network contract.
5. [x] Add or update an e2e test in `e2e/env-runtime-config.spec.ts` that asserts any MCP control-channel URL uses the intended host-visible value instead of a stale bridge-only address. Purpose: prove the control-channel side of the e2e path has moved to the host-network contract.
6. [x] Add or update an e2e test in `e2e/env-runtime-config.spec.ts` that asserts the browser base URL and MCP control-channel URL remain separate values where the env contract expects them to differ. Purpose: prove the host-network cutover did not collapse navigation and control endpoints into one contract.
7. [x] Update `design.md` with a Mermaid diagram and supporting text that describe the e2e env-injection flow, the host-visible browser URL, and the separate MCP control-channel URL. Purpose: document the final e2e runtime wiring once the host-network address cutover is implemented.
8. [x] Add or update the structured log marker `DEV-0000050:T13:e2e_host_network_config_verified` in the e2e env/runtime-config path. Include `browserBaseUrl`, `mcpControlUrl`, and `baseUrlMatchesMcp`. Purpose: later Manual Playwright-MCP validation checks this exact line to prove the e2e runtime is using separate host-visible browser and MCP addresses.
9. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.
10. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
11. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:client` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/client-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:client` after fixes.
4. [x] `npm run test:summary:e2e` Allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:e2e` after fixes.
5. [x] `npm run compose:build:summary` If status is `failed`, or item counts indicate failures or unknown states in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing targets.
6. [x] `npm run compose:up`
7. [x] Use the Playwright MCP tools against `http://host.docker.internal:5001` to manually confirm the e2e runtime behavior covered by this task, verify the relevant story behavior from the running UI and stack, and confirm there are no logged errors in the debug console. Also check the running logs for `DEV-0000050:T06:mcp_endpoints_normalized` with `placeholderFree: true`, `DEV-0000050:T07:checked_in_mcp_contract_loaded` with `legacyFallbackUsed: false`, `DEV-0000050:T11:host_network_runtime_ready` for the active stack, and `DEV-0000050:T13:e2e_host_network_config_verified` with host-visible URLs and `baseUrlMatchesMcp: false`.
8. [x] `npm run compose:down`

#### Implementation notes

- Re-read the checked-in e2e wrapper, compose file, root `.env.e2e`, root `playwright.config.ts`, and the current e2e specs together with the Task 13 and Task 15 proof sections, then cross-checked the requested Playwright, Docker Compose, and Mermaid docs in Context7 before editing so the host-visible browser/MCP split stays explicit.
- Updated the checked-in e2e env injection and defaults onto the host-visible e2e contract: `.env.e2e`, `playwright.config.ts`, `scripts/test-summary-e2e.mjs`, `docker-compose.e2e.yml`, and the checked-in e2e specs now point at `host.docker.internal:6001`, `6010`, and `8932/mcp` instead of the older localhost or bridge-era assumptions.
- Kept the browser base URL and MCP control URL as separate contracts by adding explicit `E2E_MCP_CONTROL_URL` handling, preserving the client/server API URL split, and proving the distinction in `e2e/env-runtime-config.spec.ts` instead of collapsing everything onto one host-visible URL.
- Added the Task 13 host-network assertions in `e2e/env-runtime-config.spec.ts` for the browser base URL, the Playwright MCP control URL, and the required `baseUrlMatchesMcp: false` separation contract.
- Updated `design.md` with the Task 13 e2e env-injection note and Mermaid flowchart, and carried forward the Task 16 doc delta as the final shared-doc update only because this task introduced no new files.
- Added `DEV-0000050:T13:e2e_host_network_config_verified` to the e2e summary-wrapper path and fixed a real wrapper bug while doing so: the marker now writes to the saved log before the stream closes instead of being lost after teardown.
- `npm run lint` still fails repo-wide on the remaining baseline warning in `client/src/components/chat/SharedTranscript.tsx` even after `npm run lint:fix`, but the Task 13 JavaScript and TypeScript files are clean under targeted `npx eslint` after restoring the unrelated autofix spillover.
- `npm run format:check` still fails repo-wide on the known baseline set plus the intentionally invalid `server/src/test/fixtures/flows/invalid-json.json`; after `npm run format` touched unrelated files, those spillover edits were restored and the Task 13 file set passed targeted `npx prettier --check` plus `git diff --check`.
- `npm run build:summary:server` passed with `warning_count: 0` and `agent_action: skip_log`, so the Task 13 e2e changes did not disturb the server workspace build.
- `npm run build:summary:client` passed cleanly through both the client typecheck and build phases with `warning_count: 0`, confirming the host-visible e2e config updates compile on the browser side too.
- `npm run test:summary:client` passed with `tests run: 632`, `passed: 632`, and `failed: 0`, so the client-side runtime-config and env/default updates did not regress the browser test suite.
- The first full `npm run test:summary:e2e` rerun exposed two real Task 13 regressions: the new env-runtime-config assertions were reading `test.info().config.use.baseURL` from the wrong shape, and the wrapper’s JSON parser was grabbing the `{` from the literal `${E2E_USE_MOCK_CHAT:-true}` npm-script text instead of the Playwright report. Switching the assertions to the actual injected `baseUrl`, restoring a brace-free npm script, and falling back to Playwright `stats` counts fixed both issues.
- The final full `npm run test:summary:e2e` rerun passed with `tests run: 49`, `passed: 49`, `failed: 0`, and emitted `DEV-0000050:T13:e2e_host_network_config_verified {"browserBaseUrl":"http://host.docker.internal:6001","mcpControlUrl":"http://host.docker.internal:8932/mcp","baseUrlMatchesMcp":false}` in `logs/test-summaries/e2e-tests-latest.log`.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, so the e2e host-visible env changes still build cleanly through the checked-in Docker path and keep the Task 10 image-baked runtime proof intact.
- `npm run compose:up` passed Task 9 preflight for the main stack and brought the host-network main runtime up cleanly, preserving the fixed `5010/5011/5012/8932` contract needed for the later manual proof.
- Testing step 7 initially surfaced one real proof gap: `DEV-0000050:T07:checked_in_mcp_contract_loaded` was not landing in the inspectable runtime log path, so `server/src/config/runtimeConfig.ts` now appends that marker into the shared log store as well as `console.info`. After rebuilding and re-running the host-network stack, the live proof showed `T06` in `/logs` with `placeholderFree: true`, `T07` in `/logs` with `legacyFallbackUsed: false`, `T11` in `/app/logs/server.1.log` for the active `5010/5011/5012/8932` stack, and `T13` in `logs/test-summaries/e2e-tests-latest.log` with `baseUrlMatchesMcp: false`.
- Manual browser proof on `http://host.docker.internal:5001/chat` loaded cleanly in the browser tool, showed no console errors or warnings, and exercised a live Codex chat send so the Task 13 host-visible runtime path was verified against the running main stack rather than only against saved wrapper output.
- `npm run compose:down` completed cleanly after the rebuilt main-stack proof cycle, returning the host-network stack to a stopped state before Task 13 close-out.

---

### Task 14. Restore repo-wide lint and format gates for story close-out

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `4d41f142` `DEV-[50] - Restore repo-wide lint and format gates`

#### Overview

Repair the root lint and format gates before final validation and documentation close-out continue. The earlier blocker research proved the original final-validation task was too large because it mixed runtime proof work with repo-wide hygiene debt and an intentional invalid fixture exception. This task is complete when the checked-in root lint and format commands pass honestly again, with the intentional invalid JSON fixture excluded through a checked-in ignore rule instead of through ad hoc one-off commands, and the final-validation task can depend only on already-proven runtime and wrapper seams.

#### Documentation Locations

- ESLint CLI and autofix guidance: Context7 `/eslint/eslint`. Use this for `--max-warnings`, `--fix`, and the intended root quality-gate behavior.
- React hooks lint guidance: Context7 `/reactjs/react.dev`. Use this for the `react-hooks/exhaustive-deps` warning in `client/src/components/chat/SharedTranscript.tsx`.
- Prettier ignore and CLI behavior: Context7 `/prettier/prettier`. Use this for `.prettierignore`, parser-error behavior, and the intentional invalid fixture exclusion.

#### Subtasks

1. [x] Re-read the current blocker notes and blocking-answer research from the repaired plan before touching files. Keep the goal visible while you work: root `npm run lint` and root `npm run format:check` must pass without weakening the repo-quality gate and without changing the meaning of the intentionally invalid fixture.
2. [x] Re-run `npm run lint` and `npm run format:check` from the repository root and record the exact failing file list in the implementation notes before any fixes are applied. Purpose: capture the pre-fix baseline so a reviewer can confirm this task closed the same blocker it set out to repair.
3. [x] Update `.prettierignore` to exclude `server/src/test/fixtures/flows/invalid-json.json` with a short comment that the file is an intentional invalid test fixture and must stay syntactically invalid for fixture coverage. Purpose: make the checked-in root `format:check` path honest without mutating the fixture itself.
4. [x] Run `npm run lint:fix` from the repository root. Review the resulting diff and keep only behavior-safe autofixes that are needed to clear the current root warnings. If the autofix touches unrelated files in a way that is not obviously safe, inspect and either keep the safe lint-only change or restore that file before continuing.
5. [x] Manually fix any root lint warnings that remain after `npm run lint:fix`. At minimum, update `client/src/components/chat/SharedTranscript.tsx` so its `useCallback` dependency list contains only the values actually referenced inside the callback body. If any additional non-fixable warnings remain after the autofix run, fix them here and record each one in the implementation notes.
6. [x] Run `npm run lint` from the repository root and do not continue until it passes cleanly. Purpose: prove the repo-wide lint gate now succeeds with the checked-in root script instead of only through targeted file checks.
7. [x] Run `npm run format` from the repository root after the new ignore rule is in place. Review the diff, keep the intended formatting-only changes, and restore any accidental non-format edits before continuing.
8. [x] Run `npm run format:check` from the repository root and do not continue until it passes cleanly. Purpose: prove the repo-wide format gate now succeeds with the checked-in root script and the intentional invalid fixture exception is encoded in the repo itself.
9. [x] Run `git diff --check` and fix any remaining whitespace or patch-shape problems before closing this task. Purpose: ensure the hygiene-baseline repair itself is clean before later validation or documentation tasks depend on it.
10. [x] Record the exact files changed, the commands run, why the `.prettierignore` exception is safe, and any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.

#### Testing

1. [x] `npm run lint`
2. [x] `npm run format:check`
3. [x] `npm run test:summary:client` If the SharedTranscript hook change or any other client lint fix affected runtime behavior, inspect the printed log path only when the wrapper reports failure.
4. [x] `git diff --check`

#### Implementation notes

- Planning repair: this task was inserted after the blocker proved the original final-validation task mixed two different responsibilities. Repo-wide lint/format baseline recovery is now a prerequisite task so Task 15 depends only on already-proven runtime, wrapper, and manual-proof seams, and Task 16 can rerun the root gates against a known-clean baseline after the doc edits.
- Re-read the repaired Task 14 blocker notes plus current Context7 guidance for ESLint, React hook dependencies, and Prettier ignore behavior before touching files so the repo-wide gate repair follows the documented fix path instead of the older temporary targeted-check workaround.
- Baseline before fixes: root `npm run lint` still fails on 14 warnings across `client/src/components/Markdown.tsx`, `client/src/components/chat/SharedTranscript.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/components/ingest/IngestForm.tsx`, `client/src/hooks/useConversations.ts`, `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts`, `client/src/test/baseUrl.env.test.ts`, `client/src/test/chatPage.focusRefresh.test.tsx`, `client/src/test/chatPage.workingFolder.test.tsx`, `client/src/test/useChatWs.test.ts`, `client/src/test/useIngestRoots.test.tsx`, `server/src/test/integration/flows.run.loop.test.ts`, and `server/src/test/integration/flows.run.working-folder.test.ts`; 13 are `import/order` autofix candidates and one is the `SharedTranscript.tsx:240` `react-hooks/exhaustive-deps` warning.
- Baseline before fixes: root `npm run format:check` reports broad tracked-file drift in the existing repo plus a hard parser error on the intentional invalid fixture `server/src/test/fixtures/flows/invalid-json.json`.
- Added a checked-in `.prettierignore` exception for `server/src/test/fixtures/flows/invalid-json.json` with an explicit comment so the root formatter skips the intentional invalid fixture without changing the fixture payload itself.
- `npm run lint:fix` reduced the root lint failure set to the single expected `SharedTranscript.tsx:240` hook warning and only changed behavior-safe import ordering in the previously failing files, so the autofix diff was kept.
- Manually removed the unused `conversationId` and `surface` entries from the `reconcileScrollPosition` `useCallback` dependency list in `client/src/components/chat/SharedTranscript.tsx`, which resolved the last remaining root lint warning without changing the callback body.
- Root `npm run lint` now passes cleanly with the checked-in script and the kept autofix/manual hook cleanup.
- `npm run format` completed successfully after the new ignore rule was in place and produced formatting-only normalization across the previously drifting tracked files while leaving the intentional invalid fixture untouched.
- Root `npm run format:check` now passes cleanly with the checked-in `.prettierignore` exception in place, so the root formatter no longer chokes on the intentional invalid fixture.
- **BLOCKING ANSWER** Lint blocker research and proof: `code_info` precedent search found that Story 0000050 Tasks 1-13 repeatedly treated root `npm run lint` failures as temporary repo-baseline debt while using targeted `npx eslint` passes for touched files, and Story 0000048 shows the stronger close-out pattern where the story finishes only after the full repo-wide lint gate passes cleanly again. DeepWiki on `eslint/eslint` and official ESLint CLI docs both confirm that `--max-warnings` is an intentional quality gate, while `eslint --fix` is the supported mechanism for safe automatic fixes; DeepWiki on `facebook/react`, the official React `exhaustive-deps` docs, and facebook/react issue `#16291` all agree that a `useCallback` dependency that is not referenced inside the callback should be removed instead of left in place or suppressed. The current local repo state matches that guidance exactly: rerunning root lint now fails on 14 warnings, 13 are import-order warnings that ESLint reports as auto-fixable, and the one non-fixable warning is the `useCallback` dependency list in `client/src/components/chat/SharedTranscript.tsx:240`, where `conversationId` and `surface` are listed without being read in the callback body. Chosen fix: keep the repo-wide `--max-warnings=0` policy, run `npm run lint:fix` to clear the fixable warnings, then manually remove the unnecessary `conversationId` and `surface` dependencies from that callback and rerun root `npm run lint` until it passes cleanly. Rejected alternatives: keeping final validation closed with only targeted file lint is a temporary workaround that this same plan has already repeated across earlier tasks, lowering or removing `--max-warnings=0` weakens the intended repo policy instead of solving the debt, and adding `eslint-disable` around the hook warning hides a real React lint contract instead of applying the documented fix.
- **BLOCKING ANSWER** Format blocker research and proof: `code_info` precedent search found that Story 0000050 Tasks 1-13 and Story 0000049 repeatedly documented the same root `npm run format:check` failure mode: ordinary repo-wide formatting drift plus the intentionally invalid fixture `server/src/test/fixtures/flows/invalid-json.json`, with targeted `npx prettier --check` runs used only as temporary task-local proof. DeepWiki on `prettier/prettier` and the official Prettier ignore docs both point to the same intended solution: keep intentionally unformattable files out of the root check via `.prettierignore` rather than trying to make them parseable for the formatter, and use the checked-in ignore file so `prettier --write .` / `prettier --check .` can run without choking on known exceptions. Prettier 3.6 CLI docs/blog also show that parser failures during `--check` are hard errors, which matches the current local repo behavior. The current local repo state fits that fix precisely: `.prettierignore` currently does not exclude `server/src/test/fixtures/flows/invalid-json.json`, root `npm run format:check` fails on that syntax error plus broad tracked-file drift, and `--ignore-unknown` is not a real solution here because `.json` already has a known parser and the failure is a parse error, not an unknown-file-type error. Chosen fix: add `server/src/test/fixtures/flows/invalid-json.json` to `.prettierignore` with a short comment explaining that it is an intentional invalid test fixture, run `npm run format` to normalize the remaining tracked files, and rerun root `npm run format:check` until it passes cleanly. Rejected alternatives: making the fixture valid JSON would destroy the test case the fixture exists to prove, renaming the fixture extension would create unnecessary harness churn for a tooling-only problem, and using one-off negative globs in ad hoc commands would not fix the checked-in root `format:check` path that Task 14 and Task 16 explicitly require.
- `npm run test:summary:client` passed after the lint/format repair with `tests run: 632`, `failed: 0`, and saved log `test-results/client-tests-2026-03-21T16-17-21-781Z.log`, so the `SharedTranscript` dependency cleanup did not regress the client suite.
- `git diff --check` passed cleanly after the repo-wide autofix and format passes, so the resulting patch shape is whitespace-safe.
- Exact files changed by this task were `.prettierignore`, the 13 import-order autofix files from the root lint baseline, `client/src/components/chat/SharedTranscript.tsx`, the broader formatting-only files touched by `npm run format`, and this plan file. Commands run in order: root `npm run lint`, root `npm run format:check`, root `npm run lint:fix`, root `npm run lint`, root `npm run format`, root `npm run format:check`, `npm run test:summary:client`, and `git diff --check`.
- The `.prettierignore` exception is safe because it excludes exactly one intentional invalid JSON fixture that exists to stay syntactically broken for test coverage; the root formatter now reflects that checked-in contract instead of requiring ad hoc command-line workarounds.
- Carry forward for Task 16: document that story close-out now depends on a restored root lint/format baseline, mention the checked-in invalid-fixture Prettier exception, and keep the final docs consistent with the repo-wide formatting normalization that landed here.

---

### Task 15. Run final validation for Story 0000050

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `e48d4b0e` `DEV-[50] - Record task 14 validation proof`

#### Overview

This task proves the completed story against the acceptance criteria once Task 14 has restored a clean repo-wide lint and format baseline. It reruns the wrapper-first build and test paths, proves the runtime behavior with the new proof wrappers, and captures the final manual verification evidence that the rest of the close-out will reference. The already-landed runtime marker name `DEV-0000050:T14:story_validation_completed` and the existing `0000050-14-*` screenshot prefix remain unchanged so the repaired plan stays aligned with the proof artifacts that were captured before this story repair.

#### Documentation Locations

- Docker/Compose runtime validation: Context7 `/docker/compose` plus https://docs.docker.com/engine/network/tutorials/host/. Use these for the final host-network runtime checks and port expectations.
- Playwright runtime validation: Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype. Use these for the final browser-control and CDP validation work.
- Cucumber guide for reliable automated test execution: https://cucumber.io/docs/guides/continuous-integration/. Use this because this task runs the checked-in cucumber wrapper as part of the final validation pass and needs a current guide under the required `/docs/guides/` path.

#### Subtasks

1. [x] Re-read `## Description`, `## Acceptance Criteria`, `## Out Of Scope`, `## Traceability And Proof Pass`, and `## Final Validation` before starting this task. This task is the whole-story acceptance gate, so do not rely on memory or earlier task notes alone.
2. [x] Run the wrapper-first build and test paths required by the story and record the saved-output locations that later close-out notes will reference. Keep the exact commands aligned with the `#### Testing` list in this task.
3. [x] After `npm run compose:up` has started the main stack in this task, run the checked-in proof wrapper command created by Task 12, `npm run test:summary:host-network:main`, and record its saved-output path. Purpose: prove the reusable host-network probe path succeeds against the final stack instead of relying only on ad hoc manual inspection.
4. [x] Compare the validated system against every grouped requirement in `## Traceability And Proof Pass` and record any mismatch before Task 16 starts. Purpose: prove the final validation covers the whole story and that no out-of-scope behavior was introduced while implementing it.
5. [x] Inspect the running containers and the wrapper-rendered Compose definitions to prove the host-network runtime is using image-baked application contents rather than host source bind mounts, with only Docker-managed generated-output volumes plus the explicitly host-visible logs remaining. Use both:
   - the wrapper-driven Compose config proof from Task 11;
   - live container inspection such as `docker inspect`.
     Record the exact remaining mount list so a reviewer can see which mounts are still present and why each one is allowed.
6. [x] Verify the final runtime still supports the required traffic patterns on the documented host-visible endpoints:
   - REST/API access;
   - classic `/mcp`;
   - dedicated chat MCP;
   - agents MCP;
   - Playwright browser control;
   - websocket flows;
   - screenshot capture;
   - manual UI verification;
   - and the local manual-testing Chrome DevTools contract on `9222`, keeping that `9222` endpoint as a distinct Chromium CDP surface rather than treating it as interchangeable with the Playwright MCP control URL.
7. [x] Inspect the saved wrapper outputs, startup reporting, and runtime logs produced during this task to prove the observability contracts introduced by the story are real in the final system. Confirm that classic/chat/agents MCP endpoints are reported separately, that actionable wrapper or compose failure text is available whenever a wrapper in this task reports failure, and that any blank-markdown skip or related informational paths still emit the documented structured context instead of silent behavior.
8. [x] Re-run a repository search for checked-in Compose files before closing the story and confirm the scoped inventory still matches the story assumptions from Task 11:
   - `server` remains scoped to `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`;
   - `playwright-mcp` remains scoped to `docker-compose.yml` and `docker-compose.local.yml`.
     If the inventory changed during implementation, update the story traceability and validation notes before Task 16.
9. [x] Use Playwright MCP tools to manually verify the running product and save any GUI-proof screenshots to `playwright-output-local/` using the historical filename pattern `0000050-14-<short-name>.png` so the repaired plan still matches the already-captured proof artifacts. This story does not introduce a new front-end feature, so only capture screenshots for GUI-visible acceptance that can actually be checked from the running product, such as the validated page state, logs view, or other visible runtime evidence. Capture enough screenshots for the agent to compare against the expectations in this task instead of only proving that the page loads.
10. [x] Add or update the final structured validation log marker `DEV-0000050:T14:story_validation_completed` in the final proof or verification path. Include `traceabilityPass`, `manualChecksPassed`, `screenshotCount`, and `proofWrapperPassed`. Purpose: later Manual Playwright-MCP validation checks this exact line to prove the final story gate completed with the expected evidence.
11. [x] Record any later documentation deltas for Task 16. Do not update shared docs in this task unless a new file is created here.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:unit` after fixes.
4. [x] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:server:cucumber` after fixes.
5. [x] `npm run test:summary:client` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/client-tests-*.log`), diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:client` after fixes.
6. [x] `npm run test:summary:e2e` Allow up to 7 minutes. If `failed > 0` or setup or teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper commands only if needed, and rerun full `npm run test:summary:e2e` after fixes.
7. [x] `npm run compose:build:summary` If status is `failed`, or item counts indicate failures or unknown states in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing targets.
8. [x] `npm run compose:up`
9. [x] Use the Playwright MCP tools against `http://host.docker.internal:5001` to manually confirm story behavior and general regression from the running stack, including a check that there are no logged errors in the debug console. Also check the running logs and saved wrapper outputs for the exact markers listed in `## Manual Playwright-MCP Log Evidence`, and treat the manual validation as passing only when the expected Task 1 through Task 14 marker outcomes are visible for the exercised paths. Where any GUI-visible acceptance can be confirmed from the running product, reuse or extend the saved screenshots under the historical `0000050-14-<short-name>.png` prefix so the repaired plan still matches the existing proof set.
10. [x] `npm run compose:down`

#### Implementation notes

- Planning repair: Task 15 no longer owns repo-wide lint or format recovery. That work moved into new prerequisite Task 14 because the blocker proved those gates are repository-baseline prerequisites rather than runtime-validation work, and keeping them here made the original task too large to close honestly.
- Historical proof naming stays in place after the repair: the runtime marker remains `DEV-0000050:T14:story_validation_completed` and the saved screenshot prefix remains `0000050-14-*` so the repaired plan continues to line up with the already-captured proof artifacts instead of forcing retroactive code and evidence churn.
- Re-read the story description, acceptance criteria, out-of-scope notes, traceability proof pass, and final validation sections before starting Task 15 so the final gate uses the current committed story contract rather than earlier task memory.
- `npm run build:summary:server` passed cleanly with `warning_count: 0`; saved output remains at `logs/test-summaries/build-server-latest.log` for the final validation evidence set.
- `npm run build:summary:client` passed cleanly with `warning_count: 0`; saved output remains at `logs/test-summaries/build-client-latest.log` for the final validation evidence set.
- `npm run test:summary:server:unit` passed with `tests run: 1368`, `failed: 0`, and saved log `test-results/server-unit-tests-2026-03-21T12-16-42-674Z.log`.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `failed: 0`, and saved log `test-results/server-cucumber-tests-2026-03-21T12-27-11-559Z.log`.
- `npm run test:summary:client` passed with `tests run: 632`, `failed: 0`, and saved log `test-results/client-tests-2026-03-21T12-28-44-652Z.log`.
- `npm run test:summary:e2e` passed with `tests run: 46`, `failed: 0`, saved output `logs/test-summaries/e2e-tests-latest.log`, and re-emitted `DEV-0000050:T13:e2e_host_network_config_verified` for the host-visible e2e contract.
- `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, saved output `logs/test-summaries/compose-build-latest.log`, and re-emitted `DEV-0000050:T10:image_runtime_assets_baked` with `sourceBindMountRequired: false`.
- `npm run compose:up` passed through the checked-in wrapper and emitted `DEV-0000050:T09:compose_preflight_result` with `result: passed` for `docker-compose.yml` before the final main stack reached healthy startup.
- Recorded the full wrapper-first evidence set for Task 15 so far: `logs/test-summaries/build-server-latest.log`, `logs/test-summaries/build-client-latest.log`, `test-results/server-unit-tests-2026-03-21T12-16-42-674Z.log`, `test-results/server-cucumber-tests-2026-03-21T12-27-11-559Z.log`, `test-results/client-tests-2026-03-21T12-28-44-652Z.log`, `logs/test-summaries/e2e-tests-latest.log`, and `logs/test-summaries/compose-build-latest.log`.
- `npm run test:summary:host-network:main` passed against the live stack, saved output `logs/test-summaries/host-network-main-latest.log`, and re-emitted `DEV-0000050:T12:main_stack_probe_completed` with all four MCP surfaces reachable.
- Compared the grouped requirements in `## Traceability And Proof Pass` against the recorded Task 1-13 evidence plus the current Task 15 wrapper outputs, and found no mismatch or scope drift before continuing into the live runtime-only proof steps.
- Rendered `docker compose -f docker-compose.yml config` plus live `docker inspect` output proved the main `server` and `playwright-mcp` services now run from image-baked application contents without any host source bind mount; the remaining allowed mounts were the reviewed `logs` bind, the corp CA bind, the host repo-root read-only bind used for cross-repo workflows, the host Codex auth read-only bind, and the Docker-managed Playwright output volume.
- Verified the final host-visible traffic matrix end to end: REST `/health` on `5010`, classic `/mcp` on `5010`, chat MCP on `5011`, agents MCP on `5012`, Playwright MCP reachability via the Task 12 wrapper on `8932`, websocket chat connectivity at `http://host.docker.internal:5001/chat`, screenshot capture on the running UI, and Chrome DevTools discovery on `9222` as a separate CDP contract rather than a substitute for the Playwright MCP URL.
- Checked the final observability paths across wrapper output, runtime `/logs`, and explicit failure text: `T06`, `T07`, `T11`, and the triggered `T01`-`T05` markers were all visible with structured context, the local-compose preflight failure remained actionable for occupied-port scenarios, and the blank-markdown skip path stayed inspectable instead of silent.
- Re-ran the checked-in Compose inventory search and confirmed the Task 11 scope still matches the story assumptions: `server` remains limited to `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`, while `playwright-mcp` remains limited to `docker-compose.yml` and `docker-compose.local.yml`.
- Manual Playwright MCP validation passed against `http://host.docker.internal:5001`: the chat page connected without console errors, the logs page showed the expected `DEV-0000050:T01` through `DEV-0000050:T14` markers for the exercised proof path, and the GUI evidence was saved as `playwright-output-local/0000050-14-chat-ready.png` and `playwright-output-local/0000050-14-logs-proof.png`.
- Added the reusable verification helper `scripts/emit-task14-validation-marker.mjs`, used it to emit `DEV-0000050:T14:story_validation_completed` with `traceabilityPass: true`, `manualChecksPassed: true`, `screenshotCount: 2`, and `proofWrapperPassed: true`, and confirmed the marker was persisted through the running `/logs` endpoint.
- Carry forward for Task 16: document the new marker-emission helper and the final Task 15 evidence set, especially the exact allowed mount list, the host-visible endpoint matrix, the wrapper/log proof locations, and the two Manual Playwright screenshots in `playwright-output-local/`.
- `npm run compose:down` completed cleanly and removed the main Task 15 validation stack after the manual proof run.
- Audit follow-up: Task 15 was left at `in_progress` even though every subtask and testing item had already been checked and the proof artifacts were present in the repo. The task-level status and commit ledger were corrected after re-checking the saved logs, screenshots, marker helper, and the existing validation notes.

---

### Task 16. Update documentation and story close-out

- Repository Name: `codeInfo2`
- Task Status: **completed**
- Git Commits: `5d03b6da` `DEV-[50] - Complete story 50 documentation close-out`

#### Overview

Update the shared documentation and prepare the finished story for review after Task 15 has produced the final validated behavior. This task is complete when the repo docs match the implemented contracts and the pull-request summary clearly explains the final server, runtime, wrapper, and proof-path changes. A junior developer should treat each subtask below as standalone and use the saved outputs from Task 15 instead of reconstructing final behavior from memory.

#### Documentation Locations

- Docker/Compose runtime documentation: Context7 `/docker/compose` plus https://docs.docker.com/engine/network/tutorials/host/. Use these when updating docs so the host-network contract and prerequisites are described accurately.
- Playwright runtime and screenshot documentation: Context7 `/microsoft/playwright` plus https://playwright.dev/docs/next/api/class-browsertype. Use these when documenting the proof wrappers, screenshots, and Chrome DevTools validation behavior.
- Cucumber guides for validation workflow context: https://cucumber.io/docs/guides/testable-architecture/ and https://cucumber.io/docs/guides/continuous-integration/. Use these to keep the close-out notes grounded in reliable automated test usage rather than UI-only proof.
- Mermaid diagram syntax: Context7 `/mermaid-js/mermaid`. Use this when updating `design.md` so the final Mermaid diagrams conform to the current Mermaid specification.
- Any external documentation sources recorded in the earlier tasks when they introduced new commands or runtime contracts

#### Subtasks

1. [x] Update `README.md` at the repository root with the final command names, proof wrappers, runtime expectations, and validation entry points introduced by this story. Include the exact wrapper names, the host-network prerequisites developers must satisfy before running them, where to find the generated proof evidence from Task 15 including any Manual Playwright-MCP screenshots saved in `playwright-output-local/`, and the wrapper-first log-review rule that full logs are only opened when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts. Purpose: make the top-level developer entry point reflect the validated host-network and re-ingest workflow commands from Task 15.
2. [x] Update `design.md` at the repository root with the final re-ingest request union, the intermediate re-ingest result contract, the single and batch transcript contracts, the blank-markdown behavior, the host-network runtime model, the proof-wrapper flow, and the Mermaid diagrams introduced or refined by the earlier architecture tasks. Purpose: consolidate the final design state in one architecture document after all implementation tasks are complete.
3. [x] Update `docs/developer-reference.md` with the final MCP URLs, env-var names, host-network prerequisites, wrapper usage, the wrapper log locations and inspection rule, the exact meaning of `CODEINFO_SERVER_PORT`, `CODEINFO_CHAT_MCP_PORT`, `CODEINFO_AGENTS_MCP_PORT`, and `CODEINFO_PLAYWRIGHT_MCP_URL` after the cutover, and the env-file precedence between `server/.env`, `server/.env.local`, `server/.env.e2e`, and the wrapper-consumed root `.env.e2e`. Purpose: keep the operator-focused reference aligned with the implemented runtime contract and the real checked-in deployment entrypoints.
4. [x] Update `projectStructure.md` at the repository root with every new or changed file path created by this story, including wrappers, tests, vendored shell-harness runtime files, any new runtime helper modules, and any new proof or status test files. Purpose: make the repository structure doc match the final file layout after all file-creating tasks have landed.
5. [x] Write the pull-request summary for this story, covering the final server contract changes, Docker/runtime changes, wrapper changes, proof-path additions, documentation updates, and the validation evidence captured in Task 15. Include the highest-risk compatibility changes called out in this story, especially the `CODEINFO_CHAT_MCP_PORT` cutover, the host-network compose shift, and the one-payload batch transcript behavior. Purpose: prepare a reviewer-facing summary that matches the implemented and validated story scope.
6. [x] Update `README.md` and `docs/developer-reference.md` so they explicitly list the `DEV-0000050:T01` through `DEV-0000050:T14` manual-validation log markers, where those markers are expected to appear, and how the Manual Playwright-MCP step uses them as proof evidence. Purpose: make the final review handoff explicit about the exact logs reviewers should inspect.
7. [x] Run `npm run lint` from the repository root for repository `codeInfo2`. If it fails, run `npm run lint:fix` first to auto-fix what it can, then run `npm run lint` again, and manually fix any remaining issues in the files changed by this task before moving on.
8. [x] Run `npm run format:check` from the repository root for repository `codeInfo2`. If it fails, run `npm run format` first to auto-fix formatting, then run `npm run format:check` again, and manually fix any remaining formatting issues yourself before moving on.

#### Testing

Use only the checked-in summary-wrapper outputs already produced by Task 15 for this task. Do not attempt to rerun builds or tests without the wrapper. Only open full logs when a wrapper from Task 15 reported failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] Review the saved outputs and any GUI-proof screenshots from Task 15, including the screenshots stored in `playwright-output-local/`, and confirm the documentation and PR summary match the final validated behavior.

#### Implementation notes

- Updated `README.md` with the Story 50 host-network runtime contract, wrapper-first validation sequence, evidence locations, and the full manual proof marker matrix tied to the validated screenshots and wrapper logs.
- Added a final Story 50 close-out section to `design.md` that consolidates the re-ingest request union, intermediate result family, transcript payload shapes, blank-markdown skip seam, host-network runtime split, and final proof flow with Mermaid diagrams.
- Updated `docs/developer-reference.md` with the validated Story 50 port matrix, env-variable meanings, env-file precedence, wrapper usage, evidence paths, and the reviewer-facing `DEV-0000050:T01` through `DEV-0000050:T14` marker checklist.
- Updated `projectStructure.md` with final Story 50 Task 14, Task 15, and Task 16 structural ledgers so the repo map now captures the lint/format gate repair, the validation-marker helper, the PR summary artifact, and the final documentation surfaces touched by close-out.
- Added `planning/0000050-pr-summary.md` as the Story 50 reviewer-facing PR summary covering the re-ingest contract changes, Docker/runtime changes, wrapper additions, validation evidence, and the highest-risk compatibility shifts.
- `README.md` and `docs/developer-reference.md` now both spell out the `DEV-0000050:T01` through `DEV-0000050:T14` proof markers, the expected evidence locations, and how the manual Playwright-MCP pass uses those markers together with the saved screenshots.
- Reviewed the saved Task 15 evidence set while writing the docs: the wrapper outputs under `logs/test-summaries/`, the saved client-summary log from Task 14, the marker helper file, and the screenshots `playwright-output-local/0000050-14-chat-ready.png` plus `playwright-output-local/0000050-14-logs-proof.png` all match the final documentation and PR summary claims.
- Root `npm run lint` passed cleanly after the Task 16 doc edits, so the shared docs and PR summary changes stayed inside the restored repo-quality baseline from Task 14.
- Root `npm run format:check` also passed cleanly after the Task 16 edits, confirming the final markdown/doc updates fit the checked-in formatting contract without another repo-wide format pass.

---

## Questions

- No Further Questions

---

## Code Review Findings

- Review pass `0000050-review-20260321T163857Z-eae3d4fc` reopened this story after the branch-vs-`main` review recorded `1` `must_fix` finding and `2` `should_fix` findings in `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-findings.md`.
- Durable review evidence for this reopen decision lives in `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-evidence.md` and `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-findings.md`. The transient handoff file is not the durable artifact and must not be treated as the story record.
- Finding 1 (`must_fix`): `server/src/ingest/reingestExecution.ts` currently swallows repository-selector operational failures for `sourceId` requests and re-labels them as invalid user input instead of preserving the real outage/error class.
- Finding 2 (`should_fix`): `scripts/docker-compose-with-env.sh` can silently treat docker-host probe startup failures as “port free” instead of failing closed with actionable preflight output.
- Finding 3 (`should_fix`): `docs/developer-reference.md` and `design.md` still describe `CODEINFO_MCP_PORT` as a live final env contract even though the implemented Story 50 end state makes `CODEINFO_CHAT_MCP_PORT` canonical and leaves the legacy fallback disabled in checked-in behavior.
- Follow-up sequencing is explicit: Task 17 fixes the server-side selector failure contract, Task 18 fixes the compose wrapper preflight failure contract, Task 19 repairs the remaining documentation drift, and Task 20 reruns the full story validation after those fixes land.

### Task 17. Surface portable selector operational failures without misclassifying them as invalid input

- Repository Name: `codeInfo2`
- Task Status: **to_do**
- Git Commits: `to_do`

#### Overview

Close review Finding 1 by keeping the portable-selector path honest when repository listing or selector resolution fails for a `sourceId` request. This task is complete when the `sourceId` path in `server/src/ingest/reingestExecution.ts` either resolves a selector successfully or returns a clear operational failure that preserves the real error class and diagnostics, instead of falling back to the raw selector and letting the strict single-repo validator mislabel the outage as `INVALID_SOURCE_ID`. A junior developer should keep the comparison with the already-honest `target: "current"` and `target: "all"` paths visible while working so all target modes report compatible failure classes.

#### Documentation Locations

- Review artifact `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-findings.md`. Use Finding 1 as the exact defect statement and closure target.
- `server/src/mcpCommon/repositorySelector.ts`, `server/src/ingest/reingestExecution.ts`, and `server/src/ingest/reingestService.ts`. Read these together so selector resolution, strict validation, and error-shape expectations stay aligned.
- Existing server unit and integration tests covering re-ingest execution paths under `server/src/test/unit/` and `server/src/test/integration/`. Reuse the closest existing proof seam instead of inventing a second test harness.

#### Subtasks

1. [ ] Re-read review Finding 1, then open `server/src/ingest/reingestExecution.ts`, `server/src/mcpCommon/repositorySelector.ts`, and `server/src/ingest/reingestService.ts` together before editing. Keep the review defect visible while you work: a selector-resolution outage for `sourceId` must not be re-labeled as bad user input.
2. [ ] Update the `sourceId` execution path so a thrown repository-listing or selector-resolution failure is surfaced as an operational/pre-start failure with actionable diagnostics instead of silently falling back to the raw selector. Keep the existing invalid-input behavior only for cases where selector resolution completed honestly and the requested selector still does not map to an ingested repository.
3. [ ] Keep target-mode behavior aligned after the fix. `sourceId`, `current`, and `all` should not report contradictory error classes for the same underlying repository-listing outage, and any resolution log or helper output must not claim a resolved path when resolution actually failed.
4. [ ] Add or update direct server tests that prove all of the following from the checked-in test harness:
   - a valid portable selector still resolves to the canonical container path;
   - an unresolved-but-successful selector lookup still reaches the strict invalid-input validation path;
   - a selector-resolution or repository-listing exception now surfaces the real operational failure instead of `INVALID_SOURCE_ID`;
   - the changed failure path is visible through the normal caller path, not only through a private helper.
5. [ ] If the fix changes any structured error wording, reason code, or caller-visible metadata, update only the caller/test expectations that genuinely represent the corrected contract. Do not widen the public contract beyond what the finding requires.
6. [ ] Record any documentation or close-out delta for Task 20. Do not update shared docs in this task unless a new file is created here.

#### Testing

Use only the checked-in summary wrappers below. Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only if needed. After fixes, rerun full `npm run test:summary:server:unit`.
3. [ ] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands only if needed. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Review disposition seed: this task was added after review pass `0000050-review-20260321T163857Z-eae3d4fc` found that the `sourceId` selector path can currently hide repository-selector operational failures by falling back too early to raw strict validation.

### Task 18. Make docker-host port probing fail closed with actionable preflight output

- Repository Name: `codeInfo2`
- Task Status: **to_do**
- Git Commits: `to_do`

#### Overview

Close review Finding 2 by making the compose wrapper’s docker-host port preflight honest when the helper probe cannot run. This task is complete when `scripts/docker-compose-with-env.sh` no longer treats a failed or unavailable docker-host probe as implicit proof that the checked-in host ports are free, and the checked-in shell harness proves both the happy path and the probe-failure path through the standard wrapper entrypoint. A junior developer should preserve the existing wrapper-first startup contract and fail closed with actionable output rather than adding a hidden fallback that weakens preflight honesty.

#### Documentation Locations

- Review artifact `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-findings.md`. Use Finding 2 as the exact defect statement and closure target.
- `scripts/docker-compose-with-env.sh`, `scripts/test-summary-shell.mjs`, `scripts/test/bats/docker-compose-with-env.bats`, and the shell-harness fixtures under `scripts/test/bats/fixtures/`. Read these together so the wrapper logic, the summary-wrapper entrypoint, and the deterministic probe simulations stay aligned.
- Story sections for the earlier host-network wrapper tasks in this plan. Reuse the existing wrapper and shell harness instead of inventing a second compose launcher or a second shell test path.

#### Subtasks

1. [ ] Re-read review Finding 2 and the existing Task 9 through Task 12 wrapper notes before editing `scripts/docker-compose-with-env.sh`. Keep the closure target visible while working: a broken docker-host probe must not silently degrade into a passing host-port preflight.
2. [ ] Update `is_port_occupied()` and any related preflight helpers so the docker-host branch distinguishes between “port free,” “port occupied,” and “probe unavailable or failed.” If the docker-host probe cannot run, stop startup with actionable output that names the compose context or failing probe cause instead of implicitly continuing.
3. [ ] Keep the wrapper-first contract honest after the change. Do not add a fallback that only works through a non-default manual invocation, and do not weaken the existing occupied-port, host-network-shape, or compose pass-through behavior that earlier tasks already proved.
4. [ ] Extend `scripts/test/bats/docker-compose-with-env.bats` and any deterministic fixture binaries/config needed under `scripts/test/bats/fixtures/` so the checked-in shell harness proves at least:
   - the existing happy-path docker-host probe still succeeds when the probe launches;
   - a missing or failed probe image now causes a clear preflight failure instead of an implicit pass;
   - the failure output stays actionable for operators and still names the affected compose file or probe surface.
5. [ ] Keep the change scoped to the checked-in wrapper and shell-harness path. If another unchanged launcher or selector controls this code path, open it and confirm the standard `npm run compose:*` entrypoints still execute the fixed behavior without manual overrides.
6. [ ] Record any later documentation delta for Task 20. Do not update shared docs in this task unless a new file is created here.

#### Testing

Use only the checked-in summary wrappers below. Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run test:summary:shell` If `failed > 0`, inspect the exact log path printed by the summary under `logs/test-summaries/`, then diagnose with wrapper-supported targeted args only if needed. After fixes, rerun full `npm run test:summary:shell`.

#### Implementation notes

- Review disposition seed: this task was added after review pass `0000050-review-20260321T163857Z-eae3d4fc` found that the docker-host probe branch can currently return a raw probe-launch failure to the caller, which the wrapper then treats as “port not occupied” instead of a fail-fast preflight error.

### Task 19. Correct the remaining MCP env-name documentation drift from Story 0000050

- Repository Name: `codeInfo2`
- Task Status: **to_do**
- Git Commits: `to_do`

#### Overview

Close review Finding 3 by making the final Story 50 docs describe the same MCP env contract that the implemented runtime now uses. This task is complete when the final checked-in docs stop telling operators to use `CODEINFO_MCP_PORT` as the active dedicated chat MCP contract, and the Story 50 documentation instead consistently presents `CODEINFO_CHAT_MCP_PORT` as the canonical env name while only mentioning any legacy fallback as historical context when that context is truly needed. A junior developer should treat this as a documentation-contract correction, not as a code-change task.

#### Documentation Locations

- Review artifact `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-findings.md`. Use Finding 3 as the exact defect statement and closure target.
- `docs/developer-reference.md`, `design.md`, and any other Story 50 docs already changed by Task 16. Read these together so the final env-name vocabulary is consistent across operator and design surfaces.
- The validated runtime/config code and Task 15 marker notes proving `legacyFallbackUsed: false`. Keep the docs aligned with the checked-in implementation instead of re-introducing a legacy contract in prose.

#### Subtasks

1. [ ] Re-read review Finding 3 and search the Story 50 documentation surfaces for `CODEINFO_MCP_PORT` and `CODEINFO_CHAT_MCP_PORT` before editing. Capture the exact files/lines being corrected in the implementation notes.
2. [ ] Update `docs/developer-reference.md` so it no longer describes `CODEINFO_MCP_PORT` as the active dedicated MCP env contract. Keep the final wording aligned with the checked-in runtime behavior and the Story 50 port matrix.
3. [ ] Update `design.md` so the architecture description uses the same final env-name vocabulary as the implemented runtime and the developer reference.
4. [ ] If any other already-changed Story 50 doc still repeats the obsolete env name as an active contract, correct it in this task. Do not broaden this into a general documentation sweep outside the Story 50 surfaces already touched by the story.
5. [ ] Re-check the final wording against the Task 15/16 proof notes so the docs do not imply that the legacy env fallback is still the recommended path.

#### Testing

This task is documentation-only. Do not attempt to run tests without using the wrapper. No standalone app-level suite is required here; Task 20 owns the full wrapper-first regression pass after these wording fixes land.

1. [ ] No standalone wrapper run is required in this task because it only corrects Story 50 documentation wording. Verify the wording change directly in the edited docs, then rely on Task 20 for the full wrapper-first regression pass.

#### Implementation notes

- Review disposition seed: this task was added after review pass `0000050-review-20260321T163857Z-eae3d4fc` found that the final Story 50 docs still advertised `CODEINFO_MCP_PORT` as a live final contract even though the code and proof markers had already moved the canonical dedicated MCP env name to `CODEINFO_CHAT_MCP_PORT`.

### Task 20. Re-run final validation after the code review fixes

- Repository Name: `codeInfo2`
- Task Status: **to_do**
- Git Commits: `to_do`

#### Overview

Revalidate Story 0000050 after the code review fixes from Tasks 17 through 19 land. This task is complete when the story once again has a full wrapper-first validation pass, the review findings are explicitly closed with direct proof, and the acceptance criteria remain satisfied after the follow-up fixes. A junior developer should treat this as the new final gate for the story and should not mark the story complete again until this task is honestly finished.

#### Documentation Locations

- Active plan sections `## Description`, `## Acceptance Criteria`, `## Out Of Scope`, `## Traceability And Proof Pass`, `## Final Validation`, and `## Code Review Findings`. Re-read these before starting so the revalidation covers both the original story contract and the review-driven fixes.
- Durable review artifacts `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-evidence.md` and `codeInfoStatus/reviews/0000050-review-20260321T163857Z-eae3d4fc-findings.md`. Use these to confirm each finding is closed with direct proof where possible.
- The wrapper-first build, test, compose, and proof locations already used earlier in Story 50. Reuse those exact checked-in entrypoints instead of inventing alternate validation paths.

#### Subtasks

1. [ ] Re-read the story description, acceptance criteria, out-of-scope notes, traceability proof pass, final validation section, and the new `## Code Review Findings` section before running anything. Keep both the original story contract and the review-fix closure criteria visible while you work.
2. [ ] Re-run the wrapper-first build and test paths listed in this task and record the saved-output paths that close-out notes and reviewers should inspect. Use the same wrapper-first rule as earlier Story 50 validation: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.
3. [ ] Prove each review finding is now closed with direct evidence where the checked-in harness allows it:
   - Finding 1: direct server test proof that selector-resolution outages are surfaced honestly instead of being re-labeled as `INVALID_SOURCE_ID`;
   - Finding 2: direct shell-harness proof that docker-host probe failures fail closed with actionable output;
   - Finding 3: direct documentation proof that the final Story 50 docs now present `CODEINFO_CHAT_MCP_PORT` as the canonical contract.
4. [ ] After `npm run compose:up` starts the main stack in this task, run `npm run test:summary:host-network:main` and re-check the final host-visible runtime behavior against the acceptance criteria and earlier Task 15 proof seams.
5. [ ] Use Playwright MCP tools against `http://host.docker.internal:5001` to repeat the manual regression checks needed for Story 50 completion, confirm the required log markers still appear for the exercised paths, and save updated GUI-proof screenshots only if the existing Task 15 screenshots no longer match the final behavior.
6. [ ] Re-check the acceptance-criteria proof sources and residual-risk areas recorded in the review artifacts. If any proof remains indirect or missing after the review-fix work, document that explicitly in the implementation notes instead of implying exhaustive proof.
7. [ ] Record any final close-out delta needed after the review-fix revalidation. Do not update shared docs in this task unless a new file is created here.

#### Testing

Use only the checked-in summary wrappers and wrapper-first commands below for this task. Do not attempt to run builds or tests without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:server` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands only if needed. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands only if needed. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:shell` If `failed > 0`, inspect the exact log path printed by the summary under `logs/test-summaries/`, then diagnose with wrapper-supported targeted args only if needed. After fixes, rerun full `npm run test:summary:shell`.
6. [ ] `npm run test:summary:client` If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands only if needed. After fixes, rerun full `npm run test:summary:client`.
7. [ ] `npm run test:summary:e2e` Allow up to 7 minutes. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands only if needed. After fixes, rerun full `npm run test:summary:e2e`.
8. [ ] `npm run compose:build:summary` If status is `failed`, or item counts indicate failures or unknown states in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing targets.
9. [ ] `npm run compose:up`
10. [ ] `npm run test:summary:host-network:main` If status is `failed` or the summary reports ambiguous counts, inspect `logs/test-summaries/host-network-main-latest.log` before retrying.
11. [ ] Use the Playwright MCP tools against `http://host.docker.internal:5001` to manually confirm Story 50 behavior and review-fix closure from the running stack, including a check that there are no logged errors in the debug console and that the expected Story 50 proof markers remain visible for the exercised paths.
12. [ ] `npm run compose:down`

#### Implementation notes

- Review disposition seed: this task was added as the new story-completion gate because review pass `0000050-review-20260321T163857Z-eae3d4fc` found one `must_fix` defect and two `should_fix` defects after the story had previously been marked complete. Story 50 is not complete again until this task closes those findings and re-proves the acceptance criteria.
