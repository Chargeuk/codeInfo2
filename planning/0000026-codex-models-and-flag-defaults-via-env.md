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

### 1. Server: Codex env defaults helper

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Create a reusable helper that reads Codex default flag values from environment variables, validates them against the existing enums, and produces warnings for invalid values. This task establishes the defaults layer without changing request validation yet.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- Zod schema validation (if used by existing validators): Context7 `/colinhacks/zod`
- @openai/codex-sdk 0.64.0 (ThreadOptions fields used by the server): https://www.npmjs.com/package/@openai/codex-sdk
- TypeScript `as const` + union patterns (reference for enums): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
- Express 5 migration guide (confirm no breaking changes affect routes): https://expressjs.com/en/guide/migrating-5.html
- Mongoose 9 migration guide (confirm no schema/connection changes needed): https://mongoosejs.com/docs/migrating_to_9.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing Codex defaults and env parsing patterns:
   - Documentation to read (repeat):
     - Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/.env`
     - `server/package.json` (confirm `@openai/codex-sdk` 0.64.0 and `@lmstudio/sdk` 1.5.0)
     - `server/src/lmstudio/toolService.ts` (boolean env parsing pattern)
   - Goal:
     - Document the current defaults, enums, and parsing patterns before adding the helper.

2. [ ] Implement a Codex env defaults helper:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to edit:
     - `server/src/config/` (new helper module)
   - Requirements:
     - Read `Codex_sandbox_mode`, `Codex_approval_policy`, `Codex_reasoning_effort`, `Codex_network_access_enabled`, `Codex_web_search_enabled`.
     - Validate each value against the existing enums/boolean shapes.
     - Parse booleans using the same `toLowerCase() === 'true'` pattern used in `server/src/lmstudio/toolService.ts`.
     - Return `{ defaults, warnings }`, where warnings are user-facing strings for invalid env values.
     - Add a warning when `networkAccessEnabled === true` and `sandboxMode !== 'workspace-write'`.

3. [ ] Add unit tests for the helper:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Tests to add/update:
     - New unit tests under `server/src/test/unit/` covering valid/invalid values, boolean parsing, and the network/sandbox warning.

4. [ ] Update server defaults in `server/.env` (flags only):
   - Documentation to read (repeat):
     - Environment variable docs (reference format): https://12factor.net/config
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add the Codex flag defaults with the values from Acceptance Criteria.

5. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

6. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

7. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Purpose: Validate Docker images build cleanly with env defaults helper changes.

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with env defaults helper changes.

5. [ ] Run server unit tests (targeted if available):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Command: `npm run test:unit --workspace server`
   - Purpose: Validate Codex env defaults helper behavior.

#### Implementation notes

- 

---

### 2. Server: Apply env defaults in chat validation

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Wire the new Codex env defaults helper into `validateChatRequest` so Codex requests inherit environment defaults when flags are omitted, while preserving explicit request overrides and existing non-Codex warnings.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current validation behavior:
   - Documentation to read (repeat):
     - TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/test/unit/` (existing validation tests, if any)
   - Goal:
     - Confirm where defaults are injected and where warnings are produced.

2. [ ] Update `validateChatRequest` to use env defaults:
   - Documentation to read (repeat):
     - TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Requirements:
     - Pull defaults from the new helper when provider is `codex` and a flag is missing.
     - Preserve explicit request overrides.
     - Keep LM Studio warning behavior unchanged.

3. [ ] Update validation tests:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Tests to add/update:
     - Unit tests asserting env defaults are applied only when flags are omitted.

4. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

5. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

6. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Purpose: Validate Docker images build cleanly after validation updates.

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts after validation updates.

5. [ ] Run server unit tests (targeted if available):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Command: `npm run test:unit --workspace server`
   - Purpose: Validate Codex env defaults in request validation.

#### Implementation notes

- 

---

### 3. Server: Align ChatInterfaceCodex defaults

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Remove hard-coded Codex defaults from the provider interface so `ChatInterfaceCodex` trusts the validated request flags (or Codex config defaults) without overriding env-driven defaults.

#### Documentation Locations

- @openai/codex-sdk 0.64.0 (ThreadOptions fields used by the server): https://www.npmjs.com/package/@openai/codex-sdk
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current thread options assembly:
   - Documentation to read (repeat):
     - @openai/codex-sdk 0.64.0 (ThreadOptions fields): https://www.npmjs.com/package/@openai/codex-sdk
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/test/integration/chat-codex.test.ts`
   - Goal:
     - Identify where defaults are injected before the Codex SDK call.

2. [ ] Remove hard-coded defaults from thread options:
   - Documentation to read (repeat):
     - @openai/codex-sdk 0.64.0 (ThreadOptions fields): https://www.npmjs.com/package/@openai/codex-sdk
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Use provided `codexFlags` values directly.
     - Leave fields undefined when missing so env defaults from validation are respected.

3. [ ] Update tests covering Codex thread options:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Tests to add/update:
     - Integration/unit tests asserting thread options reflect validated flags and no fallback to old defaults.

4. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

5. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

6. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`

