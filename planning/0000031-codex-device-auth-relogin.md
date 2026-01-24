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
- Successful device-auth writes updated credentials to the selected target only:  
  - Target = `chat`: update the server Codex home **and** copy `auth.json` into **all** agent homes.  
  - Target = `agent`: update only the selected agent’s Codex home (no changes to the server Codex home).
- Subsequent agent runs (direct message, command, or flow step) use the updated auth without manual container access.
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

- None.

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

## Implementation Ideas

- **Server endpoint (new):** Add `POST /codex/device-auth` under `server/src/routes` (new router or in `chat.ts`) that validates `{ target: "chat" | "agent", agentName? }`, resolves the Codex home via `server/src/config/codexConfig.ts`, and spawns `codex login --device-auth` with `CODEX_HOME` set to that home.
- **Stdout parsing:** Capture CLI **stdout** and parse the verification URL + user code from the device-auth prompt (no JSON output available) before returning `{ status, verificationUrl, userCode, expiresInSec?, target, agentName? }`.
- **Credential storage policy:** Before running login, ensure `cli_auth_credentials_store = "file"` in the target Codex `config.toml` so `auth.json` is written in containers; if the config cannot be written, return a clear error that auth cannot be persisted.
- **Detection refresh:** After login, refresh `CodexDetection` in `server/src/providers/codexRegistry.ts` (and any `codexAvailability` helpers) so `/chat/providers` reports Codex available without a restart.
- **Agent propagation:** If target is `chat`, call `server/src/agents/authSeed.ts` to copy the updated `auth.json` into every agent home; if target is `agent`, update only that agent home.
- **Client API helper:** Add a small client API wrapper for `POST /codex/device-auth` and error shapes alongside existing fetch helpers (`client/src/api/*`).
- **Dialog component:** Create a reusable `CodexDeviceAuthDialog` (e.g., `client/src/components/codex/`) using MUI Dialog patterns (similar to `DirectoryPickerDialog`) with target selector, start button, loading state, and success/error panel.
- **Chat integration:** In `client/src/pages/ChatPage.tsx`, show the **Re-authenticate (device auth)** action only when `useChatModel` provider is Codex and `available=true`; wire the dialog to default target `Chat`.
- **Agents integration:** In `client/src/pages/AgentsPage.tsx`, show the action only when an agent is selected and Codex is available; populate the target selector with agents from `/agents` and default to the selected agent.
- **Flows behavior:** No Flows-page UI changes (out of scope), but server-side auth propagation should cover flow steps that run via agents.
- **UX messaging:** On failure, surface a clear error; when device-auth is disabled, include the text “Enable device code login in ChatGPT settings” (no link).
- **Tests (outline):** Extend existing chat/agents page tests to assert button visibility and dialog flow; add a server route unit/integration test for `POST /codex/device-auth` using a stubbed CLI invocation.

---

## Message Contracts & Storage Shapes

- **New request (HTTP):** `POST /codex/device-auth` body `{ target: "chat" | "agent", agentName?: string }`.
- **New response (HTTP 200):** `{ status: "completed", verificationUrl: string, userCode: string, expiresInSec?: number, target: "chat" | "agent", agentName?: string }`.
- **Existing provider contracts:** keep `/chat/providers` and `/chat/models` shapes unchanged (`ChatProviderInfo`, `ChatModelsResponse`), so Codex availability still uses `available`, `toolsAvailable`, and `reason` fields.
- **Streaming contracts:** no new WS event types; device-auth is a normal HTTP call and chat/agent streams continue to use existing event shapes.
- **Storage shapes:** no Mongo changes; credentials are written to `auth.json` under the resolved Codex home because `cli_auth_credentials_store = "file"` is enforced for this flow.

---

## Edge Cases and Failure Modes

- Device-auth is not enabled in ChatGPT settings → endpoint returns an actionable error in the dialog and includes “Enable device code login in ChatGPT settings”.
- `config.toml` cannot be updated to `cli_auth_credentials_store = "file"` → return an error stating credentials cannot be persisted.
- Codex CLI not found or exits non-zero → surface a distinct error code so UI can display “Codex unavailable.”
- Auth error appears mid-run → run fails as it does today; user can re-auth via the always-available dialog.
- Multiple concurrent requests trigger device-auth → allow it (no rate-limit), but ensure dialog messaging is clear.
- Agents using alternate Codex homes are supported (device-auth endpoint resolves them internally).

---

## Implementation Plan

Tasks will be added later once this plan is approved.
