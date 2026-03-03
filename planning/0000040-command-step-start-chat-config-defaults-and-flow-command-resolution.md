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

Decisions confirmed for this story:

- Start-step selection uses `1..N` in both UI and API payloads, with server-side validation.
- Start-step scope is `AGENTS` page command execution only.
- Default start step is always step `1` when a command is selected.
- Dependency analysis between command steps is out of scope for this story; users can pick any valid step.
- Chat defaults use precedence `request override > codex/chat/config.toml`, replacing env-default sourcing for these fields.
- Codex default model source is `codex/chat/config.toml` (`model`), replacing `CHAT_DEFAULT_MODEL` for Codex default model selection, while users can still override model in the GUI per request.
- For missing Codex default fields, fallback precedence is `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`, and server warnings are emitted whenever legacy env fallback is used.
- Missing `codex/chat/config.toml` bootstraps by copying `codex/config.toml` first, then generating standard template if base config is missing.
- Deprecated web search alias handling is normalized to canonical `web_search` with default `"live"` parity.
- `@openai/codex-sdk` is pinned to `0.107.0`.
- Flow command lookup for repository-sourced flows resolves in this order: same source repository first, then the codeInfo2 repository, then other repositories by first match where "first" means source label alphabetical ascending, tie-broken by full source path alphabetical ascending.
- Flow command fallback to codeInfo2/other repositories occurs only for command-not-found cases; if same-source command exists but is schema-invalid, resolution fails fast without fallback.
- Investigation output must include an automated failing repro test and a fix.

Expected end-user outcome:

- Command reruns are faster and less repetitive because users can resume from a chosen step.
- Chat defaults are more predictable across REST chat and MCP chat because they come from one config source (`codex/chat/config.toml`).
- Startup behavior is more reliable because missing chat config is handled automatically.
- Flow-command behavior is clarified with either a verified fix or a documented, reproducible usage pattern.

### Acceptance Criteria

1. `AGENTS` command execution supports a selectable start step after command selection.
2. Start-step selector uses `1..N` values in the UI and sends `1..N` in API payloads.
3. Server validates start-step range and rejects invalid values with clear request validation errors.
4. Start-step defaults to `1` whenever a command is selected.
5. Start-step execution is in scope only for `AGENTS` page command runs.
6. Command-step dependency inference/enforcement is not introduced in this story; users may execute from any valid selected step.
7. Chat default values used by server responses and chat execution are sourced from `codex/chat/config.toml` defaults rather than env-default resolution for these fields.
8. Chat default precedence is `request override > codex/chat/config.toml`.
9. Codex default model selection uses `codex/chat/config.toml` `model` value instead of `CHAT_DEFAULT_MODEL`, while GUI/request-level model override behavior remains unchanged.
10. When Codex default fields are missing in `codex/chat/config.toml`, fallback precedence is `request override > codex/chat/config.toml > legacy env defaults > hardcoded safe fallback`.
11. Server emits warnings when legacy env fallback is used for missing chat-config defaults.
12. MCP chat interface uses the same default source policy and precedence as REST chat for Codex options.
13. If `codex/chat/config.toml` is missing, bootstrap copies `codex/config.toml`; if base config is missing, a standard template is generated; existing chat config is never overwritten.
14. Deprecated `web_search_request` usage is replaced by canonical `web_search`, with default behavior aligned to `"live"` parity and regression-tested.
15. `@openai/codex-sdk` is upgraded and pinned to `0.107.0`, with compatibility/regression checks completed.
16. Flow command lookup for repository-scoped flows resolves commands in this order: same source repository, then codeInfo2 repository, then first matching command in other repositories.
17. Deterministic fallback ordering for "other repositories" is source label alphabetical ascending, with tie-break by full source path alphabetical ascending.
18. Cross-repository fallback is applied only when command is not found; same-source schema-invalid command files fail fast and do not trigger fallback resolution.
19. Investigation and fix follow red-green: automated failing repro test first, then fix, then passing verification.

### Out Of Scope

- Redesigning full command authoring format beyond start-step execution support.
- Replacing existing flow JSON schema with a new DSL.
- Introducing new chat providers beyond current Codex/LM Studio behavior.
- Start-step controls for Flows page or non-Agents command execution surfaces.
- Broad refactors unrelated to start-step execution, config-default sourcing, or flow-command resolution.

### Interface Draft (Web GUI)

This section defines concrete UI behavior for the unresolved interface requirements in this story.

#### A. AGENTS page - command start-step interaction

