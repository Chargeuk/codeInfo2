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

We want a consistent, user-friendly re-login flow that works for **Chat**, **Agents**, **Flows**, and any command-driven agent run. The UI should always offer a **device-auth login** action so users can re-authenticate proactively without relying on error detection. Clicking the action opens a centered dialog that guides the user through device-auth and shows the verification URL + code. The dialog includes a selector for which agent or chat session is being authenticated; it should default based on where the dialog was opened, but allow changing it. After successful login, the user can retry the run without leaving the UI.

This story does **not** add new business features; it only improves how the system recovers from expired Codex credentials.

---

## Acceptance Criteria

- A **Re-authenticate (device auth)** action is always available on Chat, Agents, and Flows pages whenever Codex is in use (not only after failures).
- Clicking the action opens a centered dialog that drives device-auth and exposes a selector for which agent or chat session is being authenticated.
- The dialog defaults the target to the current page (Chat or the selected Agent/Flow), but allows the user to change it before starting device-auth.
- A user can trigger device-auth login from the dialog, and the server responds with the verification URL and code.
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

- None.

---

## Documentation Locations (for later tasks)

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Node child_process (spawning CLI): https://nodejs.org/api/child_process.html
- Express route handlers: Context7 `/expressjs/express/v5.1.0`
- MUI Alert/Banner + Button patterns: MUI MCP

---

## Implementation Ideas (high-level)

- **Device-auth endpoint:** Add a server endpoint to run `codex login --device-auth`, capture stdout for the verification URL + code, and return them as JSON. Support a `codexHome` override so agents can re-auth their own home (and chat uses the main home).
- **UI action:** Add a shared “Re-authenticate (device auth)” control on Chat/Agents/Flows pages that is always visible for Codex runs (and still show failure messaging when `CODEX_AUTH_EXPIRED` is received).
- **Dialog flow:** Implement a reusable centered dialog component that manages the device-auth steps (idle → requested → code shown → user confirms complete/error). The dialog owns its status state rather than using a global timestamp.
- **Target selection:** Include a selector in the dialog for Chat vs specific Agent home; default to the page context but allow switching before issuing the login request.
- **Retry flow:** Keep the request payload/flags available so a user can click “Retry” after re-auth completes; do not auto-retry.
- **Telemetry/logging:** Add a log marker to confirm auth-expired detection and device-auth flow start/finish.

---

## Message Contracts & Storage Shapes (planned)

- **Device-auth start response (HTTP):** `{ status: "started", verificationUrl: string, userCode: string, expiresInSec?: number, codexHome?: string }`.
- **No DB schema changes:** auth state remains in Codex `auth.json` and existing config paths.

---

## Edge Cases and Failure Modes

- Device-auth is not enabled in ChatGPT settings → endpoint returns an actionable error.
- Codex CLI not found or exits non-zero → surface a distinct error code so UI can display “Codex unavailable.”
- Auth error appears mid-run → run fails as it does today; user can re-auth via the always-available dialog.
- Multiple concurrent requests trigger device-auth → allow it (no rate-limit), but ensure dialog messaging is clear.
- Agents using alternate `codexHome` are supported (device-auth endpoint accepts an override).

---

## Implementation Plan

Tasks will be added later once the open questions are resolved.
