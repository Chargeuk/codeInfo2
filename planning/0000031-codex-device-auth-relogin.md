# Story 0000031 - Codex device-auth re-login flow

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, when Codex auth expires inside the server container, requests fail with an error like “Your access token could not be refreshed because your refresh token was already used.” The UI surfaces the failure but provides no way to re-authenticate without logging into the container manually or copying a fresh `auth.json`. This makes the web UI feel broken when tokens expire, especially for agents, commands, or flow runs that use the Codex CLI under the hood.

We want a consistent, user-friendly re-login flow that works for **Chat**, **Agents**, **Flows**, and any command-driven agent run. The UI should always offer a **device-auth login** action (not only after failures) so users can re-authenticate proactively. The server should start the device-auth flow and return the URL + one-time code so the user can complete the login in a browser. After successful login, the user can retry the run without leaving the UI.

This story does **not** add new business features; it only improves how the system recovers from expired Codex credentials.

---

## Acceptance Criteria

- The server detects the Codex “refresh token already used” auth failure and maps it to a stable error code (e.g. `CODEX_AUTH_EXPIRED`).
- The error code propagates to all realtime WS flows (Chat, Agents, Flows, command runs) so the UI can react consistently when failures do occur.
- A **Re-authenticate (device auth)** action is always available on Chat, Agents, and Flows pages whenever Codex is in use (not only after failures).
- A user can trigger device-auth login from the UI, and the server responds with the verification URL and code.
- The device-auth login flow writes updated credentials into the Codex home used by the server container and by each agent’s Codex home.
- After device-auth completes, the UI can retry the run without manual container access (manual retry only; no auto-retry).
- The solution works when the agent is run via a direct message, a command, or a flow step.
- The feature is gated for Codex-only paths and does not affect LM Studio runs.

---

## Out Of Scope

- Automatic completion of the device-auth browser step (user interaction is still required).
- Changes to Codex CLI internals or custom forks of the Codex CLI.
- New UI flows for API-key authentication.
- Non-Codex auth problems unrelated to refresh-token expiry.
- Persisting device-auth state in Mongo beyond existing `auth.json` caching.

---

## Questions

- How should the UI behave when multiple simultaneous runs fail with auth-expired (single banner vs. per-run messaging)?
- Where should the device-auth response be stored on the client (per-tab vs. shared/global state)?
- Should the device-auth flow expose a “last started at” timestamp to avoid confusion if users click it repeatedly?

---

## Documentation Locations (for later tasks)

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Node child_process (spawning CLI): https://nodejs.org/api/child_process.html
- Express route handlers: Context7 `/expressjs/express/v5.1.0`
- MUI Alert/Banner + Button patterns: MUI MCP

---

## Implementation Ideas (high-level)

- **Server error mapping:** Detect the specific “refresh token already used” error string and map it to `CODEX_AUTH_EXPIRED` inside `ChatInterfaceCodex` or `chatStreamBridge` so all paths see the same code.
- **WS payloads:** Ensure `turn_final.error.code` includes `CODEX_AUTH_EXPIRED` for all Codex runs (Chat, Agents, Flows, Commands).
- **Device-auth endpoint:** Add a server endpoint to run `codex login --device-auth`, capture stdout for the verification URL + code, and return them as JSON. Support a `codexHome` override so agents can re-auth their own home.
- **UI action:** Add a shared “Re-authenticate (device auth)” control on Chat/Agents/Flows pages that is always visible for Codex runs (and still show failure messaging when `CODEX_AUTH_EXPIRED` is received).
- **Retry flow:** Keep the request payload/flags available so a user can click “Retry” after re-auth completes; do not auto-retry.
- **Telemetry/logging:** Add a log marker to confirm auth-expired detection and device-auth flow start/finish.

---

## Message Contracts & Storage Shapes (planned)

- **WS `turn_final` error payload:** `{ code: "CODEX_AUTH_EXPIRED", message: "..." }` when the known refresh-token error is detected.
- **Device-auth start response (HTTP):** `{ status: "started", verificationUrl: string, userCode: string, expiresInSec?: number, codexHome?: string }`.
- **No DB schema changes:** auth state remains in Codex `auth.json` and existing config paths.

---

## Edge Cases and Failure Modes

- Device-auth is not enabled in ChatGPT settings → endpoint returns an actionable error.
- Codex CLI not found or exits non-zero → surface a distinct error code so UI can display “Codex unavailable.”
- Auth error appears mid-run → run fails cleanly and yields the auth-expired code without partial confusion.
- Multiple concurrent requests trigger device-auth → allow it (no rate-limit), but ensure UI messaging is clear.
- Agents using alternate `codexHome` are supported (device-auth endpoint accepts an override).

---

## Implementation Plan

Tasks will be added later once the open questions are resolved.
