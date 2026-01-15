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

---

## Acceptance Criteria

- `server/.env` defines `Codex_model_list` (CSV) containing every currently hard-coded Codex model plus the new `gpt-5.2-codex` entry.
- The Codex model list returned by `GET /chat/models?provider=codex` is driven by a CSV server env value (with safe fallback to a built-in default list when the env value is missing or invalid).
- `server/.env` defines default Codex flags via environment variables: `Codex_sandbox_mode`, `Codex_approval_policy`, `Codex_reasoning_effort`, `Codex_network_access_enabled`, `Codex_web_search_enabled`.
- The server uses these env defaults when Codex requests omit flags, and preserves per-request overrides when they are supplied.
- The env values in `server/.env` match the current hard-coded defaults **except** sandbox mode, which defaults to `danger-full-access`.
- Any validation/logging for invalid env values is explicit and uses existing server logging patterns (no silent misconfiguration), and warnings are surfaced on the chat page UI.
- CSV parsing trims whitespace and ignores empty entries; invalid entries trigger warning + fallback to built-in defaults.
- User-facing docs that describe Codex defaults are updated if the defaults change (e.g., `design.md`, `README.md` as appropriate).
- Client defaults are removed; Codex flags UI is driven by server-provided defaults (documented approach; ensure UI behavior stays consistent).

---

## Out Of Scope

- Changes to how Codex agents load their defaults from `codex_agents/*/config.toml` (agents stay config-driven).
- Changing the UI controls or layout for Codex flags.
- Removing any currently supported Codex models from the list.
- Introducing per-user or per-session configuration beyond the existing request payload.

---

## Questions


---
