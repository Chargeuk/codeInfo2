# Story 0000049 – Portable Reingest Selectors Current All Targets And Playwright MCP Host Networking

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

This story should preserve the current blocking re-ingest semantics. A workflow step should still wait for each re-ingest target to reach a terminal outcome before moving on. Pre-start validation failures should still fail the relevant workflow step early with a clear message. Terminal ingest failures should still be recorded as structured outcomes rather than being silently swallowed.

In addition to the workflow re-ingest work, this story also includes an explicit host-networking implementation for the manual-testing `playwright-mcp` container behavior described in `future ideas.md`. The local stack currently exposes Playwright MCP through bridge networking and relies on service-name DNS plus `host.docker.internal`. The user has now fixed the desired direction for this story: implement host networking for every checked-in Docker Compose file that defines a `playwright-mcp` service, so the browser launched by Playwright MCP can use `localhost` against host-published services.

This host-networking work is not just a one-line Compose change. Docker's host-networking behavior means the service can no longer rely on the current bridge-only wiring assumptions. The story therefore must also plan the supporting changes that make that implementation safe and usable in real workflows:

- remove incompatible bridge-style wiring from each host-networked Playwright MCP service;
- give each Playwright MCP service a deliberate host port strategy so multiple stacks do not clash if run together;
- replace the hard-coded service-DNS MCP endpoint with an explicit environment-aware endpoint configuration for agents or wrappers;
- keep browser navigation targets and agent control-channel endpoints as separate concerns rather than assuming they are the same URL.

Repository research also clarifies an important implementation detail for this part of the story. The current Context7 API-key behavior is not driven by built-in TOML environment interpolation. Instead, the product reads a literal placeholder in agent `config.toml` and overlays the real value in memory during runtime config normalization. This story should treat Playwright MCP the same way: do not assume generic TOML env interpolation exists for MCP server definitions. If Playwright endpoints need to vary per environment, add an explicit runtime overlay for the Playwright MCP definition rather than relying on unproven config-file interpolation behavior.

Current repository evidence shows that the checked-in Compose files do not all define a Playwright MCP service today. The user has decided that files which do not currently define a `playwright-mcp` service remain out of scope for this story. The story therefore should implement host networking for every checked-in Compose file that already declares a `playwright-mcp` service, without expanding scope into adding new Playwright MCP services to additional Compose environments.

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
- "All repositories" mode records one dedicated batch result payload in conversation history rather than one existing single-repository result per repository.
- If a "current repository" target resolves to a repository that is not currently ingested, the step fails fast with a clear pre-start error instead of silently falling back to another repository.
- The low-level single-repository re-ingest service remains the canonical strict container-path execution layer, with selector expansion handled above it.
- Structured re-ingest result recording remains intact for direct commands, dedicated flow re-ingest steps, and command items executed inside flows.
- Every checked-in Docker Compose file that defines a `playwright-mcp` service is updated to use host networking.
- Compose files that do not currently define a `playwright-mcp` service remain unchanged for this story.
- Each host-networked Playwright MCP service uses a deliberate host port plan so checked-in stacks do not clash when run together.
- The implementation removes any incompatible bridge-style `playwright-mcp` wiring that cannot coexist with host networking.
- Agent or wrapper MCP endpoint configuration is updated so Playwright MCP is no longer hard-coded only as `http://playwright-mcp:8931/mcp`.
- The Playwright MCP endpoint override is implemented through an explicit runtime environment overlay rather than assuming native TOML environment interpolation.
- The story defines one explicit environment variable contract for the Playwright MCP endpoint, with a full URL rather than only a port value, so each Compose file can set the correct control-channel address directly.
- The implementation keeps the browser navigation target and the agent control-channel endpoint conceptually separate where that is required for host-networked manual testing.
- The resulting local manual-testing setup still supports the Playwright MCP traffic patterns used by this product, including browser control, websocket flows, screenshots, and manual UI verification.

### Out Of Scope

- Replacing the strict single-repository re-ingest execution service with a new multi-repository ingest engine.
- Parallel re-ingest execution for "all repositories".
- General-purpose repository selector changes for every unrelated workflow field in the product unless those fields are required for this story's re-ingest behavior.
- Renaming every existing `sourceId` field across all product surfaces only for terminology cleanup.
- Reworking unrelated workflow step types beyond what is needed to support portable re-ingest selectors, current/all targets, and the resulting runtime metadata.
- Reworking unrelated Playwright MCP behavior outside the manual-testing networking, endpoint, and port-management concerns captured in this story.
- Reworking the whole Docker networking model for the local stack beyond what is required for the `playwright-mcp` host-networking implementation.
- Adding brand-new `playwright-mcp` services to Compose files that do not already define one.

### Questions

None currently. Add new planning questions here as they arise.

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

3. Keep Compose files without an existing `playwright-mcp` service out of scope.
   - Question being addressed: Should Compose files that do not currently define a `playwright-mcp` service remain out of scope for the host-networking implementation, or is this story expected to add a Playwright MCP service to those files as well?
   - Why the question matters: this fixes the real size of the Docker and runtime-config work up front and prevents the story from silently expanding into introducing new Playwright services in additional environments.
   - What the answer is: keep them out of scope.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the story tightly focused on converting the existing Playwright MCP surfaces to host networking, which is already a substantial change without also designing new Playwright services for environments that do not currently have one.

