# Story 0000026 - Codex models and flag defaults via server env

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Right now, the server exposes a fixed list of Codex models and hard-coded default Codex flags (sandbox mode, approval policy, reasoning effort, and network/web-search toggles). That makes it harder to manage or change defaults in different environments without editing code.

We want the available Codex model list to be configurable via server environment variables, and we want the default Codex flags to be configured by environment variables as well. These env defaults should match today’s behavior, except the default sandbox mode should be **danger-full-access**. This change keeps deployments flexible while preserving the existing UI/flow for choosing models and flags.

Current behavior (for reference):

- Codex models are hard-coded in `server/src/routes/chatModels.ts`.
- Server defaults are hard-coded in `server/src/routes/chatValidators.ts` and re-applied in `server/src/chat/interfaces/ChatInterfaceCodex.ts`.
- The client currently hard-codes Codex defaults in `client/src/pages/ChatPage.tsx` and `client/src/hooks/useChatStream.ts`, and always sends them with Codex requests. That means server defaults are effectively bypassed on normal UI usage.

Decisions from Q&A:

- Env var names are the Codex flag label with spaces replaced by underscores, prefixed by `Codex_`, plus `Codex_model_list` for the CSV models list.
- CSV parsing trims whitespace and ignores empty entries.
- Invalid env values must warn + fall back (log + visible warning on the chat page).
- The client should not own defaults; defaults must be driven by the server.
- Server defaults + warnings should be exposed by extending existing endpoints (no new endpoints).
- Defaults/warnings are exposed via `GET /chat/models?provider=codex` as explicit fields: `codexDefaults` (object with `sandboxMode`, `approvalPolicy`, `modelReasoningEffort`, `networkAccessEnabled`, `webSearchEnabled`) and `codexWarnings` (array of strings).

Research notes:

- Codex CLI documents sandbox modes (`read-only`, `workspace-write`, `danger-full-access`) and approval policies (`untrusted`, `on-request`, `on-failure`, `never`) via `--sandbox` and `--ask-for-approval`, and config keys `sandbox_mode` + `approval_policy`.
- Network access is only configurable inside workspace-write mode via `[sandbox_workspace_write] network_access = true` in `config.toml`.
- Web search is enabled either via `--search` or `config.toml` (`[features] web_search_request = true`).
- Upstream docs note a discrepancy about `tools.web_search` vs `features.web_search_request` (Codex CLI warns that `tools.web_search` is deprecated). Treat `--search` / `features.web_search_request` as the canonical path and log if upstream guidance changes.
- Reasoning effort is documented in Codex config as `model_reasoning_effort` with values that include `low`, `medium`, `high` (plus `xhigh` in Codex CLI docs). We keep the app’s existing allowed set unless requirements change.
- For UI warnings: existing WS `stream_warning` events already surface warnings through `useChatStream`, so invalid env warnings can reuse this path rather than inventing a new client state channel.

Implementation Ideas (rough, not tasked):

- Server config parsing:
  - Add a small helper (new module under `server/src/config/` or `server/src/utils/`) that reads `Codex_model_list` and the five `Codex_*` flag env vars, trims CSV items, filters empties, and validates against the same enums in `chatValidators.ts`.
  - Return `{ models, defaults, warnings }` where `warnings` covers invalid env values or empty/invalid CSV entries. Reuse this helper in both `chatModels.ts` and `chatValidators.ts` to avoid drift.
- `GET /chat/models?provider=codex`:
  - Replace the hard-coded Codex model array in `server/src/routes/chatModels.ts` with the helper output (fallback to built-in defaults if env is missing/invalid).
  - Extend the response with `codexDefaults` and `codexWarnings` fields, sourced from the helper, and log warnings via `baseLogger` + `logStore.append`.
  - Update shared types in `common/src/lmstudio.ts` and any fixtures in `common/src/fixtures/mockModels.ts` to include the new fields.
- `/chat` validation and execution:
  - Update `server/src/routes/chatValidators.ts` to use the helper defaults when request flags are missing; continue to respect explicit overrides.
  - If env defaults are invalid, attach warning messages and emit a `stream_warning` (via `publishStreamWarning` in `server/src/ws/server.ts`) so the chat UI shows the issue immediately.
  - Ensure `server/src/chat/interfaces/ChatInterfaceCodex.ts` does not re-apply stale hard-coded defaults; it should rely on validated flags.
