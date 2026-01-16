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
- For UI warnings: `stream_warning` is used only for runtime warnings during active chat streams; env/config warnings should be surfaced via `codexWarnings` on `/chat/models` and shown near the chat controls.

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
  - If env defaults are invalid, attach warning messages to `codexWarnings` in `/chat/models` and log them; do not emit `stream_warning` because these are pre-run configuration issues.
  - Ensure `server/src/chat/interfaces/ChatInterfaceCodex.ts` does not re-apply stale hard-coded defaults; it should rely on validated flags.
- Client defaults and UI:
  - Update `client/src/hooks/useChatModel.ts` to capture `codexDefaults` + `codexWarnings` from `/chat/models` and expose them to `ChatPage`.
  - Remove hard-coded defaults from `client/src/pages/ChatPage.tsx` and `client/src/hooks/useChatStream.ts` so the panel initializes from `codexDefaults` instead.
  - Track whether a user changed each flag; only include changed flags in the `/chat` payload so the server can apply env defaults.
  - Render `codexWarnings` near the chat controls as an Alert; `stream_warning` continues to surface runtime warnings only.
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
- WebSocket contracts remain unchanged; `stream_warning` stays reserved for runtime stream warnings while config warnings remain on `/chat/models`.
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

- Task Status: **__done__**
- Git Commits: 90770a6, b99ef7b

#### Overview

