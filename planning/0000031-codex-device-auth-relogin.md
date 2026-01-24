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

We want a consistent, user-friendly re-login flow that works for **Chat** and **Agents** (including command-driven agent runs). The UI should always offer a **device-auth login** action **when Codex is the selected provider and available**, so users can re-authenticate proactively without relying on error detection. Clicking the action opens a centered dialog that guides the user through device-auth and shows the verification URL + code. The dialog includes a selector for which agent or chat session is being authenticated; it should default based on where the dialog was opened, but allow changing it. After successful login, the user can retry the run without leaving the UI.

This story does **not** add new business features; it only improves how the system recovers from expired Codex credentials.

---

## Acceptance Criteria

- Chat page shows a **Re-authenticate (device auth)** button only when the provider dropdown is set to **Codex** *and* `/chat/providers` reports Codex `available=true`; hide it when the provider is LM Studio or Codex is unavailable.
- Agents page shows the same button only when an agent is selected and Codex is available; Agents continue to use Codex as the provider and do not gain a new provider selector.
- Clicking the button opens a centered modal titled **Codex device auth** with: a target selector (`Chat` or `Agent: <name>`), a **Start device auth** button, and a close action.
- The target selector defaults to the current context (Chat page → `Chat`, Agents page → selected agent) and can be changed before starting.
- On **Start device auth**, the client sends `POST /codex/device-auth` with `{ target: "chat" }` or `{ target: "agent", agentName: "<selected>" }`; the modal shows a loading state and disables inputs until the request finishes.
- On success, the modal displays the `verificationUrl` and `userCode` returned by the server (plus `expiresInSec` if provided) and offers copy actions for both values.
- If the request fails, the modal shows a clear error message and re-enables **Start device auth** so the user can retry.
- Successful device-auth writes updated credentials to the server Codex home (Chat) and the selected agent Codex home; subsequent agent runs (direct message, command, or flow step) use the updated auth without manual container access.
- The dialog never auto-retries a chat/agent run; users manually re-send their message or command after authenticating.
- No LM Studio UI or behavior changes occur; the button and dialog are Codex-only.

---

## Out Of Scope

- Automatic completion of the device-auth browser step (user interaction is still required).
- Changes to Codex CLI internals or custom forks of the Codex CLI.
- New UI flows for API-key authentication.
- Re-authenticate UI on the Flows page.
- Non-Codex auth problems unrelated to refresh-token expiry.
- Detection or special handling of specific Codex auth failure strings (we rely on the always-available re-auth dialog instead).
- Persisting device-auth state in Mongo beyond existing `auth.json` caching.

---

## Questions

- Should we **force** `cli_auth_credentials_store = "file"` in the server + agent Codex configs to guarantee `auth.json`, or should we respect keyring/auto and surface a UX warning when file storage is not available?
- Do we want the dialog to include a short “enable device code login in ChatGPT settings” helper link, or is a plain error message sufficient?

---

## Documentation Locations (for later tasks)

- Codex auth + device auth: https://developers.openai.com/codex/auth
- Codex CLI reference (`codex login`): https://developers.openai.com/codex/cli/reference
- Node child_process (spawning CLI): https://nodejs.org/api/child_process.html
- Express route handlers: Context7 `/expressjs/express/v5.1.0`
- MUI Dialog + Button + Select patterns: MUI MCP

---

## Research Findings (2026-01-24)

- Codex device code login requires enabling device code login in ChatGPT security settings (or workspace admin permissions).
- Codex can store credentials in `auth.json` under `CODEX_HOME` **or** in the OS keyring; `cli_auth_credentials_store` controls `file`, `keyring`, or `auto` behavior.
- `codex login --device-auth` prints the verification URL + user code to **stdout** and does not provide JSON/machine-readable output.
- `codex login status` can be used to confirm credentials exist after the flow completes.

---

## Implementation Ideas (high-level)

- **Device-auth endpoint:** Add `POST /codex/device-auth` that runs `codex login --device-auth` and returns `{ status, verificationUrl, userCode, expiresInSec?, target }` once the CLI completes. The body should be `{ target: "chat" | "agent", agentName?: string }`, and the server resolves the Codex home (no raw paths from the client).
- **Capture login output:** Parse the device-auth prompt from **stdout** (no JSON output available) to extract `verificationUrl` and `userCode` for the UI.
- **Credential storage:** Ensure the Codex home used by the server/agent is configured with `cli_auth_credentials_store = "file"` so `auth.json` is written and can be copied to agent homes; otherwise document/handle keyring-only storage.
- **UI action visibility:** Add a shared “Re-authenticate (device auth)” control on Chat and Agents pages that is shown **only** when Codex is the selected provider and Codex is available; hide it otherwise.
- **Dialog flow:** Implement a reusable centered dialog component that manages the device-auth steps (idle → in-flight → success/error). While the request is in flight, show a spinner; on success, show verification URL + code (with copy buttons) and a toast.
- **Target selection:** Include a selector in the dialog for Chat vs specific Agent home; default to the page context but allow switching before issuing the login request.
- **Telemetry/logging:** Add structured logs for start/success/error with target info and duration.

---

## Message Contracts & Storage Shapes (planned)

- **Device-auth response (HTTP):** `{ status: "completed", verificationUrl: string, userCode: string, expiresInSec?: number, target: "chat" | "agent", agentName?: string }`.
- **No DB schema changes:** auth state remains in Codex `auth.json` and existing config paths.

---

## Edge Cases and Failure Modes

- Device-auth is not enabled in ChatGPT settings → endpoint returns an actionable error in the dialog and suggests enabling device code login.
- `cli_auth_credentials_store` set to `keyring`/`auto` in a container without keyring support → login succeeds but `auth.json` is not written; decide whether to force `file` or display instructions.
- Codex CLI not found or exits non-zero → surface a distinct error code so UI can display “Codex unavailable.”
- Auth error appears mid-run → run fails as it does today; user can re-auth via the always-available dialog.
- Multiple concurrent requests trigger device-auth → allow it (no rate-limit), but ensure dialog messaging is clear.
- Agents using alternate Codex homes are supported (device-auth endpoint resolves them internally).

---

## Implementation Plan

Tasks will be added later once the open questions are resolved.