- Client defaults and UI:
  - Update `client/src/hooks/useChatModel.ts` to capture `codexDefaults` + `codexWarnings` from `/chat/models` and expose them to `ChatPage`.
  - Remove hard-coded defaults from `client/src/pages/ChatPage.tsx` and `client/src/hooks/useChatStream.ts` so the panel initializes from `codexDefaults` instead.
  - Track whether a user changed each flag; only include changed flags in the `/chat` payload so the server can apply env defaults.
  - Render `codexWarnings` near the chat controls as an Alert; `stream_warning` remains in the transcript (optional secondary display if desired).
- Tests/docs:
  - Update Codex flag tests (`client/src/test/chatPage.flags.*`) to assert defaults come from server responses.
  - Update server integration tests (`server/src/test/integration/chat-codex-mcp.test.ts`) to cover env parsing and defaults.
- Refresh `design.md` / `README.md` to describe env-driven defaults and the new Codex model list.

Message Contracts & Storage Shapes (define up front):

- `GET /chat/models?provider=codex` response contract (`common/src/lmstudio.ts`):
  - Extend `ChatModelsResponse` with two optional fields used only when `provider=codex`:
    - `codexDefaults`: `{ sandboxMode, approvalPolicy, modelReasoningEffort, networkAccessEnabled, webSearchEnabled }`.
    - `codexWarnings`: `string[]` for invalid env/default parsing warnings.
  - No new endpoint; this is an additive response change consumed by the client.
- `POST /chat` request contract remains unchanged; the client will omit unchanged flags so the server applies env defaults.
- WebSocket contracts remain unchanged; reuse existing `stream_warning` events to display any runtime/default warnings in the chat transcript (no new WS event types).
- Storage schema impact:
  - No Mongo schema changes required; `Conversation.flags` already stores a flexible object for Codex flags and can carry the applied defaults.
  - `Turn` schema does not require any additions.
- DeepWiki note: repo is not indexed in DeepWiki yet, so contract verification relied on code inspection + Context7 docs.

---

## Acceptance Criteria

- `server/.env` defines `Codex_model_list` (CSV) containing every currently hard-coded Codex model plus the new `gpt-5.2-codex` entry.
- The Codex model list returned by `GET /chat/models?provider=codex` is driven by a CSV server env value (with safe fallback to a built-in default list when the env value is missing or invalid).
- Built-in fallback model list is explicitly: `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5.1`, `gpt-5.2`, `gpt-5.2-codex`.
- `server/.env` defines default Codex flags via environment variables: `Codex_sandbox_mode`, `Codex_approval_policy`, `Codex_reasoning_effort`, `Codex_network_access_enabled`, `Codex_web_search_enabled`.
- The server uses these env defaults when Codex requests omit flags, and preserves per-request overrides when they are supplied.
- The env values in `server/.env` match these explicit defaults:
  - `Codex_sandbox_mode=danger-full-access`
  - `Codex_approval_policy=on-failure`
  - `Codex_reasoning_effort=high`
  - `Codex_network_access_enabled=true`
  - `Codex_web_search_enabled=true`
- Any validation/logging for invalid env values is explicit and uses existing server logging patterns (no silent misconfiguration), and warnings are surfaced on the chat page UI.
- CSV parsing trims whitespace and ignores empty entries; if no valid model keys remain after trimming, warn and fall back to the built-in list.
- User-facing docs that describe Codex defaults are updated if the defaults change (e.g., `design.md`, `README.md` as appropriate).
- `GET /chat/models?provider=codex` returns `codexDefaults` + `codexWarnings`, and the client uses these to initialize the Codex flags panel (no client-side hard-coded defaults).
- If the user never changes a Codex flag, the client omits that flag from the `/chat` payload so the server applies env defaults; only user overrides are sent.
- Invalid env values produce a visible warning on the chat page (e.g., an Alert near the chat controls), in addition to server logs.

---

## Out Of Scope

- Changes to how Codex agents load their defaults from `codex_agents/*/config.toml` (agents stay config-driven).
- Changing the UI controls or layout for Codex flags.
- Removing any currently supported Codex models from the list.
- Introducing per-user or per-session configuration beyond the existing request payload.

---

## Questions


---
