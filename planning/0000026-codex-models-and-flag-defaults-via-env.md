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
  - `codexWarnings` should be an empty array when there are no warnings; omit `codexDefaults`/`codexWarnings` entirely for non-codex providers.
  - Example (codex provider):
    ```json
    {
      "provider": "codex",
      "available": true,
      "toolsAvailable": true,
      "models": ["..."],
      "codexDefaults": {
        "sandboxMode": "danger-full-access",
        "approvalPolicy": "on-failure",
        "modelReasoningEffort": "high",
        "networkAccessEnabled": true,
        "webSearchEnabled": true
      },
      "codexWarnings": []
    }
    ```

Edge Cases and Failure Modes:

- `Codex_model_list` set but only contains commas/whitespace → treat as invalid, warn, fall back to built-in list.
- `Codex_model_list` contains duplicates → de-duplicate in order of first appearance; warn only if all entries become invalid.
- `Codex_model_list` contains unknown model keys → keep them (no validation against remote model catalog); warn only if list is empty after trimming.
- Any `Codex_*` env flag has an invalid value (wrong enum/boolean) → warn + fall back to explicit defaults.
- `Codex_network_access_enabled=true` while `Codex_sandbox_mode` is not `workspace-write` → still pass flag through but warn that upstream Codex may ignore it.
- `Codex_web_search_enabled=true` when Codex CLI tooling is unavailable → surface warning but keep flag so requests remain consistent.
- Client loads before `/chat/models` completes → keep controls disabled/placeholder defaults until `codexDefaults` arrives; avoid sending default flags until user explicitly changes values.
- User switches provider away from Codex and back → rehydrate defaults from latest `codexDefaults` response; discard stale local overrides.
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

- None.

---

# Implementation Plan

## Instructions

These instructions will be followed during implementation.

# Tasks

