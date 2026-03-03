# Story 0000040 - Command Step Start, Chat Config Defaults, and Flow Command Resolution

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

This story introduces five related improvements for agent workflows and chat defaults:

1. On the `AGENTS` page, users must be able to run a command from a selected step instead of always starting from step 1.
2. Chat defaults currently controlled by environment variables (for example sandbox mode, approval policy, reasoning effort, and default model) should instead come from `codex/chat/config.toml`, so the server can return one canonical default set and the client can initialize from those values.
3. If `codex/chat/config.toml` is missing, the server should ensure a usable default is generated during startup/bootstrap.
4. Upgrade `@openai/codex-sdk` to the latest stable version.
5. Investigate and reproduce an issue where flows in a repository appear unable to resolve commands in that same repository, while direct command execution from the GUI can still work.

Expected end-user outcome:

- Command reruns are faster and less repetitive because users can resume from a chosen step.
- Chat defaults are more predictable across REST chat and MCP chat because they come from one config source (`codex/chat/config.toml`).
- Startup behavior is more reliable because missing chat config is handled automatically.
- Flow-command behavior is clarified with either a verified fix or a documented, reproducible usage pattern.

### Acceptance Criteria

1. `AGENTS` command execution supports a selectable start step after command selection.
2. Start-step UX is clear and prevents invalid selections (for example, out-of-range step numbers).
3. Command execution request semantics clearly define how start-step is transmitted and validated.
4. Chat default values used by server responses and chat execution are sourced from `codex/chat/config.toml` defaults rather than environment-variable defaults.
5. MCP chat paths use the same default source policy as REST chat for Codex options.
6. If `codex/chat/config.toml` is missing at startup/initialization, a default file is created (without overwriting an existing file).
7. Deprecated web-search config usage is replaced with currently valid config usage and covered by tests.
8. `@openai/codex-sdk` is upgraded to latest stable and compatibility/regression checks are completed.
9. Flow command lookup behavior for repository-scoped flows is investigated with a concrete reproduction path and outcome.
10. Story output includes either:
- a bug fix with acceptance tests, or
- a validated usage correction with clear example and documentation updates.

### Out Of Scope

- Redesigning full command authoring format beyond start-step execution support.
- Replacing existing flow JSON schema with a new DSL.
- Introducing new chat providers beyond current Codex/LM Studio behavior.
- Broad refactors unrelated to start-step execution, config-default sourcing, or flow-command resolution.

### Questions

1. Start-step indexing: should the UI show and accept steps as `1..N` (human readable), and should backend payloads also be `1..N`, or internal `0..N-1`?
2. Start-step behavior with dependencies: if earlier steps produce context required by later steps, should execution fail with a clear error, or should such commands be marked as non-resumable?
3. Start-step scope: should this be `AGENTS` page only for this story, or also `Flows` and any MCP command-run path in the same release?
4. Default selection behavior: when a command is selected, should the default start step be first step, last-used step, or explicit empty/unselected requiring user choice?
5. Chat default precedence: when both request payload values and `codex/chat/config.toml` defaults exist, confirm precedence as `request value > chat config default`, with env defaults removed for these fields.
6. Missing `codex/chat/config.toml`: should creation copy from `codex/config.toml` if available, or generate a dedicated chat template as first choice?
7. Web search replacement target: should this story normalize to top-level `web_search = "live"` (legacy `true` parity) or to `"cached"` for safer default behavior?
8. Codex SDK upgrade policy: should we pin exact latest (`0.107.0` as of 2026-03-03) or allow range-based updates?
9. Flow command resolution expectation: when a flow is loaded from a repository source, should command lookup resolve against that same repository's agent command files by default?
10. Investigation deliverable: do you want this story to require an automated failing test first (red-green), or is a reproducible manual scenario plus fix acceptable?

### Research Findings (2026-03-03)

- Current server chat default resolution is env-driven (`Codex_*`, `CHAT_DEFAULT_MODEL`, etc.) in capability/validation paths.
- Runtime config support already exists for `codex/chat/config.toml`, including bootstrap behavior that can copy base config when missing.
- Runtime config normalization currently supports legacy aliases and canonical `web_search` modes (`live|cached|disabled`).
- Flow execution supports repository-sourced flow files, but command validation/loading is agent-discovery based and appears to resolve commands from discovered agent homes only.
- Latest npm stable for `@openai/codex-sdk` is `0.107.0` (from npm registry on 2026-03-03).
- OpenAI Codex config reference currently marks `features.web_search_request` as deprecated in favor of top-level `web_search`.