Create a reusable helper that reads Codex default flag values from environment variables, validates them against the existing enums, and produces warnings for invalid values. This task establishes the defaults layer without changing request validation yet.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Environment variable format (12-factor): https://12factor.net/config
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Zod schema validation (if used by existing validators): Context7 `/colinhacks/zod`
- @openai/codex-sdk 0.64.0 (ThreadOptions fields used by the server): https://www.npmjs.com/package/@openai/codex-sdk
- @lmstudio/sdk package reference: https://www.npmjs.com/package/@lmstudio/sdk
- LM Studio JS SDK docs: https://lmstudio.ai/docs/api/sdk
- TypeScript `as const` + union patterns (reference for enums): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
- Express 5 migration guide (confirm no breaking changes affect routes): https://expressjs.com/en/guide/migrating-5.html
- Mongoose 9 migration guide (confirm no schema/connection changes needed): https://mongoosejs.com/docs/migrating_to_9.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options
- Markdown syntax (doc updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [x] Review existing Codex defaults and env parsing patterns:
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
     - Note that `@lmstudio/sdk` is present only in `server/package.json` (no direct imports), so version confirmation is informational.

2. [x] Implement a Codex env defaults helper:
   - Documentation to read (repeat):
     - Zod schema validation: Context7 `/colinhacks/zod`
   - Files to edit:
     - `server/src/config/codexEnvDefaults.ts` (new helper module)
   - Requirements:
     - Export `getCodexEnvDefaults()` returning `{ defaults, warnings }`.
     - Define `CodexDefaults` shape in this module (or import from `@codeinfo2/common` once added).
     - Read `Codex_sandbox_mode`, `Codex_approval_policy`, `Codex_reasoning_effort`, `Codex_network_access_enabled`, `Codex_web_search_enabled`.
     - Validate each value against the existing enums/boolean shapes.
     - Parse booleans using the same `toLowerCase() === 'true'` pattern used in `server/src/lmstudio/toolService.ts`.
     - Return `{ defaults, warnings }`, where warnings are user-facing strings for invalid env values.
     - Add a warning when `networkAccessEnabled === true` and `sandboxMode !== 'workspace-write'`.
     - Reference enums from `server/src/routes/chatValidators.ts` for allowed values.

3. [x] Add unit test: valid env values map into defaults
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/codexEnvDefaults.test.ts` (new test file)
   - Purpose: Ensure valid env values are parsed and reflected in the returned defaults object.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

4. [x] Add unit test: missing env values use built-in defaults (no warnings)
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/codexEnvDefaults.test.ts`
   - Purpose: Confirm unset env values fall back to built-in defaults without emitting warnings.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

5. [x] Add unit test: invalid enum values and empty strings warn + fall back
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/codexEnvDefaults.test.ts`
   - Purpose: Confirm invalid enum values or empty-string envs emit warnings and fall back to built-in defaults.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

6. [x] Add unit test: boolean parsing + invalid boolean handling
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/codexEnvDefaults.test.ts`
   - Purpose: Verify case-insensitive `true`/`false` parsing and warning/fallback on invalid boolean strings.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

7. [x] Add unit test: network access warning outside workspace-write
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/codexEnvDefaults.test.ts`
   - Purpose: Emit a warning when `networkAccessEnabled === true` and `sandboxMode` is not `workspace-write`.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

8. [x] Update server defaults in `server/.env` (flags only):
   - Documentation to read (repeat):
     - Environment variable docs (reference format): https://12factor.net/config
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add the Codex flag defaults with the values from Acceptance Criteria.

9. [x] Update `README.md` if env-default details changed:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Add or adjust Codex flag env defaults and usage notes if this task changes them.
   - Purpose: Keep setup documentation aligned with the env defaults helper behavior.

10. [x] Update `design.md` for env-default architecture changes:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Document the new env defaults helper and warning flow; add/update diagrams as needed.
   - Purpose: Ensure architectural notes and diagrams reflect the new defaults layer.

11. [x] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

12. [x] Add server log line for env defaults resolution:
   - Files to edit:
     - `server/src/config/codexEnvDefaults.ts`
   - Log line to add:
     - `baseLogger.info('[codex-env-defaults] resolved', { defaults, warningsCount: warnings.length })`
   - Expected outcome:
     - Logs once per `/chat/models` fetch and shows `warningsCount: 0` when env values are valid.

13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [x] Manual Playwright-MCP check (http://host.docker.internal:5001): verify the Chat page loads, Codex flags panel still renders with defaults, and the server logs include `[codex-env-defaults] resolved` with `warningsCount: 0`; confirm no errors appear in the browser debug console.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed Codex defaults in `server/src/routes/chatValidators.ts` (sandboxMode `workspace-write`, network/web search `true`, approvalPolicy `on-failure`, reasoning effort `high`) and confirmed `ChatInterfaceCodex` re-applies the same defaults when building thread options.
- Confirmed boolean env parsing pattern in `server/src/lmstudio/toolService.ts` uses `(value ?? '').toLowerCase() === 'true'` and noted `server/package.json` pins `@openai/codex-sdk` 0.64.0 and `@lmstudio/sdk` 1.5.0.
- Added `server/src/config/codexEnvDefaults.ts` to parse Codex env defaults against exported enums, emit user-facing warnings (including the network access + sandboxMode mismatch), and log `[codex-env-defaults] resolved` with warnings count.
- Added `server/src/test/unit/codexEnvDefaults.test.ts` covering valid defaults, missing env fallback, invalid enum/boolean warnings, and network access mismatch warnings.
- Added Codex flag default env vars to `server/.env` with the values specified in the acceptance criteria.
- Updated `README.md` Codex flags panel copy to state defaults come from the `Codex_*` env vars and listed the current default values from `server/.env`.
- Added design notes covering the new Codex env defaults helper and clarified that Codex flags panel defaults are sourced from server env defaults.
- Updated `projectStructure.md` to include the new `server/src/config/codexEnvDefaults.ts` helper and `server/src/test/unit/codexEnvDefaults.test.ts` entry.
- Logged `[codex-env-defaults] resolved` with defaults and warning count inside the env defaults helper.
- Ran `npm run lint --workspaces` (warnings only in existing files) and `npm run format:check --workspaces`, then fixed formatting with `npm run format --workspaces` and re-ran the format check successfully.
- `npm run build --workspace server` succeeded after adjusting the log signature to use the structured `baseLogger.info({ ... }, msg)` form.
- `npm run build --workspace client` completed successfully (Vite chunk size warnings only).
- `npm run test --workspace server` passed (unit + integration; 54 scenarios).
- `npm run test --workspace client` passed; console warnings/errors were emitted by existing tests (logger output + markdown nesting warnings).
- `npm run e2e` completed successfully (compose build/up/test/down; 36 Playwright tests passed).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the docker compose stack successfully (containers healthy).
- Manual Playwright MCP check: `/chat` loaded via http://host.docker.internal:5001, Codex flags panel rendered with defaults, no browser console errors, and `/app/logs/server.1.log` contained `[codex-env-defaults] resolved` with `warningsCount: 0`.
- `npm run compose:down` stopped the compose stack.

---

### 2. Server: Apply env defaults in chat validation

- Task Status: **__done__**
- Git Commits: 8123872, 76b7fc7

#### Overview

Wire the new Codex env defaults helper into `validateChatRequest` so Codex requests inherit environment defaults when flags are omitted, while preserving explicit request overrides and existing non-Codex warnings.

#### Documentation Locations

- Node.js `process.env` reference: https://nodejs.org/api/process.html#processenv
- TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Markdown syntax: https://www.markdownguide.org/basic-syntax/
- Mermaid docs (diagram updates): Context7 `/mermaid-js/mermaid`
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [x] Review current validation behavior:
   - Documentation to read (repeat):
     - TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/test/unit/` (existing validation tests, if any)
   - Goal:
     - Confirm where defaults are injected and where warnings are produced.

2. [x] Update `validateChatRequest` to use env defaults:
   - Documentation to read (repeat):
     - TypeScript literal unions: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Requirements:
     - Import `getCodexEnvDefaults()` from `server/src/config/codexEnvDefaults.ts`.
     - Pull defaults from the new helper when provider is `codex` and a flag is missing.
     - Preserve explicit request overrides.
     - Keep LM Studio warning behavior unchanged.

3. [x] Add unit test: env defaults applied when flags omitted
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatValidators.test.ts` (new test file)
   - Purpose: Ensure env defaults are injected only when Codex flags are missing.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

4. [x] Add unit test: explicit request flags override env defaults
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatValidators.test.ts`
   - Purpose: Confirm explicit request values override env defaults for Codex flags.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

5. [x] Add unit test: non-Codex validation unchanged
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatValidators.test.ts`
   - Purpose: Verify non-Codex requests ignore Codex defaults and preserve existing warning behavior.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

6. [x] Add unit test: non-Codex provider with Codex flags emits warnings
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatValidators.test.ts`
   - Purpose: Ensure Codex-only flags are ignored and warnings are emitted when provider is not Codex.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

7. [x] Update `README.md` if validation behavior changes are user-facing:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Note that Codex request flags default from server env when omitted.
   - Purpose: Keep user-facing docs aligned with request validation behavior.

8. [x] Update `design.md` with validation flow changes + mermaid diagrams:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Update validation flow to show env defaults injection and warning behavior.
   - Purpose: Ensure architecture docs reflect the server-side defaulting logic.

9. [x] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

10. [x] Add server log line when env defaults are applied during validation:
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Log line to add:
     - `baseLogger.info('[codex-validate] applied env defaults', { defaultedFlags })`
   - Expected outcome:
     - `defaultedFlags` lists every flag filled in from env when the request omits Codex flags.

11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [x] Manual Playwright-MCP check (http://host.docker.internal:5001): send a Codex message without changing flags, confirm the request succeeds, and verify the server logs include `[codex-validate] applied env defaults` with all five Codex flags listed; confirm no errors appear in the browser debug console.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed `server/src/routes/chatValidators.ts`; defaults are applied inline per-flag for Codex and warnings are appended when Codex-only flags are supplied to non-Codex providers. No existing `chatValidators` unit tests were found under `server/src/test/unit`.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces`.
- Updated `server/src/routes/chatValidators.ts` to pull Codex defaults from `getCodexEnvDefaults()`, append env warnings for Codex requests, and track which flags were defaulted.
- Re-ran `npm run lint --workspaces` (existing warnings only) and `npm run format:check --workspaces` after the validation update.
- Added `server/src/test/unit/chatValidators.test.ts` covering env defaults, explicit overrides, and non-Codex warning behavior.
- Ran `npm run lint --workspaces` (existing warnings only) and `npm run format:check --workspaces` after adding chat validator tests.
- Updated `README.md` to state that server env defaults apply when Codex flags are omitted.
- Ran `npm run lint --workspaces` (existing warnings only) and `npm run format:check --workspaces` after the README update.
- Updated `design.md` to document validation applying Codex env defaults and the `[codex-validate] applied env defaults` log.
- Ran `npm run lint --workspaces` (existing warnings only) and `npm run format:check --workspaces` after the design update.
- Updated `projectStructure.md` to list `server/src/test/unit/chatValidators.test.ts`.
- Ran `npm run lint --workspaces` (existing warnings only) and `npm run format:check --workspaces` after the project structure update.
- Added `[codex-validate] applied env defaults` logging with `defaultedFlags` in `server/src/routes/chatValidators.ts`.
- Ran `npm run lint --workspaces` (existing warnings only) and `npm run format:check --workspaces` after adding the validation log line.
- `npm run build --workspace server` completed successfully.
- `npm run build --workspace client` completed successfully (Vite chunk size warnings only).
- Updated `server/src/test/integration/chat-codex-mcp.test.ts` to assert Codex defaults via `getCodexEnvDefaults()` instead of hard-coded sandbox values.
- `npm run test --workspace server` passed (unit + integration; 54 scenarios).
- `npm run test --workspace client` passed; existing console logs and markdown nesting warnings were emitted.
- `npm run e2e` completed successfully (33 passed, 3 skipped).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the docker compose stack successfully (containers healthy).
- Manual Playwright MCP check: POSTed a Codex message via http://host.docker.internal:5001, request returned 202, browser console had no errors, and `/app/logs/server.1.log` contained `[codex-validate] applied env defaults` with all five flags listed.
- `npm run compose:down` stopped the docker compose stack.

---

### 3. Server: Align ChatInterfaceCodex defaults

- Task Status: **__done__**
- Git Commits: 64ab263, e46782b

#### Overview

Remove hard-coded Codex defaults from the provider interface so `ChatInterfaceCodex` trusts the validated request flags (or Codex config defaults) without overriding env-driven defaults.

#### Documentation Locations

- @openai/codex-sdk 0.64.0 (ThreadOptions fields used by the server): https://www.npmjs.com/package/@openai/codex-sdk
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Markdown syntax: https://www.markdownguide.org/basic-syntax/
- Mermaid docs (diagram updates): Context7 `/mermaid-js/mermaid`
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [x] Review current thread options assembly:
   - Documentation to read (repeat):
     - @openai/codex-sdk 0.64.0 (ThreadOptions fields): https://www.npmjs.com/package/@openai/codex-sdk
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/test/integration/chat-codex.test.ts`
   - Goal:
     - Identify where defaults are injected before the Codex SDK call.

2. [x] Remove hard-coded defaults from thread options:
   - Documentation to read (repeat):
     - @openai/codex-sdk 0.64.0 (ThreadOptions fields): https://www.npmjs.com/package/@openai/codex-sdk
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Requirements:
     - Remove inline fallbacks like `?? 'workspace-write'` / `?? true` / `?? 'high'`.
     - Use provided `codexFlags` values directly.
     - Leave fields undefined when missing so env defaults from validation are respected.

3. [x] Add test: thread options reflect validated flags
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server integration/unit test
   - Location: `server/src/test/integration/chat-codex.test.ts` (prefer) or new `server/src/test/unit/chatCodexFlags.test.ts`
   - Purpose: Confirm thread options use validated flags and do not inject old defaults.
   - Reference pattern: existing Codex integration tests in `server/src/test/integration/chat-codex.test.ts`.

4. [x] Add test: missing flags stay undefined in thread options
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server integration/unit test
   - Location: `server/src/test/integration/chat-codex.test.ts` (prefer) or new `server/src/test/unit/chatCodexFlags.test.ts`
   - Purpose: Ensure omitted flags remain `undefined` so Codex config/env defaults apply.
   - Reference pattern: existing Codex integration tests in `server/src/test/integration/chat-codex.test.ts`.

5. [x] Update `README.md` if Codex thread option behavior changes are documented:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Clarify that Codex flags come from validated inputs without extra fallback defaults.
   - Purpose: Keep usage notes aligned with Codex execution behavior.

6. [x] Update `design.md` with thread option flow + mermaid diagrams:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Update Codex flow diagrams to remove hard-coded defaults and show validated flags.
   - Purpose: Maintain accurate architecture documentation for Codex execution.

7. [x] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

8. [x] Add server log line for prepared Codex thread options:
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Log line to add:
     - `baseLogger.info('[codex-thread-options] prepared', { threadOptions, undefinedFlags })`
   - Expected outcome:
     - `undefinedFlags` lists any flags intentionally left undefined so Codex env/config defaults apply.

9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [x] Manual Playwright-MCP check (http://host.docker.internal:5001): start a Codex chat with flags untouched, confirm it succeeds, and verify the server logs include `[codex-thread-options] prepared` with expected `undefinedFlags`; confirm no errors in the browser debug console.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed `server/src/chat/interfaces/ChatInterfaceCodex.ts` and `server/src/test/integration/chat-codex.test.ts`; thread options currently default sandbox/network/web/approval/reasoning values and tests only assert workingDirectory/skipGitRepoCheck and resume model.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 1.
- Updated `server/src/chat/interfaces/ChatInterfaceCodex.ts` to pass Codex thread option flags directly without hard-coded fallbacks, leaving missing values undefined for env/config defaults.
- Ran `npm run lint --workspaces` (existing import-order warnings only), `npm run format --workspaces`, and `npm run format:check --workspaces` after completing subtask 2.
- Added unit coverage in `server/src/test/unit/chat-interface-codex.test.ts` to assert Codex thread options receive explicit validated flag values.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 3.
- Added unit coverage in `server/src/test/unit/chat-interface-codex.test.ts` to ensure missing Codex flags remain undefined in thread options.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 4.
- Updated `README.md` to note Codex thread options use validated flags without extra fallback defaults.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 5.
- Updated `design.md` to document validated Codex thread option handling and the new `[codex-thread-options] prepared` log marker.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 6.
- No `projectStructure.md` update needed because Task 3 added no new files or removals.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 7.
- Added `[codex-thread-options] prepared` logging in `server/src/chat/interfaces/ChatInterfaceCodex.ts` with an `undefinedFlags` list for omitted Codex flags.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 8.
- Ran `npm run lint --workspaces` (existing import-order warnings only) and `npm run format:check --workspaces` after completing subtask 9.
- Fixed the `[codex-thread-options] prepared` log call to use the base logger signature `(object, message)` after a server build type error.
- `npm run build --workspace server` completed successfully after the log fix.
- `npm run build --workspace client` completed successfully (Vite chunk size warnings only).
- `npm run test --workspace server` initially timed out, then failed on Chroma connection errors during Cucumber runs; a subsequent run completed successfully after the testcontainers Chroma stack stabilized.
- `npm run test --workspace client` passed with existing console log output during tests.
- `npm run e2e` completed successfully (36 passed).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the docker compose stack successfully.
- Manual Playwright check: sent a Codex chat with flags untouched; chat streamed successfully, `/app/logs/server.1.log` contained `[codex-thread-options] prepared` with `undefinedFlags: []`, and the browser console had no errors.
- `npm run compose:down` stopped the docker compose stack successfully.

---

### 4. Shared: Codex defaults response types

- Task Status: **__in_progress__**
- Git Commits: 

#### Overview

Add shared types and fixtures for the new `/chat/models` Codex response fields so the server and client can exchange `codexDefaults` and `codexWarnings` safely.

#### Documentation Locations

- TypeScript type system reference: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Cucumber guides: https://cucumber.io/docs/guides/
- Jest docs: Context7 `/jestjs/jest`
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Markdown syntax: https://www.markdownguide.org/basic-syntax/
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
     - Keep Codex fields optional so non-codex providers can omit them.

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
   - Test type: server Cucumber step update
   - Location: `server/src/test/steps/chat_models.steps.ts`
   - Description: Update the Cucumber expectation to include `codexDefaults`/`codexWarnings` fields.
   - Purpose: Keep shared-fixture tests aligned with the new response shape (no client usages found).
   - Reference pattern: other Cucumber step assertions in `server/src/test/steps/`.

5. [ ] Update `README.md` if shared response fields are documented:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Add or update `/chat/models` response field documentation for `codexDefaults`/`codexWarnings`.
   - Purpose: Keep API usage docs aligned with shared DTOs.

6. [ ] Update `design.md` if response contract diagrams change:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Update response contract notes/diagrams to include new Codex fields.
   - Purpose: Ensure architecture docs match shared contract changes.

7. [ ] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

8. [ ] Add client log line when `/chat/models` includes Codex defaults:
   - Files to edit:
     - `client/src/hooks/useChatModel.ts`
   - Log line to add:
     - `console.info('[codex-models-response] codexDefaults received', { hasWarnings, codexDefaults })`
   - Expected outcome:
     - Appears once after models load; `hasWarnings` reflects whether `codexWarnings` is non-empty.

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001): open the Chat page, confirm the models list loads, verify the browser debug console includes `[codex-models-response] codexDefaults received` with `hasWarnings: false` (unless warnings are expected), and ensure no console errors appear.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

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
- Environment variable format (12-factor): https://12factor.net/config
- CSV parsing basics (string split/trim patterns): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split
- JSON schema shape guidance (response contracts): https://www.jsonrpc.org/specification
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Markdown syntax: https://www.markdownguide.org/basic-syntax/
- Mermaid docs (diagram updates): Context7 `/mermaid-js/mermaid`
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
     - `server/src/config/codexEnvDefaults.ts`
   - Requirements:
     - Export `getCodexModelList()` (or extend `getCodexEnvDefaults()` to return `{ models, warnings }`).
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
     - Keep existing response fields (`provider`, `available`, `toolsAvailable`, `models`, `reason`) intact.

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

6. [ ] Add unit test: env model list parsing + response fields
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts` (new test file)
   - Purpose: Assert env model list parsing is applied and response includes `codexDefaults`/`codexWarnings`.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

7. [ ] Add unit test: codexDefaults/codexWarnings included when Codex unavailable
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts`
   - Purpose: Ensure `/chat/models?provider=codex` still returns defaults/warnings even when Codex is unavailable.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

8. [ ] Add unit test: defaults warnings propagate into codexWarnings
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts`
   - Purpose: Confirm warnings from invalid env defaults are merged into `codexWarnings`.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

9. [ ] Add unit test: CSV trims, drops empties, de-duplicates
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts`
   - Purpose: Ensure whitespace trimming, empty entry removal, and de-duplication are enforced.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

10. [ ] Add unit test: empty CSV fallback + warning
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts`
   - Purpose: Warn and fall back to the built-in model list when the CSV yields no valid entries.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

11. [ ] Add unit test: runtime warning when web search enabled but tools unavailable
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts`
   - Purpose: Append a warning if `webSearchEnabled` is true while tools are unavailable.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

12. [ ] Add unit test: non-Codex provider omits codexDefaults/codexWarnings
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html
   - Test type: server unit test
   - Location: `server/src/test/unit/chatModels.codex.test.ts`
   - Purpose: Ensure `/chat/models?provider=lmstudio` response does not include Codex-only fields.
   - Reference pattern: `server/src/test/unit/ws-chat-stream.test.ts` (node:test style).

13. [ ] Update `README.md` with model list env details if changed:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Document `Codex_model_list` CSV format and default list updates.
   - Purpose: Keep environment configuration docs aligned with model list behavior.

14. [ ] Update `design.md` with model list response flow + mermaid diagrams:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Add/update response-contract diagrams showing `codexDefaults`/`codexWarnings`.
   - Purpose: Ensure architecture docs reflect the updated `/chat/models` response.

15. [ ] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

16. [ ] Add server log line for Codex model list selection:
   - Files to edit:
     - `server/src/routes/chatModels.ts`
   - Log line to add:
     - `baseLogger.info('[codex-model-list] using env list', { modelCount, fallbackUsed, warningsCount })`
   - Expected outcome:
     - Logs whenever `/chat/models?provider=codex` is called; `fallbackUsed` is `false` when env CSV is valid.

17. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001): verify the Codex model list reflects the env-driven entries, confirm server logs include `[codex-model-list] using env list` with `fallbackUsed: false` and the expected `modelCount`, and ensure no console errors appear.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

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
- Jest docs: Context7 `/jestjs/jest`
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Markdown syntax: https://www.markdownguide.org/basic-syntax/
- Mermaid docs (diagram updates): Context7 `/mermaid-js/mermaid`
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
     - `common/src/lmstudio.ts` (for updated `ChatModelsResponse` fields from Task 4)
   - Requirements:
     - Store the optional `codexDefaults`/`codexWarnings` from the response and expose them to the UI.
     - When provider is not `codex`, ensure `codexDefaults`/`codexWarnings` are `undefined` (do not carry stale data).

3. [ ] Initialize Codex flag state from server defaults:
   - Documentation to read (repeat):
     - React state + effects (reference): https://react.dev/reference/react
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Set initial flag state from `codexDefaults` when provider is Codex.
     - Reset flags to `codexDefaults` on provider switch and **New conversation**.
     - Disable Codex flags panel while defaults are missing.
     - Pass `codexDefaults` into `useChatStream` so payload-diffing can omit unchanged flags (Task 7).

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
     - Remove hard-coded “(default)” labels in `sandboxOptions`, `approvalOptions`, and `reasoningOptions`.
     - If needed, accept a `defaultLabelSuffix` prop from the parent for optional labeling.

5. [ ] Add client test: defaults sourced from server response
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.codexDefaults.test.tsx` (new test file)
   - Purpose: Ensure Codex defaults are initialized from `codexDefaults` in `/chat/models`.
   - Reference pattern: `client/src/test/chatPage.flags.sandbox.default.test.tsx`.

6. [ ] Add client test: defaults re-apply on provider switch
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.codexDefaults.test.tsx`
   - Purpose: Verify Codex defaults re-apply when switching back to the Codex provider.
   - Reference pattern: `client/src/test/chatPage.flags.sandbox.default.test.tsx`.

7. [ ] Add client test: defaults re-apply on new conversation
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.codexDefaults.test.tsx`
   - Purpose: Confirm **New conversation** resets flags to server defaults.
   - Reference pattern: `client/src/test/chatPage.flags.sandbox.default.test.tsx`.

8. [ ] Add client test: Codex flags panel disabled without defaults
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.codexDefaults.test.tsx`
   - Purpose: Ensure the Codex flags panel is disabled when `codexDefaults` are missing.
   - Reference pattern: `client/src/test/chatPage.flags.sandbox.default.test.tsx`.

9. [ ] Update `README.md` if client defaults behavior is documented:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Note that Codex defaults now come from `/chat/models` rather than hard-coded client values.
   - Purpose: Keep user-facing usage docs aligned with server-driven defaults.

10. [ ] Update `design.md` with client defaults flow + mermaid diagrams:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Update UI flow diagrams to show defaults coming from `/chat/models`.
   - Purpose: Keep architecture notes aligned with the new client initialization flow.

11. [ ] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

12. [ ] Add client log lines for default initialization/reset:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Log lines to add:
     - `console.info('[codex-ui-defaults] initialized', { codexDefaults })`
     - `console.info('[codex-ui-defaults] reset', { reason, codexDefaults })`
   - Expected outcome:
     - One `initialized` log on first Codex load, plus `reset` logs on provider change and new conversation.

13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001): confirm Codex defaults load from `/chat/models`, resets occur on provider switch and **New conversation**, and the browser console includes `[codex-ui-defaults] initialized` plus `reset` logs with reasons `provider-change` and `new-conversation`; ensure no console errors appear.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

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
- Jest docs: Context7 `/jestjs/jest`
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- Markdown syntax: https://www.markdownguide.org/basic-syntax/
- Mermaid docs (diagram updates): Context7 `/mermaid-js/mermaid`
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
     - `client/src/pages/ChatPage.tsx` (pass `codexDefaults` into hook)
   - Requirements:
     - Compare user-selected flags against `codexDefaults`.
     - Remove hard-coded DEFAULT_* values and rely on passed defaults.
     - If defaults are missing, omit all Codex flags from the payload.
     - Update the `useChatStream` options signature to accept `codexDefaults` and use it for comparison.

3. [ ] Render `codexWarnings` near chat controls:
   - Documentation to read (repeat):
     - MUI MCP docs (v6.4.12): Alert https://llms.mui.com/material-ui/6.4.12/components/alert.md
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Requirements:
     - Reuse existing `Alert` layout patterns already used for Codex availability/tooling banners.
     - Clear warnings when the provider is not Codex.
     - Render the banner directly above the Codex flags panel for visibility.

4. [ ] Update client test fixtures: include `codexDefaults` + `codexWarnings`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test support update
   - Location: update mock `/chat/models` responses in these files:
     - `client/src/test/chatPage.flags.sandbox.default.test.tsx`
     - `client/src/test/chatPage.flags.network.default.test.tsx`
     - `client/src/test/chatPage.flags.sandbox.payload.test.tsx`
     - `client/src/test/chatPage.flags.network.payload.test.tsx`
     - `client/src/test/chatPage.codexBanners.test.tsx`
   - Purpose: Ensure test fixtures mirror the updated server response shape.

5. [ ] Add client test: unchanged flags omitted from `/chat` payload
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.flags.sandbox.payload.test.tsx`
   - Purpose: Assert unchanged Codex flags are omitted so server defaults apply.
   - Reference pattern: existing payload assertions in `chatPage.flags.sandbox.payload.test.tsx`.

6. [ ] Add client test: changed flags included in `/chat` payload
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.flags.network.payload.test.tsx`
   - Purpose: Ensure only user-changed Codex flags are included in the payload.
   - Reference pattern: existing payload assertions in `chatPage.flags.network.payload.test.tsx`.

7. [ ] Add client test: omit all flags when defaults missing
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.flags.sandbox.payload.test.tsx`
   - Purpose: When `codexDefaults` is absent, omit all Codex flags from the payload.
   - Reference pattern: existing payload assertions in `chatPage.flags.sandbox.payload.test.tsx`.

8. [ ] Add client test: render codex warnings only for Codex provider
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.codexBanners.test.tsx`
   - Purpose: Show warnings when provider is Codex and clear warnings when provider changes.
   - Reference pattern: existing banner assertions in `chatPage.codexBanners.test.tsx`.

9. [ ] Add client test: no warnings banner when codexWarnings empty
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Test type: client Jest/RTL test
   - Location: `client/src/test/chatPage.codexBanners.test.tsx`
   - Purpose: Ensure the warning banner is not shown when `codexWarnings` is empty.
   - Reference pattern: existing banner assertions in `chatPage.codexBanners.test.tsx`.

10. [ ] Update `README.md` if payload omission behavior is documented:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Mention that Codex flags are omitted when unchanged so env defaults apply.
   - Purpose: Keep usage docs aligned with payload behavior.

11. [ ] Update `design.md` with warning/banner flow + mermaid diagrams:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Document the `codexWarnings` banner flow and any UI/response updates.
   - Purpose: Keep architecture/flow diagrams current.

12. [ ] Update `projectStructure.md` after adding/removing files in this task:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this task (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate after file additions/removals.

13. [ ] Add client log lines for payload omission + warnings banner:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Log lines to add:
     - `console.info('[codex-payload] omitted flags', { omittedFlags })`
     - `console.info('[codex-warnings] rendered', { warnings })`
   - Expected outcome:
     - `omittedFlags` lists all flags excluded when unchanged; `warnings` matches `codexWarnings` when the banner is shown.

14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001): send a Codex message with unchanged flags and confirm the console logs `[codex-payload] omitted flags` listing all omitted flags; if `codexWarnings` is non-empty (set an invalid env like `Codex_reasoning_effort=invalid` before compose up), verify the banner renders and `[codex-warnings] rendered` logs with the warning text; ensure no console errors appear.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

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
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Docker/Compose: Context7 `/docker/docs`
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Update `README.md` with new Codex env defaults and model list:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Document `Codex_model_list` CSV usage and default flag values.
   - Purpose: Keep user-facing configuration guidance in sync with server env defaults.

2. [ ] Update `design.md` to reflect server-driven defaults and warnings:
   - Documentation to read (repeat):
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Update Codex flags panel notes, `/chat/models` response fields, and related flow diagrams.
   - Purpose: Ensure architecture docs and mermaid diagrams match the new defaults/warnings flow.

3. [ ] Update `projectStructure.md` if new files were introduced:
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this story (paths) and update the tree entries.
   - Purpose: Keep the repo tree map accurate.

4. [ ] Add dev-only client log line to confirm docs sync:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Log line to add:
     - `if (import.meta.env.DEV) console.info('[codex-docs] docs synced', { source: '/chat/models' })`
   - Expected outcome:
     - Appears once on initial Chat page load in dev/test environments.

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`): https://nodejs.org/api/test.html

4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`

5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001): confirm the Chat page still loads, verify the console includes `[codex-docs] docs synced`, and ensure no console errors appear.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

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
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Markdown syntax: https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Update `README.md` with any story-related usage changes
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `README.md`
   - Description: Capture new env defaults, model list config, or command changes from this story.
   - Purpose: Ensure user-facing instructions are accurate post-implementation.
2. [ ] Update `design.md` with architecture/flow changes + mermaid diagrams
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
   - Location: `design.md`
   - Description: Record any architecture or flow updates and add any new diagrams required.
   - Purpose: Keep architectural documentation synchronized with delivered changes.
3. [ ] Update `projectStructure.md` for any file/folder changes
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location: `projectStructure.md`
   - Description: List every file added or removed in this story (paths) and update the tree entries.
   - Purpose: Maintain an accurate repository structure map.
4. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/

5. [ ] Add final dev-only client log line confirming manual verification state:
   - Files to edit:
     - `client/src/App.tsx`
   - Log line to add:
     - `if (import.meta.env.DEV) console.info('[codex-final-check] smoke ready', { story: '0000026' })`
   - Expected outcome:
     - Appears once on app load in dev/test environments before screenshots are captured.

6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script

3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/

4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`

5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

8. [ ] Manual Playwright-MCP check (http://host.docker.internal:5001): verify Codex model list/defaults/warnings behavior end-to-end, confirm the console includes `[codex-final-check] smoke ready`, ensure no errors in the browser debug console, and capture screenshots in `test-results/screenshots` named `<planIndex>-<taskNumber>-<description>`.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`

9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here

---