5. [ ] Run server unit tests (targeted if available):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Command: `npm run test:unit --workspace server`

#### Implementation notes

- 

---

### 4. Shared: Codex defaults response types

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Add shared types and fixtures for the new `/chat/models` Codex response fields so the server and client can exchange `codexDefaults` and `codexWarnings` safely.

#### Documentation Locations

- TypeScript type system reference: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review existing shared model response types:
   - Documentation to read (repeat):
     - TypeScript type system reference: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to read:
     - `common/src/lmstudio.ts`
     - `common/src/fixtures/mockModels.ts`

2. [ ] Add Codex defaults response types:
   - Documentation to read (repeat):
     - TypeScript type system reference: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `common/src/lmstudio.ts`
   - Requirements:
     - Add a `CodexDefaults` type and optional `codexDefaults`/`codexWarnings` fields to `ChatModelsResponse`.

3. [ ] Update fixtures and shared mocks:
   - Documentation to read (repeat):
     - TypeScript type system reference: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
   - Files to edit:
     - `common/src/fixtures/mockModels.ts`
   - Requirements:
     - Extend mocks to include Codex response fields where appropriate.

4. [ ] Update tests that consume the shared fixtures:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Files to edit:
     - `server/src/test/steps/chat_models.steps.ts`
     - Any client tests relying on `mockModelsResponse`.

5. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

6. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

7. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`

#### Implementation notes

- 

---

### 5. Server: Codex models response + warnings

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Drive the Codex model list from `Codex_model_list`, extend `/chat/models?provider=codex` to return `codexDefaults`/`codexWarnings`, and add runtime warnings when web search is enabled but tools are unavailable.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- CSV parsing basics (string split/trim patterns): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split
- JSON schema shape guidance (response contracts): https://www.jsonrpc.org/specification
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review Codex models route and MCP availability status:
   - Documentation to read (repeat):
     - Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
   - Files to read:
     - `server/src/routes/chatModels.ts`
     - `server/src/routes/chatProviders.ts`

2. [ ] Extend the Codex env helper for model list parsing:
   - Documentation to read (repeat):
     - CSV parsing basics: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split
   - Files to read:
     - `server/src/ingest/config.ts` (CSV split/trim + Set de-duplication pattern)
   - Files to edit:
     - Codex env helper module from Task 1
   - Requirements:
     - Parse `Codex_model_list` as CSV, trim, drop empties, de-duplicate.
     - Warn and fall back to the built-in list if the parsed list is empty.

3. [ ] Update `/chat/models?provider=codex` response:
   - Documentation to read (repeat):
     - JSON schema shape guidance (response contracts): https://www.jsonrpc.org/specification
   - Files to edit:
     - `server/src/routes/chatModels.ts`
   - Requirements:
     - Use the env-driven model list.
     - Include `codexDefaults` and `codexWarnings` even when Codex is unavailable.
     - Log warnings using existing server logging patterns.

4. [ ] Append runtime warnings when tools are unavailable:
   - Documentation to read (repeat):
     - JSON schema shape guidance (response contracts): https://www.jsonrpc.org/specification
   - Files to edit:
     - `server/src/routes/chatModels.ts`
   - Requirements:
     - If `webSearchEnabled === true` while tools are unavailable, append a warning without mutating the flag.
     - Merge model-list, default, and runtime warnings into `codexWarnings`.

5. [ ] Update server defaults in `server/.env` (model list):
   - Documentation to read (repeat):
     - Environment variable docs (reference format): https://12factor.net/config
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add `Codex_model_list` with the fallback entries plus `gpt-5.2-codex`.

6. [ ] Add/update server tests for the Codex models response:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Tests to add/update:
     - Unit tests asserting env list parsing, warnings, and response fields.
     - Coverage for empty CSV fallback and warning emission (duplicate/unknown entries can be exercised opportunistically).

7. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

8. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

9. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`

5. [ ] Run server unit tests (targeted if available):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Command: `npm run test:unit --workspace server`

#### Implementation notes

- 

---

### 6. Client: Codex defaults consumption + flags init

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Consume `codexDefaults` from `/chat/models` and use them to initialize Codex flag state in the chat UI, including resets on provider changes and new conversations.

#### Documentation Locations

- React state + effects (reference): https://react.dev/reference/react
- React 19 release notes (confirm hook behavior stability): https://react.dev/blog/2024/12/05/react-19
- MUI MCP docs (v6.4.12):
  - Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
  - Accordion https://llms.mui.com/material-ui/6.4.12/components/accordion.md
  - Switch https://llms.mui.com/material-ui/6.4.12/api/switch.md
  - Select https://llms.mui.com/material-ui/6.4.12/api/select.md