### 1. Server: Codex env defaults parsing + request defaulting

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Add a single, reusable server helper that reads Codex default flags from environment variables, validates them against existing enums, and provides a warning list for invalid values. Wire the helper into chat request validation so Codex requests without flags inherit the env defaults while explicit request overrides continue to win.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- Zod schema validation (if used by existing validators): Context7 `/colinhacks/zod`
- TypeScript `as const` + union patterns (reference for enums): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing Codex defaults and validation flow:
   - Documentation to read (repeat):
     - Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/.env`
     - `server/src/lmstudio/toolService.ts` (boolean env parsing pattern)
   - Goal:
     - Identify current hard-coded defaults and where flags are re-applied.

2. [ ] Add a Codex env defaults helper with validation and warnings:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to edit:
     - `server/src/config/` (new helper module)
   - Requirements:
     - Read `Codex_sandbox_mode`, `Codex_approval_policy`, `Codex_reasoning_effort`, `Codex_network_access_enabled`, `Codex_web_search_enabled`.
     - Validate each value against the existing enums/boolean shapes.
     - Parse boolean env values using the same `toLowerCase() === 'true'` pattern used in `server/src/lmstudio/toolService.ts`.
     - Return `{ defaults, warnings }`, where warnings contain human-readable messages for invalid env values.
     - If an env value is invalid, fall back to the built-in default from the acceptance criteria.
     - Add a warning when `networkAccessEnabled === true` and `sandboxMode !== 'workspace-write'` (flag still passes through).

3. [ ] Apply env defaults during chat request validation (Codex only):
   - Documentation to read (repeat):
     - TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Requirements:
     - When a Codex request omits a flag, inject the env default from the helper.
     - When the request includes a flag, preserve the request value as-is.
     - Keep non-Codex providers unchanged.

4. [ ] Remove or align Codex defaults inside the Codex chat interface:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Stop re-applying hard-coded defaults in the interface layer.
     - Ensure the interface trusts `chatValidators` outputs (including env defaults).

5. [ ] Add/update unit tests for env defaults and fallback behavior:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Tests to add/update:
     - New or updated unit tests under `server/src/test/unit/` to cover valid/invalid env values and fallback defaults.
     - Include a test for the `networkAccessEnabled` + non-`workspace-write` warning.
     - Include tests for boolean parsing (`true`/`false`) and invalid boolean strings.

6. [ ] Update server defaults in `server/.env`:
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add the Codex flag defaults with the values from Acceptance Criteria.

7. [ ] Documentation check - `README.md`:
   - Document: `README.md`
   - Requirement: Confirm whether any Codex defaults listed in the README need to be updated; update if required.

8. [ ] Documentation check - `design.md`:
   - Document: `design.md`
   - Requirement: Confirm whether Codex defaults or environment configuration notes need updating; update if required.

9. [ ] Documentation check - `projectStructure.md`:
   - Document: `projectStructure.md`
   - Requirement: Confirm whether any new config/helper files require structure updates.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with env defaults changes.

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with env defaults changes.

5. [ ] Run server unit tests (targeted if available):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Command: `npm run test:unit --workspace server`
   - Purpose: Validate Codex env default parsing in isolation.

#### Implementation notes

- 

---

### 2. Server: Codex model list + defaults/warnings response

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Drive the Codex model list from a CSV environment variable and extend the Codex `/chat/models` response with `codexDefaults` and `codexWarnings`. This exposes server-driven defaults and warning messages to the client without adding new endpoints.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- CSV parsing basics (string split/trim patterns): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split
- JSON schema shape guidance (response contracts): https://www.jsonrpc.org/specification
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review Codex model list handling and chat models response:
   - Documentation to read (repeat):
     - Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
   - Files to read:
     - `server/src/routes/chatModels.ts`
     - `common/src/lmstudio.ts`
     - `common/src/fixtures/mockModels.ts`
   - Goal:
     - Identify the current hard-coded model list and response shape.

2. [ ] Add env-driven Codex model list parsing (CSV + fallback):
   - Documentation to read (repeat):
     - CSV parsing basics: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split
   - Files to read:
     - `server/src/ingest/config.ts` (CSV split/trim + Set de-duplication pattern)
   - Files to edit:
     - Codex env helper module added in Task 1
   - Requirements:
     - Read `Codex_model_list` as a CSV, trim whitespace, drop empty entries, and de-duplicate in first-seen order.
     - Mirror the CSV split/trim/filter + `Set` de-duplication pattern in `server/src/ingest/config.ts` for consistency.
     - If the final list is empty, add a warning and fall back to the built-in list from Acceptance Criteria.

3. [ ] Extend `/chat/models?provider=codex` response:
   - Files to edit:
     - `server/src/routes/chatModels.ts`
   - Requirements:
     - Use the env model list from the helper.
     - Include `codexDefaults` and `codexWarnings` in the Codex response only.
     - Log warnings when present using the existing server logging patterns.
     - Return `codexDefaults`/`codexWarnings` even when Codex is unavailable so the UI can still display env warnings.

4. [ ] Add runtime warnings to the Codex warnings list:
   - Files to read:
     - `server/src/routes/chatModels.ts`
     - `server/src/routes/chatProviders.ts`
   - Requirements:
     - If `webSearchEnabled === true` while Codex tools are unavailable, append a warning (keep the flag unchanged).
     - Ensure `codexWarnings` merges model-list warnings and default-flag warnings with any runtime warnings.

5. [ ] Update shared types and fixtures for the new response shape:
   - Files to edit:
     - `common/src/lmstudio.ts`
     - `common/src/fixtures/mockModels.ts`
   - Requirements:
     - Add optional `codexDefaults`/`codexWarnings` fields to the models response type.
     - Add a shared `CodexDefaults` type for `sandboxMode`, `approvalPolicy`, `modelReasoningEffort`, `networkAccessEnabled`, `webSearchEnabled`.
     - Ensure fixtures include these fields for Codex provider mocks.

6. [ ] Add/update tests for the Codex models response shape:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Tests to add/update:
     - Server unit tests under `server/src/test/unit/` that assert env list parsing and response fields.
     - Include a test that the runtime warning is appended when tools are unavailable.
     - Add coverage for duplicate/unknown CSV entries and empty CSV fallback.

7. [ ] Update server defaults in `server/.env` with `Codex_model_list`:
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Include the CSV model list with the fallback entries plus `gpt-5.2-codex`.

8. [ ] Documentation check - `README.md`:
   - Document: `README.md`
   - Requirement: Confirm whether the Codex model list or defaults need updates; update if required.

9. [ ] Documentation check - `design.md`:
   - Document: `design.md`
   - Requirement: Confirm whether `/chat/models` response docs need updating; update if required.

10. [ ] Documentation check - `projectStructure.md`:
   - Document: `projectStructure.md`
   - Requirement: Confirm whether any new files need to be listed.

11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with Codex models response changes.

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with Codex models response changes.

5. [ ] Run server unit tests (targeted if available):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Command: `npm run test:unit --workspace server`
   - Purpose: Validate the Codex models response shape and warnings.

#### Implementation notes

- 

---

### 3. Client: Server-driven Codex defaults + warnings + override-only payloads

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Update the client to consume `codexDefaults` and `codexWarnings` from the server, initialize the Codex flags panel from those defaults, surface warnings near the controls, and omit unchanged flags from `/chat` payloads so server defaults are applied.

#### Documentation Locations

- React state + effects (reference): https://react.dev/reference/react
- MUI MCP docs: Alert, Accordion, Switch, Select (for warning and flags UI)
- TypeScript discriminated unions (model/provider typing): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current client Codex defaults and payload logic:
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatModels.ts` (or equivalent models hook)
     - `common/src/lmstudio.ts`
   - Goal:
     - Identify where hard-coded defaults and Codex payload flags are applied.