Primary user outcome:
- A user can re-run a command from a chosen step quickly without editing command files or re-running all prior steps.

Layout proposal:
- Keep controls in the existing command action row on `AgentsPage`.
- Row order (desktop): `Command` select -> `Start step` select -> command info icon -> `Execute command` button.
- Row order (mobile): stack into one column in the same visual order.

Control behavior:
- `Start step` is a single-select dropdown (`1..N`) and is always visible in the command row.
- Before command selection, `Start step` is disabled with placeholder text (for example `Select command first`).
- Default selected value is always `1` on command selection and on command change.
- Step options are rendered as readable labels: `Step 1`, `Step 2`, ... `Step N`.
- Command dropdown includes step-count preview in option secondary text when available (for example `build_release` + `6 steps`).
- If command metadata is loading, start-step remains disabled.
- If command is invalid/disabled, start-step remains disabled and execution remains disabled.
- If command has only one step, start-step remains visible and disabled with `Step 1` selected.

Execution behavior:
- Clicking `Execute command` sends selected `startStep` as `1..N` in the command-run payload.
- Existing run locks, persistence checks, and websocket readiness checks remain unchanged and still gate execution.

Validation and feedback:
- Invalid step requests (out of range, malformed) surface as inline error feedback in the command area.
- Command row should preserve existing warning notes (Mongo persistence and websocket requirement).
- If backend rejects start-step, the user should see a specific message tied to that command run attempt.
- Start-step validation feedback uses inline row-level `Alert` (no snackbar for this path).

Accessibility and keyboard behavior:
- `Start step` select must have a visible label and be keyboard navigable.
- Tab order follows the visual sequence in the row.
- Disabled states are announced by native control semantics (MUI/HTML disabled behavior).

Responsive behavior:
- On small screens, controls stack with full-width selects and fixed-width action buttons dropped to full-width.
- No horizontal overflow in the command row at common mobile widths.

Viability checks:
- Current row structure and disabled-state patterns in `client/src/pages/AgentsPage.tsx` support adding one more `FormControl + Select` without changing overall flow ownership.
- Existing API contract in `client/src/api/agents.ts` and `server/src/routes/agentsCommands.ts` requires extension to carry/validate `startStep`.

#### B. Chat page - defaults and warnings presentation

Primary user outcome:
- Chat settings open with expected defaults from `codex/chat/config.toml`, while still allowing manual override in GUI.

UI behavior:
- Existing `CodexFlagsPanel` remains the editing surface for sandbox/approval/reasoning/network/web-search controls.
- Existing warnings banner remains the display surface for server warnings.
- Add/continue warning text for env fallback usage so migration status is visible without blocking user actions.
- Env-fallback warning banner is shown on every load while fallback is active.

State behavior:
- Initial flag values come from server-provided defaults (no client-side env assumptions).
- User can still override values in the current session before sending a message.
- Warning display is informational; it should not disable controls by itself.

Viability checks:
- Chat already consumes `codexDefaults` and `codexWarnings` and renders a warnings banner in `client/src/pages/ChatPage.tsx`.
- Existing initialization logic and gating (`codexDefaultsReady`) can support the new fallback-source semantics without introducing new panel components.

#### C. Flow command resolution - UX surface expectation

Primary user outcome:
- When a command cannot run due to invalid same-source command file, users get a clear, actionable error instead of silent fallback behavior.

UI behavior expectation:
- Flow run errors for schema-invalid same-source commands should be surfaced as explicit run failure messages.
- Error text should include enough context to identify the failing command and source location label.
- Error wording should be operator-first with optional technical suffix (for example: `Command file invalid for selected source` + `schema validation failed`).

Viability checks:
- Existing flow/chat transcript already renders warning/error bubbles, so this requirement can be satisfied through improved server error detail and existing UI surfaces.

### Questions

None.

### Research Findings (2026-03-03)

- Current server chat default resolution is env-driven (`Codex_*`, `CHAT_DEFAULT_MODEL`, etc.) in capability/validation paths.
- Runtime config support already exists for `codex/chat/config.toml`, including bootstrap behavior that can copy base config when missing.
- Runtime config normalization currently supports legacy aliases and canonical `web_search` modes (`live|cached|disabled`).
- Flow execution supports repository-sourced flow files, but command validation/loading is agent-discovery based and appears to resolve commands from discovered agent homes only.
- Latest npm stable for `@openai/codex-sdk` is `0.107.0` (from npm registry on 2026-03-03).
- OpenAI Codex config reference currently marks `features.web_search_request` as deprecated in favor of top-level `web_search`.