- TypeScript discriminated unions (model/provider typing): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current Codex defaults and model hook state:
   - Documentation to read (repeat):
     - React state + effects (reference): https://react.dev/reference/react
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatModel.ts`
     - `common/src/lmstudio.ts`
     - `client/package.json` (confirm React 19.2.0 + MUI 6.4.x)

2. [ ] Add codexDefaults/codexWarnings to the chat model hook:
   - Documentation to read (repeat):
     - TypeScript discriminated unions (model/provider typing): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
   - Files to edit:
     - `client/src/hooks/useChatModel.ts`
   - Requirements:
     - Store the optional `codexDefaults`/`codexWarnings` from the response and expose them to the UI.

3. [ ] Initialize Codex flag state from server defaults:
   - Documentation to read (repeat):
     - React state + effects (reference): https://react.dev/reference/react
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Set initial flag state from `codexDefaults` when provider is Codex.
     - Reset flags to `codexDefaults` on provider switch and **New conversation**.
     - Disable Codex flags panel while defaults are missing.

4. [ ] Update Codex flags labels to avoid hard-coded “default” text:
   - Documentation to read (repeat):
     - MUI MCP docs (v6.4.12):
       - Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
       - Accordion https://llms.mui.com/material-ui/6.4.12/components/accordion.md
       - Switch https://llms.mui.com/material-ui/6.4.12/api/switch.md
       - Select https://llms.mui.com/material-ui/6.4.12/api/select.md
   - Files to edit:
     - `client/src/components/chat/CodexFlagsPanel.tsx`
   - Requirements:
     - Remove hard-coded “(default)” labels or accept default indicators from the parent.

5. [ ] Add/update client tests for defaults initialization:
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Tests to add/update:
     - Chat page tests asserting defaults are sourced from the server response.

6. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

7. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

8. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`

5. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`

#### Implementation notes

- 

---

### 7. Client: Codex payload omission + warnings banner

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Omit unchanged Codex flags from `/chat` payloads and surface `codexWarnings` near the chat controls using existing alert patterns.

#### Documentation Locations

- React state + effects (reference): https://react.dev/reference/react
- MUI MCP docs (v6.4.12): Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
- TypeScript discriminated unions (model/provider typing): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review Codex payload construction:
   - Documentation to read (repeat):
     - React state + effects (reference): https://react.dev/reference/react
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`

2. [ ] Omit unchanged Codex flags from `/chat` payloads:
   - Documentation to read (repeat):
     - TypeScript discriminated unions (model/provider typing): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Compare user-selected flags against `codexDefaults`.
     - Remove hard-coded DEFAULT_* values and rely on passed defaults.
     - If defaults are missing, omit all Codex flags from the payload.

3. [ ] Render `codexWarnings` near chat controls:
   - Documentation to read (repeat):
     - MUI MCP docs (v6.4.12): Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Reuse existing `Alert` layout patterns already used for Codex availability/tooling banners.
     - Clear warnings when the provider is not Codex.

4. [ ] Update client tests for payload omission and warning rendering:
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Tests to add/update:
     - Update mock `/chat/models` responses with `codexDefaults`/`codexWarnings`.
     - Add assertions that unchanged flags are omitted from payloads.

5. [ ] Documentation check - `README.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`

6. [ ] Documentation check - `design.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`

7. [ ] Documentation check - `projectStructure.md` (update only if needed):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`

5. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`

#### Implementation notes

- 

---

### 8. Docs: Codex env defaults updates

- Task Status: **__to_do__**
- Git Commits: 

#### Overview

Update user-facing documentation to describe env-driven Codex models and defaults, plus the new `codexDefaults`/`codexWarnings` response contract.

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
     - Document `Codex_model_list` CSV usage.
     - Update Codex default flag values to match env defaults.

2. [ ] Update `design.md` to reflect server-driven defaults and warnings:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md`
   - Requirements:
     - Update Codex flags panel description to mention server defaults.
     - Update `/chat/models` response documentation to mention `codexDefaults` and `codexWarnings`.

3. [ ] Update `projectStructure.md` if new files were introduced:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `projectStructure.md`

4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`

3. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`

4. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`

#### Implementation notes

- 

---

### 9. Final verification + PR summary

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
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
2. [ ] Build the client
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
3. [ ] perform a clean docker build
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `README.md`
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
   - Document: `design.md`
6. [ ] Ensure projectStructure.md is updated with any updated, added or removed files & folders
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `projectStructure.md`
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Testing

1. [ ] run the client jest tests
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
2. [ ] run the server cucumber tests
   - Documentation to read (repeat):
     - Cucumber guides https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
3. [ ] restart the docker environment
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Commands: `npm run compose:down` then `npm run compose:up`
4. [ ] run the e2e tests
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Command: `npm run e2e`
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here

---
