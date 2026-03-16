# Story 0000049 – Portable Reingest Selectors Current All Targets And Playwright MCP Host Networking

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Command JSON files and flow JSON files already support a dedicated re-ingest action, but the current contract is too tied to machine-specific absolute paths. Today a workflow author must usually place an exact ingested repository root path into `sourceId`, which means the same command or flow can stop working when it is copied to another machine, another container layout, or another developer environment.

Users want workflow re-ingest steps to be portable. A workflow should be able to identify a repository by a stable selector such as the repository name or id instead of by a hard-coded absolute path. This story therefore expands the meaning of flow and command re-ingest selectors so that existing path-based configurations keep working, while new machine-portable definitions can use case-insensitive repository names or ids and let the server resolve those to the canonical ingested root.

Users also want two higher-level re-ingest targets that are not currently possible in workflow files.

The first target is the current repository for the currently executing workflow file. In practice that means a re-ingest step should be able to say "re-ingest the repository that owns this flow or command" without hard-coding that repository path. For a top-level flow step this should mean the repository that supplied the flow file. For a direct command run this should mean the repository that supplied the command file. For a command running inside a flow command step this should mean the repository that supplied that command file, not the parent flow file unless they are the same repository.

The second target is all currently ingested repositories. This is useful for maintenance or refresh workflows where the user wants one workflow action to refresh every indexed repository without authoring one step per repository. Because the ingest layer already enforces a global lock, this story should treat "all repositories" as a deterministic sequential operation rather than a parallel fan-out. Existing delta and skipped behavior in the ingest layer should continue to keep no-op repositories relatively cheap, but the story should still assume that "all repositories" means one re-ingest operation per ingested repository in a predictable order.

This story should preserve the current blocking re-ingest semantics. A workflow step should still wait for each re-ingest target to reach a terminal outcome before moving on. Pre-start validation failures should still fail the relevant workflow step early with a clear message. Terminal ingest failures should still be recorded as structured outcomes rather than being silently swallowed.

In addition to the workflow re-ingest work, this story also includes the manual-testing `playwright-mcp` host-networking investigation documented in `future ideas.md`. The local manual-testing stack currently exposes a dedicated `playwright-mcp` container on bridge networking and relies on service-name DNS plus `host.docker.internal`. The user wants this story to research and potentially implement a host-networking-based setup so that the browser launched by Playwright MCP can reach host-published services through `localhost` when that is safer or more reliable for secure-context-sensitive manual testing. This part of the story includes Docker Desktop for Mac research, Compose wiring changes if the approach is viable, and MCP endpoint updates if service-name DNS can no longer be used.

### Acceptance Criteria

- Existing path-based re-ingest steps in commands and flows continue to work.
- Command and flow re-ingest execution can accept a portable repository selector rather than requiring only a machine-specific absolute path.
- The selector logic for command and flow re-ingest is aligned with the existing repository-selector helper already used by MCP surfaces:
  - case-insensitive repository id or name;
  - container path;
  - host path.
- Direct command runs can re-ingest the current repository without the workflow author hard-coding a repository path.
- Top-level flow re-ingest steps can re-ingest the current repository without the workflow author hard-coding a repository path.
- Command items running inside a flow command step can re-ingest the current repository of the executing command file rather than implicitly using only the parent flow repository.
- Command and flow re-ingest support an explicit "all repositories" mode.
- "All repositories" mode re-ingests repositories sequentially in a deterministic order and waits for each one to reach a terminal outcome before continuing.
- If a "current repository" target resolves to a repository that is not currently ingested, the step fails fast with a clear pre-start error instead of silently falling back to another repository.
- The low-level single-repository re-ingest service remains the canonical strict container-path execution layer, with selector expansion handled above it.
- Structured re-ingest result recording remains intact for direct commands, dedicated flow re-ingest steps, and command items executed inside flows.
- The plan clearly defines whether duplicate case-insensitive repository ids are allowed to resolve via the current latest-ingest helper behavior or must fail as ambiguous before implementation begins.
- The plan clearly defines how "all repositories" results should be represented in conversation history before implementation begins.
- The manual-testing `playwright-mcp` host-networking work is researched using the scope described in `future ideas.md`.
- The story determines whether the `playwright-mcp` service can reliably use host networking on Docker Desktop for Mac for CodeInfo2 manual testing.
- If the host-networking approach is viable, the local manual-testing stack is updated accordingly, including any required Compose wiring and agent MCP endpoint changes.
- If the host-networking approach is not viable, the story records that outcome clearly with the observed blocker and leaves the existing local manual-testing setup working.

### Out Of Scope

- Replacing the strict single-repository re-ingest execution service with a new multi-repository ingest engine.
- Parallel re-ingest execution for "all repositories".
- General-purpose repository selector changes for every unrelated workflow field in the product unless those fields are required for this story's re-ingest behavior.
- Renaming every existing `sourceId` field across all product surfaces only for terminology cleanup.
- Reworking unrelated workflow step types beyond what is needed to support portable re-ingest selectors, current/all targets, and the resulting runtime metadata.
- Reworking unrelated Playwright MCP behavior outside the manual-testing networking and endpoint concerns captured in `future ideas.md`.
- Reworking the whole Docker networking model for the local stack beyond what is required for the `playwright-mcp` investigation and any resulting targeted implementation.

### Questions

- If multiple ingested repositories share the same case-insensitive repository id, should workflow re-ingest keep the existing helper behavior of selecting the latest ingest, or should workflows fail fast as ambiguous because they are automation artifacts?
- For `target: "all"`, should conversation history record one existing re-ingest tool result per repository, or should the story introduce a new batch result payload to reduce transcript noise?
- For the `playwright-mcp` host-networking work, is the required outcome "investigate and document the decision" or "switch to host networking if the investigation does not uncover a blocker"?

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
- Preserve the existing rule that terminal ingest results are recorded as structured outcomes for commands and flows. Decide explicitly whether `all repositories` should reuse the existing per-repo tool-result shape or introduce a batch payload for transcript clarity.
- Reuse or extract the current MCP canonicalization pattern so command and flow runtime logic matches the behavior already used by the existing MCP re-ingest surfaces.
- Add direct command tests, dedicated flow-step tests, and flow-command nested tests that prove:
  - repo-name selectors work;
  - host-path selectors work when available;
  - current-repository resolution chooses the right owning file;
  - all-repositories mode runs sequentially and records outcomes deterministically;
  - non-ingested `current` repositories fail fast with a clear message.
- For the `playwright-mcp` host-networking investigation, begin with the already captured research in `future ideas.md` and validate it against the checked-in local stack:
  - `docker-compose.local.yml` currently exposes `playwright-mcp` on bridge networking with published port `8931` and `host.docker.internal`;
  - agent configs currently point to `http://playwright-mcp:8931/mcp`;
  - moving only `playwright-mcp` to host networking is the candidate direction, not a whole-stack networking rewrite.
- Validate Docker Desktop for Mac host-networking behavior carefully before changing Compose wiring, especially:
  - how bridged containers in the same project reach a host-networked `playwright-mcp` service;
  - what MCP endpoint agents should use once Docker service-name DNS is no longer available;
  - whether Chrome and Playwright MCP manual-testing traffic remains reliable for websocket, screenshot, and browser-control flows.
- If implementation proceeds, expect likely changes in:
  - `docker-compose.local.yml`;
  - agent MCP config files under `codex_agents/`;
  - any local run or documentation notes that assume the old `http://playwright-mcp:8931/mcp` control endpoint.