2. [ ] Update client types and model hooks to accept `codexDefaults` + `codexWarnings`:
   - Documentation to read (repeat):
     - TypeScript narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
   - Files to edit:
     - `common/src/lmstudio.ts`
     - `client/src/hooks/useChatModel.ts`
   - Requirements:
     - Plumb the optional fields through to the hook result so the UI can access them.

3. [ ] Initialize Codex flags panel from server defaults and reset on provider changes:
   - Documentation to read (repeat):
     - React state + effects: https://react.dev/reference/react
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/chat/CodexFlagsPanel.tsx` (if needed)
   - Requirements:
     - Use `codexDefaults` from the server response as the source of truth.
     - When provider switches away and back to Codex, rehydrate defaults from the latest server response.
     - While `codexDefaults` is missing, keep Codex flag controls disabled and do not send defaults.
     - Ensure **New conversation** resets flags to `codexDefaults` instead of hard-coded values.
     - Update default labels in `CodexFlagsPanel` to reflect the server-provided defaults (or remove hard-coded “(default)” labels).

4. [ ] Omit unchanged Codex flags from `/chat` payloads:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Compare user-selected flags against `codexDefaults`.
     - Only include flags in the request body when they differ from defaults.
     - Preserve current behavior for LM Studio.
     - If defaults are not loaded, omit all Codex flags from the payload.
     - Remove `useChatStream` hard-coded DEFAULT_* values and rely on passed defaults.

5. [ ] Surface `codexWarnings` in the chat controls:
   - Documentation to read (repeat):
     - MUI MCP docs: Alert
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Reuse the existing `Alert` layout patterns already used for Codex availability/tooling banners.
     - Render warnings near the provider/model controls when `codexWarnings` is non-empty.
     - Use existing warning banner styling patterns.
     - Clear warnings when the provider is not Codex.

6. [ ] Add/update client tests for defaults and payload omission:
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Tests to add/update:
     - Chat page tests to assert defaults are sourced from the server response.
     - Hook or API tests to assert unchanged flags are omitted from payloads.
     - Update `client/src/test/setupTests.ts` and Codex flag tests to include `codexDefaults`/`codexWarnings` in mock `/chat/models` responses.

7. [ ] Documentation check - `README.md`:
   - Document: `README.md`
   - Requirement: Confirm whether client-facing Codex default notes need to be updated; update if required.

8. [ ] Documentation check - `design.md`:
   - Document: `design.md`
   - Requirement: Confirm whether the Codex flags panel description needs updates; update if required.

9. [ ] Documentation check - `projectStructure.md`:
   - Document: `projectStructure.md`
   - Requirement: Confirm whether any new client files need to be listed.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with client Codex defaults changes.

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with client Codex defaults changes.

5. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate Codex defaults initialization and payload behavior.

#### Implementation notes

- 

---

### 4. Docs: Codex env defaults + models list updates

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Update user-facing documentation to describe the env-driven Codex model list and default flag behavior, ensuring the README and design notes accurately reflect the new server-driven defaults and warnings path.

#### Documentation Locations

- Markdown syntax: https://www.markdownguide.org/basic-syntax/
- Mermaid docs (if diagrams change): Context7 `/mermaid-js/mermaid`
- Environment variable docs (reference format): https://12factor.net/config
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Update `README.md` with new Codex env defaults and model list:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md`
   - Requirements:
     - Add or update Codex defaults to reflect the env-driven values.
     - Document `Codex_model_list` CSV usage.

2. [ ] Update `design.md` to reflect server-driven defaults and warnings:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Update any Codex flags panel description to show defaults now come from the server.
     - Update `/chat/models` response description to mention `codexDefaults` and `codexWarnings`.

3. [ ] Update `projectStructure.md` if any new files were introduced:
   - Files to edit:
     - `projectStructure.md`
   - Requirements:
     - Add new config/helper/test files to the tree if created in earlier tasks.

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly after documentation updates.

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts after documentation updates.

#### Implementation notes

- 

---

### 5. Final verification + PR summary

- status: **__to_do__**
- Git Commits: **to_do**

#### Overview

The final task must always check against the acceptance criteria of the story. It should perform full clean builds, run the server tests, run the client tests, run the e2e tests, start up the system in docker and use playwright mcp tools to visually check everything is working as expected. screenshots proving this is done should be put into the test-results/screenshots folder. each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot. This task must also ensure that projectStructure.md & design.md is fully up to date. It must also generate a pull request comment based on all changes within the story from all tasks.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] perform a clean docker build
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
6. [ ] Ensure projectStructure.md is updated with any updated, added or removed files & folders
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.

#### Testing

1. [ ] run the client jest tests
2. [ ] run the server cucumber tests
3. [ ] restart the docker environment
4. [ ] run the e2e tests
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here

---