## Implementation Ideas

- Reuse the existing repository-selector helper as the shared selector-to-repository resolver. Current research shows it already resolves selectors by:
  - case-insensitive repository id first;
  - then normalized container path;
  - then normalized host path;
  - and it currently picks the latest ingested repository when duplicates match.
- Keep the low-level re-ingest service strict. It should continue to validate and execute a single canonical container path. Add selector expansion and target expansion above that service rather than weakening its validation contract.
- Add a shared orchestration helper for commands and flows that resolves re-ingest targets into one or more canonical repository roots:
  - explicit selector or path;
  - current repository;
  - all repositories.
- For backward compatibility, consider keeping the existing explicit step shape with `sourceId` while broadening the runtime meaning from "absolute path only" to "repository selector or path".
- For the new target modes, consider adding additional step shapes such as:
  - `{ "type": "reingest", "target": "current" }`
  - `{ "type": "reingest", "target": "all" }`
- Direct command runs already know which repository supplied the selected command file through direct-command resolution. Reuse that selected repository path when resolving `current`.
- Top-level flows already track the owning flow repository during flow loading. Reuse that repository identity when resolving `current` for dedicated flow re-ingest steps.
- Flow command execution should carry the selected command-file repository identity through nested command execution so `current` resolves from the command file being executed, not automatically from the parent flow repository.
- For `all repositories`, derive the target set from `listIngestedRepositories()` and sort deterministically before execution so repeated runs are predictable.
- Execute `all repositories` sequentially because the ingest layer already enforces a global lock and current re-ingest is blocking. Any attempt to parallelize would only add contention and complexity.
- Preserve the existing rule that terminal ingest results are recorded as structured outcomes for commands and flows. For `all repositories`, introduce a dedicated batch payload instead of repeating the existing single-repository tool-result shape once per repository in conversation history.
- Reuse or extract the current MCP canonicalization pattern so command and flow runtime logic matches the behavior already used by the existing MCP re-ingest surfaces.
- Add direct command tests, dedicated flow-step tests, and flow-command nested tests that prove:
  - repo-name selectors work;
  - host-path selectors work when available;
  - current-repository resolution chooses the right owning file;
  - all-repositories mode runs sequentially and records outcomes deterministically;
  - non-ingested `current` repositories fail fast with a clear message.
- For the `playwright-mcp` host-networking implementation, use the already captured `future ideas.md` notes only as starting context, not as the final scope. The story should now plan and implement the host-networked end state.
- The current checked-in stacks show that:
  - `docker-compose.yml` defines a `playwright-mcp` service on bridge-style wiring without an explicit published `8931:8931` mapping;
  - `docker-compose.local.yml` defines a `playwright-mcp` service with bridge-style wiring and a published `8931:8931` mapping;
  - agent configs currently point to `http://playwright-mcp:8931/mcp`;
  - not every checked-in Compose file currently defines a `playwright-mcp` service.
- Compose files that do not currently define a `playwright-mcp` service remain out of scope for this story and should not gain a new Playwright MCP service here.
- For each Compose file that declares `playwright-mcp`, implement host networking in a way that also updates the surrounding assumptions:
  - remove incompatible `ports` and `networks` service wiring for that service;
  - remove any `extra_hosts` rules that only existed to support the old bridge-host access path if they are no longer needed;
  - keep the service startup command port aligned with the chosen host port for that stack.
- Introduce a deliberate per-environment Playwright MCP port strategy. If multiple stacks may run together, they must not all try to bind the same host port. The story should therefore either:
  - assign distinct checked-in default ports per stack; or
  - drive the Playwright MCP port from explicit environment configuration with safe defaults.
- Introduce a deliberate per-environment MCP endpoint strategy. Because service-name DNS no longer works the same way for a host-networked service, the story should replace hard-coded `http://playwright-mcp:8931/mcp` assumptions with an explicit configuration path used by agents or wrappers.
- Follow the existing Context7 pattern rather than assuming TOML env interpolation exists. Current repository evidence shows Context7 is overlaid in memory from an environment variable during runtime config normalization, so Playwright should use a matching runtime overlay approach for its endpoint rather than file rewriting or `${ENV_VAR}` syntax assumptions.
- Prefer a full URL environment variable for the Playwright MCP endpoint rather than only a port variable. That gives each Compose file one explicit place to declare the control-channel address it needs, even if host, port, or path differ by environment.
- Keep browser-navigation URLs and agent-control MCP URLs as separate concerns. Host networking is being introduced so the browser launched by Playwright can use `localhost` semantics against host-published applications. That does not automatically mean the agent control channel should use the same URL.
- Validate the implementation through the manual-testing workflows that already depend on Playwright MCP, including screenshot capture and browser-control flows.
- Expect likely changes in:
  - `docker-compose.local.yml`;
  - `docker-compose.yml`;
  - agent MCP config files under `codex_agents/`;
  - any local run or documentation notes that assume the old `http://playwright-mcp:8931/mcp` control endpoint.
