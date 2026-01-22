# Story 0000030 - Flow page stability + UI improvements

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

## Description

The Flows page intermittently drops the conversation sidebar and transcript during an active run, typically right after a server update (for example when a streamed message arrives). Refreshing restores the view. This story stabilizes the sidebar/transcript updates and adds several Flows page UX improvements: working-folder picker parity with Agents/Ingest, a flow info popover that mirrors the Agents “i” button, a “New Flow” reset action that clears the active conversation/transcript while keeping the selected flow, and an optional custom name input that becomes the conversation title in the sidebar.

The custom name must apply to the main flow conversation and to per-agent flow conversations created during the run. The name is only set when starting a new flow (not editable afterward). The “New Flow” action should behave like the Agents/Chat “New conversation” button: it keeps the selected flow and list visible, but clears the active conversation/transcript for a fresh run and resets the custom name input.

## Investigation Notes (current behavior)

- Flow sidebar filtering relies on `flowName` being present in conversation summaries.
- The server emits `flowName` in `conversation_upsert` WS events.
- The Flows page WS handler applies `conversation_upsert` updates **without** copying `flowName`, so the updated conversation no longer matches the flow filter and is filtered out.
- When the active conversation disappears from the filtered list, the Flows page clears the active conversation and transcript state, which looks like the sidebar and main chat “disappeared” until refresh.

## Root Cause & Likely Fix

- **Root cause:** The Flows page drops `flowName` when applying `conversation_upsert` updates, causing the conversation to be filtered out and the page to reset its selection.
- **Likely fix:** Preserve or forward `flowName` during WS upsert handling so the flow conversation stays eligible for the active filter. If the WS payload ever omits `flowName`, keep the previously-known value for that conversation instead of dropping it.

## Research Findings (code touchpoints)

- Flows list + WS handling live in `client/src/pages/FlowsPage.tsx`; `conversation_upsert` currently forwards a payload to `applyWsUpsert` without `flowName`, so any update can drop the flow filter.
- The server sidebar WS payload includes `flowName` when present (`server/src/ws/sidebar.ts`), so the client can pass it through or retain the previous `flowName` on upsert.
- `client/src/hooks/useConversations.ts` treats an empty `flowName` as “no filter” (returns all conversations). Because “New Flow” should keep the selected flow, the UI must avoid clearing `selectedFlowName` and instead only reset the active conversation/transcript + custom name.
- Flow summary data comes from `server/src/flows/discovery.ts` and contains `{ name, description, disabled, error? }`. There is no warnings array today; the info popover must decide whether to treat `error` as a warning when `disabled === true`.
- Flow run conversations are created/titled in `server/src/flows/service.ts`: `Flow: <flowName>` for the main run and `Flow: <flowName> (<identifier>)` for per-agent flow conversations. This is the spot to apply a custom title for both.
- Per-agent flow conversations currently set `agentName` but do **not** set `flowName` in `server/src/flows/service.ts`; keep them agent-only for this story (no change to flow list visibility).
- `POST /flows/:flowName/run` validation lives in `server/src/routes/flowsRun.ts` and currently accepts `conversationId`, `working_folder`, and `resumeStepPath`. Custom title support should be added here as an optional, trimmed string.
- `server/src/routes/flowsRun.ts` uses manual string trimming/empty checks (not Zod), so `customTitle` should follow the same pattern: trim and treat empty as undefined.
- The working-folder picker dialog is already shared by Agents/Ingest (`client/src/components/ingest/DirectoryPickerDialog.tsx` + `ingestDirsApi.ts`); Flows should reuse these exact pieces for parity.
- Chat page conversation filtering uses `agentName=__none__` and `flowName=__none__`, but the server query currently overwrites `query.$or` in `server/src/mongo/repo.ts`, so the agent filter is lost. This explains agent conversations leaking into the Chat sidebar.
- The regression was introduced when `flowName` filtering was added in `DEV-0000027 - Add flowName filtering` (commit `f7d8180`, 2026-01-17). The flowName `__none__` branch reuses `query.$or`, overwriting the earlier agentName `__none__` clause added on 2025-12-14.

## Research Findings (docs)

- MUI Popover supports `anchorOrigin`/`transformOrigin` positions with `vertical`/`horizontal` values (including `bottom` + `left`); set both explicitly to match the required bottom-left anchor and top-left transform.
- Zod `optional()` allows `undefined` values, and `trim()` is a mutating string transform; if Zod were used for `customTitle`, `trim().min(1)` would reject whitespace-only inputs after trimming.
- Deepwiki has not indexed `Chargeuk/codeInfo2`, so no repository wiki is available through that tool.

## Message Contracts & Storage Shapes (Confirmed)

- **Flow run request:** `POST /flows/:flowName/run` currently accepts `conversationId`, `working_folder`, and `resumeStepPath`. Add optional `customTitle` (trimmed, non-empty string). Validation should follow the existing manual trim/empty checks in `server/src/routes/flowsRun.ts`.
- **Flow run response:** No response changes; keep `202 { status, flowName, conversationId, inflightId, modelId }`.
- **Conversation storage:** No new fields are required. Store the custom title in existing `Conversation.title`; keep `flowName` and `agentName` as-is for filtering, and `flags.flow` for resume state.
- **Conversation summary + WS:** REST summary and `conversation_upsert` payloads already include `title`, `agentName?`, and `flowName?`. Custom titles flow through `title` only; per-agent flow conversations remain agent-only without `flowName`.

## Acceptance Criteria

- During an active flow run, live conversation updates (for example websocket `conversation_upsert` events) never remove the active flow conversation from the Flows sidebar; the transcript stays visible without refresh.
- When a live update payload omits `flowName`, the Flows page keeps the previously known `flowName` so the conversation still matches the selected flow filter.
- The working folder control appears on its own row below the Flow selector with a labeled `Working folder` text field that remains manually editable.
- A **Choose folder…** button sits next to the working folder field and opens the same `DirectoryPickerDialog` used by Agents/Ingest; picking a folder updates the field, cancel leaves it unchanged, and loading/error states match the existing dialog UX.
- An info (“i”) icon button appears directly next to the Flow selector. Clicking it opens a popover anchored bottom-left that shows a **Warnings** section when the flow is disabled and has `error` (display the error text as the warning), the flow description rendered as Markdown inside an outlined panel, and the fallback copy “No description or warnings are available for this flow yet.” when both are missing.
- A **New Flow** button clears the active conversation, transcript state, working folder field, and custom name input (but keeps the selected flow). After clicking it, the empty transcript state is shown and the Run button remains enabled because a flow is still selected.
- A **Custom name** input with helper text “Optional: name for this run” is visible before starting a run; once a run starts or a resume is selected, the field is read-only/disabled and no longer editable.
- When a custom name is provided, the main flow conversation title uses that value; when empty it remains the default `Flow: <flowName>` title.
- The custom name applies to per-agent flow conversations using the title format `<customTitle> (<identifier>)` (default remains `Flow: <flowName> (<identifier>)`).
- The custom name is captured only when starting a new flow run and is not sent or changed when resuming.
- Per-agent flow conversations remain agent-only (no `flowName`) and do not appear in flow-filtered sidebars; only the main flow conversation is listed in Flows.
- The Chat page sidebar shows only chat conversations (no agent or flow conversations). The Agents page shows only agent conversations and the Flows page shows only flow conversations.

## Out Of Scope

- Redesigning the Flows page layout beyond the items above.
- Changing flow execution semantics, step logic, or server-side flow orchestration.
- New persistence layers or changes to Mongo schemas beyond storing a custom title.
- Changing per-agent flow conversation visibility (they remain agent-only in this story).

## Scope Notes

- Scope is reasonable but spans client UI, shared picker reuse, and server flow-run metadata. If delivery risk appears, split into two stories: (1) flow sidebar stability + flowName preservation, (2) UX enhancements (picker parity, info popover, custom title).
- Keep scope tight by reusing existing dialog/components and avoiding additional flow orchestration changes; the only server behavior changes should be flow run validation/title formatting plus the conversation list filter fix for chat-only sidebars.

## Scope Assessment

- The story is moderately sized but still coherent: one stability bug fix, one API extension, a few UI affordances, and focused test updates.
- Biggest risk is breadth across client + server + tests; splitting UI enhancements from stability (as noted above) is the cleanest reduction if timeline is tight.
- Avoid adding new data fields or flow execution changes to keep the story shippable in one pass.

## Implementation Ideas

- **Flows WS stability:** In `client/src/pages/FlowsPage.tsx`, pass through `event.conversation.flowName` to `applyWsUpsert` (the WS payload already includes it). If the payload omits `flowName`, merge the prior conversation’s `flowName` before filtering so the item stays in the flow list.
- **Flow info popover parity:** Mirror the Agents page popover structure from `client/src/pages/AgentsPage.tsx` (info icon + `Popover`, warnings list, Markdown description, empty-state copy). Reuse the same `Markdown` component and warning layout to keep copy/padding consistent.
- **Working folder picker parity:** Follow the Agents working-folder pattern: keep a controlled `workingFolder` field, add a “Choose folder…” button to open `DirectoryPickerDialog`, and reuse `ingestDirsApi.ts` for the `/ingest/dirs` fetch behavior. Cancel should keep the existing value; pick updates the field.
- **New Flow reset logic:** Copy the Agents `resetConversation()` pattern: clear `activeConversationId`, transcript/messages, `workingFolder`, and `customTitle`, but keep `selectedFlowName` intact so the flow list and Run button stay enabled.
- **Custom title propagation:** Extend `server/src/routes/flowsRun.ts` to parse `customTitle` with the same trim/empty rules as `conversationId` and `working_folder`, pass it to `startFlowRun`, and update `server/src/flows/service.ts` to use it for both memory and Mongo conversation titles (main flow + per-agent), keeping per-agent conversations agent-only (no `flowName`).
- **Client payloads:** Extend `client/src/api/flows.ts` and `FlowsPage` so `customTitle` is only sent when starting a new run (never on resume). Disable the input once a run starts or when resuming.
- **Conversation filtering regression:** Update `server/src/mongo/repo.ts` to combine `agentName=__none__` and `flowName=__none__` conditions using `$and` of each `$or` block so chat-only lists exclude both agents and flows.
- **Tests to adjust:**
  - Client: Flows page tests for WS upsert `flowName` retention, New Flow reset behavior, custom title payload, and popover warnings/empty state (patterned after Agents popover tests).
  - Server: flows run integration tests to assert `customTitle` affects main + per-agent titles, and listConversations filtering tests for chat/agent/flow isolation.

## Edge Cases and Failure Modes

- `conversation_upsert` arrives without `flowName`: keep the last known `flowName` for that conversation to avoid it disappearing from the filtered sidebar.
- `conversation_upsert` arrives with `agentName`: Flows page should ignore it so per-agent conversations do not appear in the flow sidebar.
- “New Flow” retains the selected flow; the empty state is scoped to the transcript + active conversation only. Run remains enabled because a flow is still selected.
- Custom title supplied but the flow run fails early: if a conversation is created, the sidebar still shows the custom title.
- `customTitle` provided as non-string or whitespace-only: server treats it as invalid (non-string) or undefined (whitespace-only) without storing a blank title.
- Directory picker errors (network, OUTSIDE_BASE, NOT_FOUND, NOT_DIRECTORY): display the same inline error UI as Agents/Ingest and keep the rest of the flow form usable.

---
## Implementation Plan

### 1. Server: Validate customTitle on flow run requests

- Task Status: **__done__**
- Git Commits: 446d42a

#### Overview

Accept `customTitle` on `POST /flows/:flowName/run` (string-only, trimmed) and thread it through `FlowRunStartParams` so downstream services can use it. Reuse the existing `Conversation.title` field (no schema changes).

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0` (route handlers, async error handling)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage)
- Supertest HTTP assertions: https://github.com/forwardemail/supertest (request/expect patterns)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Jest: Context7 `/websites/jestjs_io_30_0` (client test runner reference)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [x] Review the current flow run request validation and parameter types:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/routes/flowsRun.ts`
     - `server/src/flows/types.ts`
     - `server/src/mongo/conversation.ts`
   - Snippets to locate:
     - `validateBody` body parsing logic
     - `FlowRunStartParams` definition
     - `Conversation.title` field definition (confirm no schema changes needed)
   - Key requirements (repeat):
     - Reuse `Conversation.title` (no new schema fields).
     - `customTitle` must be optional and trimmed; blank strings become `undefined`.
2. [x] Extend the flow run request validator to accept `customTitle`:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/flowsRun.ts`
   - Implementation details:
     - Add `customTitle?: unknown` to `FlowRunBody`.
     - Treat non-string values as invalid (`invalid_request`).
     - Trim strings and set `customTitle` to `undefined` when empty.
     - Include `customTitle` in the parsed body output and in the `startFlowRun` call.
   - Key requirements (repeat):
     - Keep validation style consistent with `working_folder`.
     - Do not add new response fields; only pass through to `startFlowRun`.
3. [x] Thread `customTitle` through the flow run parameter type:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/flows/types.ts`
     - `server/src/flows/service.ts`
   - Implementation details:
     - Update `FlowRunStartParams` to include `customTitle?: string`.
     - Ensure `startFlowRun` accepts the new field without applying it yet.
   - Key requirements (repeat):
     - No behavior changes in this subtask; only thread the type/parameter.
4. [x] Integration test (server) — `server/src/test/integration/flows.run.errors.test.ts`: reject non-string `customTitle` with `400 invalid_request` (purpose: validate request type safety).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/flows.run.errors.test.ts`
   - Test expectations:
     - Non-string `customTitle` returns `400 { error: 'invalid_request' }`.
   - Key requirements (repeat):
     - Preserve existing error mappings; follow current `invalid_request` patterns.
5. [x] Update API documentation after the server change:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `openapi.json` (add `customTitle` to `POST /flows/:flowName/run` request body)
   - Key requirements (repeat):
     - Mark `customTitle` as optional string in OpenAPI.
6. [x] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
7. [x] Add a server log line when `customTitle` validation completes (purpose: verify request validation in manual checks).
   - Files to edit:
     - `server/src/routes/flowsRun.ts`
   - Log line to add:
     - `flows.run.custom_title.validated` with fields `{ requestId, flowName, customTitleProvided, customTitleLength }`.
   - Implementation details:
     - Emit after `validateBody` succeeds and `customTitle` has been normalized.
     - Set `customTitleProvided` to `true` only when a non-empty string was supplied.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/websites/jestjs_io_30_0`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check to confirm custom title runs are accepted and no regressions:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Start a flow with a custom title and confirm the run starts without error.
   - Check server logs for `flows.run.custom_title.validated` with `customTitleProvided: true` and a non-zero `customTitleLength`.
   - Ensure there are no logged errors in the browser debug console.
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed flow run validation and parameter types for `customTitle` support.
- Added request validation, normalization, and logging for `customTitle`, and threaded it through `FlowRunStartParams`.
- Added integration coverage for non-string `customTitle` rejection.
- Updated `openapi.json` stub to document the optional `customTitle` field on flow runs.
- Confirmed no project structure entries needed updating for this task.
- Ran lint and format checks; lint reported existing import-order warnings.
- Built server workspace (`npm run build --workspace server`).
- Built client workspace (`npm run build --workspace client`).
- Ran server tests (`npm run test --workspace server`), required extended timeout to complete.
- Ran client tests (`npm run test --workspace client`); existing console warnings observed.
- Ran e2e suite (`npm run e2e`); initial re-embed test flake resolved on rerun.
- Ran `npm run compose:build` successfully.
- Ran `npm run compose:up` successfully.
- Verified flow run via Playwright MCP with customTitle; server logs show `flows.run.custom_title.validated` and no console errors.
- Ran `npm run compose:down` successfully.

---

### 2. Server: Apply customTitle to flow conversation titles

- Task Status: **__done__**
- Git Commits: 0577321

#### Overview

Use `customTitle` to set the conversation title for the main flow and per-agent flow conversations, falling back to `Flow: <flowName>` when absent.

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0` (route handlers, async error handling)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage)
- Supertest HTTP assertions: https://github.com/forwardemail/supertest (request/expect patterns)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Jest: Context7 `/websites/jestjs_io_30_0` (client test runner reference)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [x] Review flow conversation creation helpers:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/flows/service.ts`
   - Snippets to locate:
     - `ensureFlowConversation`
     - `ensureFlowAgentConversation`
     - `ensureAgentState`
   - Key requirements (repeat):
     - Per-agent conversations remain agent-only (do not add `flowName`).
2. [x] Apply `customTitle` when creating flow conversations:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/flows/service.ts`
   - Implementation details:
     - Pass `customTitle` into `ensureFlowConversation` and `ensureAgentState` calls.
     - Update `ensureAgentState` and `ensureFlowAgentConversation` signatures to accept the optional title.
     - When creating the main flow conversation, use `customTitle` when provided (fallback to `Flow: <flowName>`).
     - When creating per-agent flow conversations, use `${customTitle} (${identifier})` when provided (fallback to `Flow: <flowName> (<identifier>)`).
     - Do **not** rename existing conversations; only apply the title on creation.
   - Key requirements (repeat):
     - Do not update existing conversation titles.
     - Keep flow conversation `flowName` behavior unchanged.
3. [x] Integration test (server) — `server/src/test/integration/flows.run.basic.test.ts`: main flow conversation title reflects `customTitle` (purpose: confirm main flow naming).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/flows.run.basic.test.ts`
   - Test expectations:
     - The main flow conversation title reflects `customTitle` when supplied.
4. [x] Integration test (server) — `server/src/test/integration/flows.run.loop.test.ts`: per-agent flow conversation title includes `customTitle` + identifier (purpose: verify per-agent naming).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Test expectations:
     - The per-agent flow conversation title includes `customTitle` + identifier.
5. [x] Integration test (server) — `server/src/test/integration/flows.run.basic.test.ts`: whitespace-only `customTitle` is ignored (purpose: confirm trim/empty handling).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/flows.run.basic.test.ts`
   - Test expectations:
     - Empty/whitespace `customTitle` values are ignored.
6. [x] Integration test (server) — `server/src/test/integration/flows.run.resume.test.ts`: existing conversation title is not renamed when `customTitle` is provided on resume (purpose: enforce “no renames” rule).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/flows.run.resume.test.ts`
   - Test expectations:
     - Existing conversation title remains unchanged after a resume request that includes `customTitle`.
7. [x] Update `design.md` (repo root `design.md`) with custom-title flow conversation behavior (purpose: document the updated flow run architecture).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md` (repo root; update Flows run behavior section)
   - Key requirements (repeat):
     - Mention both main flow and per-agent title behavior.
     - Add/update a Mermaid diagram to show how custom titles are applied during flow conversation creation.
8. [x] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
9. [x] Add server log lines when custom titles are applied or skipped on resume (purpose: verify title behavior in manual checks).
   - Files to edit:
     - `server/src/flows/service.ts`
   - Log lines to add:
     - `flows.run.custom_title.applied` with fields `{ flowName, conversationId, agentName, customTitle }`.
     - `flows.run.custom_title.resume_ignored` with fields `{ flowName, conversationId, customTitle }`.
   - Implementation details:
     - Emit the applied log for the main flow and each agent conversation that receives a custom title.
     - Emit the resume_ignored log when a resume request includes `customTitle` but no title change occurs.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/websites/jestjs_io_30_0`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check to confirm custom titles apply to flow conversations and resume does not rename:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Start a flow with a custom title and confirm the main flow conversation title uses that custom title.
   - Confirm per-agent flow conversations include the custom title plus the agent identifier.
   - Resume an existing conversation with a custom title and confirm the existing title does not change.
   - Check server logs for `flows.run.custom_title.applied` entries for the main flow and each per-agent conversation.
   - Check server logs for `flows.run.custom_title.resume_ignored` when resuming with a custom title.
   - Ensure there are no logged errors in the browser debug console.
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Applied customTitle naming for main and per-agent flow conversations and added applied/resume log lines.
- Updated flow run integration tests to cover customTitle naming, whitespace ignore, and resume no-rename behavior.
- Updated design notes and Mermaid diagram for customTitle title selection; no project structure changes needed.
- Ran lint (existing import-order warnings) and format check; applied Prettier write to fix loop test formatting.
- Built server/client, ran server/client tests, and completed e2e (ingest cases skipped by suite).
- Completed manual Playwright check for main/per-agent titles and resume ignore; server logs show applied/resume_ignored entries.

---

### 3. Server: Fix chat-only conversation filtering for agent + flow

- Task Status: **__done__**
- Git Commits: 13940d5

#### Overview

Update the conversations list query so `agentName=__none__` and `flowName=__none__` can be combined without clobbering each other, ensuring chat-only sidebars exclude both agent and flow conversations.

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0` (route handlers, async error handling)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage)
- Supertest HTTP assertions: https://github.com/forwardemail/supertest (request/expect patterns)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Jest: Context7 `/websites/jestjs_io_30_0` (client test runner reference)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [x] Review conversation list query construction:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/mongo/repo.ts`
     - `server/src/routes/conversations.ts`
     - `server/src/test/integration/conversations.list.test.ts`
   - Snippet to locate:
     - `agentName` and `flowName` filter building logic
   - Key requirements (repeat):
     - `agentName=__none__` and `flowName=__none__` must be combinable.
2. [x] Combine `agentName=__none__` and `flowName=__none__` filters safely:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation details:
     - Build each `$or` block separately, then combine them with `$and` when both filters are present.
     - Preserve existing behavior for single filters and explicit `agentName`/`flowName` values.
   - Key requirements (repeat):
     - Do not change sort/pagination behavior.
3. [x] Integration test (server) — `server/src/test/integration/conversations.list.test.ts`: `?agentName=__none__&flowName=__none__` returns only chat conversations (purpose: ensure chat-only filter works).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Test expectations:
     - `?agentName=__none__&flowName=__none__` returns only chat conversations.
4. [x] Integration test (server) — `server/src/test/integration/conversations.list.test.ts`: `?agentName=__none__&flowName=<name>` returns non-agent flow conversations only (purpose: ensure agent exclusion stays intact).
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Test expectations:
     - `?agentName=__none__&flowName=<name>` returns non-agent flow conversations only.
5. [x] Update `design.md` (repo root `design.md`) with combined chat-only filter behavior (purpose: document updated conversation filtering rules).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md` (repo root; update chat-only filter section)
   - Key requirements (repeat):
     - Document how `__none__` filters combine.
     - Update the Mermaid diagram that describes conversation list filtering to show combined `agentName` + `flowName` behavior.
6. [x] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
7. [x] Add a server log line when combined chat-only filters are applied (purpose: verify filter behavior in manual checks).
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Log line to add:
     - `conversations.filter.chat_only_combined` with fields `{ agentName, flowName }`.
   - Implementation details:
     - Emit only when `agentName === '__none__'` and `flowName === '__none__'` are both present.
     - Keep logging lightweight (single append per request).
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/websites/jestjs_io_30_0`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check to confirm combined chat-only filtering works and no regressions:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Navigate to the conversations list and enable the chat-only filter (agentName + flowName “none” state).
   - Confirm only chat conversations are listed and flow/agent conversations are excluded.
   - Check server logs for `conversations.filter.chat_only_combined` with `agentName: '__none__'` and `flowName: '__none__'`.
   - Ensure there are no logged errors in the browser debug console.
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Combined agent/flow __none__ filters in repo query with a new chat-only log line.
- Added chat-only filter coverage to conversations list integration tests.
- Updated design doc filter description + diagram; no project structure updates required.
- Lint still reports existing import-order warnings; format checks now pass.
- Manual chat-only check verified logs for `conversations.filter.chat_only_combined` and no browser console errors.
- Ran `npm run compose:down` to stop the stack after manual verification.

---

### 4. Client: Preserve flowName on WS upserts

- Task Status: **__done__**
- Git Commits: 1145b1c

#### Overview

Prevent the Flows page from dropping the active conversation during a `conversation_upsert` by ensuring `flowName` is preserved when WS updates are applied.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/ (render + screen usage)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [x] Review Flows page WS upsert handling and conversation list filtering:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/hooks/useConversations.ts`
   - Snippets to locate:
     - `conversation_upsert` event handling
     - `applyWsUpsert` call site
   - Key requirements (repeat):
     - Flow conversations must keep `flowName` to stay in the filtered list.
2. [x] Preserve `flowName` when applying WS updates:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/hooks/useConversations.ts`
   - Implementation details:
     - Forward `event.conversation.flowName` when present.
     - In `applyWsUpsert`, merge missing `flowName` (and `agentName`) from the existing summary before filtering.
     - Ensure per-agent conversations (with `agentName`) are still excluded from the Flows sidebar.
   - Key requirements (repeat):
     - Do not add new WS event types or server changes.
3. [x] Component test (client) — `client/src/test/flowsPage.test.tsx`: `conversation_upsert` missing `flowName` keeps the conversation visible (purpose: prevent sidebar drop).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.test.tsx`
   - Test expectations:
     - `conversation_upsert` keeps the conversation visible when `flowName` is missing from the payload (merge uses previous value).
4. [x] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: `conversation_upsert` with `agentName` stays excluded from the Flows sidebar (purpose: avoid agent-only leaks).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - `conversation_upsert` with `agentName` does not show in the Flows sidebar.
5. [x] Update `design.md` (repo root `design.md`) with WS upsert flowName merge behavior (purpose: document sidebar stability rules).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md` (repo root; update WS sidebar section)
   - Key requirements (repeat):
     - Mention `flowName` merge behavior on upsert.
     - Update the Mermaid diagram that describes WS sidebar updates to include `flowName` merging.
6. [x] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
7. [x] Add a client log line when a WS upsert merges missing `flowName` (purpose: verify sidebar stability in manual checks).
   - Files to edit:
     - `client/src/hooks/useConversations.ts`
   - Log line to add:
     - `flows.ws.upsert.merge_flowName` with fields `{ conversationId, flowName }`.
   - Implementation details:
     - Emit only when the incoming upsert is missing `flowName` and the previous summary supplies it.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [x] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [x] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [x] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [x] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/websites/jestjs_io_30_0`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check to confirm WS upserts keep flow conversations visible:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Start a flow and watch the sidebar while messages arrive; confirm the active flow conversation never disappears.
   - Trigger a run that produces multiple updates to ensure the conversation stays filtered correctly.
   - Check the browser debug console for `flows.ws.upsert.merge_flowName` with the expected `conversationId` and `flowName`.
   - Capture `0000030-04-ws-upsert.png` in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) and confirm the sidebar UI matches expectations.
   - Ensure there are no logged errors in the browser debug console.
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed FlowsPage WS upsert handling and useConversations flow filtering logic.
- Forwarded `flowName` on Flows page upserts and merged missing flow/agent names in `applyWsUpsert` with a merge log.
- Added Flows page tests for missing flowName upserts and agent-only upsert exclusion.
- Documented the flowName merge behavior and added a Flows sidebar WS diagram in design notes.
- No project structure updates required for this task.
- Lint still reports existing import-order warnings; format check passed after running Prettier.
- Built server workspace (`npm run build --workspace server`).
- Built client workspace (`npm run build --workspace client`).
- Ran server tests (`npm run test --workspace server`).
- Ran client tests (`npm run test --workspace client`); console log output persists as in existing suites.
- Ran e2e suite (`npm run e2e`).
- Ran `npm run compose:build` successfully.
- Ran `npm run compose:up` successfully.
- Manual Playwright check confirmed flow sidebar stability, captured `playwright-output-local/0000030-04-ws-upsert.png`, and observed `flows.ws.upsert.merge_flowName` in console with no console errors.
- Ran `npm run compose:down` to stop the stack.

---

### 5. Client: Add working-folder picker to Flows page

- Task Status: **__in_progress__**
- Git Commits: **__to_do__**

#### Overview

Add working-folder UI parity to the Flows page using the existing `DirectoryPickerDialog` and `/ingest/dirs` API so users can pick a folder before starting a flow.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
- MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [ ] Review how Agents/Ingest handle working folders and the directory picker:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
     - `client/src/components/ingest/ingestDirsApi.ts`
     - `client/src/pages/FlowsPage.tsx`
   - Key requirements (repeat):
     - Reuse existing `DirectoryPickerDialog` and `ingestDirsApi`.
2. [ ] Add a directory picker button + dialog to FlowsPage:
   - Documentation to read (repeat):
     - MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
     - MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Reuse the existing `workingFolder` text field; keep manual entry available.
     - Add a “Choose folder…” button to open `DirectoryPickerDialog`.
     - Place the working folder row directly beneath the Flow selector; keep the button aligned next to the input.
     - Mirror Agents behavior (`handleOpenDirPicker`, `handlePickDir`, `handleCloseDirPicker`).
     - Keep the selected value on dialog cancel; update on confirm.
   - Key requirements (repeat):
     - Preserve existing `working_folder` payload wiring in `runFlow`.
3. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: picker selection populates the working folder input (purpose: confirm happy-path selection).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - Opening the picker populates the input after selecting a folder.
4. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: picker error shows inline error and preserves value (purpose: cover error-state UX).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - Directory picker errors render the inline error state and do not clear the current `workingFolder` value.
5. [ ] Unit/API test (client) — `client/src/test/flowsApi.run.payload.test.ts`: `working_folder` is sent in the flow run payload (purpose: confirm request body).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsApi.run.payload.test.ts`
   - Test expectations:
     - The chosen `working_folder` is sent in the flow run payload.
6. [ ] Update `design.md` (repo root `design.md`) with working-folder picker parity (purpose: document the updated Flows run form UX).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (repo root; update Flows run form section)
   - Key requirements (repeat):
     - Mention parity with Agents/Ingest folder picker.
     - Add/update a Mermaid diagram that shows the Flows run form including working-folder selection.
7. [ ] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
8. [ ] Add a client log line when a working folder is selected (purpose: verify picker behavior in manual checks).
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Log line to add:
     - `flows.ui.working_folder.selected` with fields `{ workingFolder }`.
   - Implementation details:
     - Emit when `handlePickDir` confirms a selection.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
    - Jest: Context7 `/websites/jestjs_io_30_0`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check to confirm working-folder picker UX parity:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Open the working-folder picker, select a folder, and confirm the input updates.
   - Cancel the picker and confirm the existing value remains unchanged.
   - Check the browser debug console for `flows.ui.working_folder.selected` with the chosen folder path.
   - Capture `0000030-05-working-folder-picker.png` in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) and confirm the picker UI matches expectations.
   - Ensure there are no logged errors in the browser debug console.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 6. Client: Add flow info popover

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add the Flows page info (“i”) popover matching the Agents UI, including warnings for disabled flows, Markdown descriptions, and an empty-state message when no content is available.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI Popover API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/popover.md
- MUI IconButton API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
- MUI Tooltip API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/tooltip.md
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [ ] Review the Agents info popover implementation and Flow summary data:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
     - `client/src/pages/FlowsPage.tsx`
   - Key requirements (repeat):
     - Flow warnings are based on `disabled === true` with `error` text.
2. [ ] Implement the Flows info popover (matching Agents behavior):
   - Documentation to read (repeat):
     - MUI Popover API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/popover.md
     - MUI IconButton API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
     - MUI Tooltip API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/tooltip.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Place the info icon directly next to the Flow selector (same row) and anchor the popover to it.
     - Show warnings when `disabled === true` and `error` is present.
     - Render the description via the shared Markdown component.
     - When both warning + description are missing, show the same empty-state copy as Agents.
     - Match the popover anchoring (`anchorOrigin` bottom/left; `transformOrigin` top/left).
     - Avoid deprecated `components`/`componentsProps` props in Tooltip/Popover; use default slots unless customization is required.
     - Remove the inline flow description + warning alert beneath the controls so the popover becomes the single source of flow details.
   - Key requirements (repeat):
     - Empty-state copy must be: “No description or warnings are available for this flow yet.”
3. [ ] Component test (client) — `client/src/test/flowsPage.test.tsx`: popover shows warnings when flow is disabled (purpose: ensure warning UX parity).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.test.tsx`
   - Test expectations:
     - Popover shows warnings when flow is disabled.
4. [ ] Component test (client) — `client/src/test/flowsPage.test.tsx`: popover shows Markdown description (purpose: confirm description rendering).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.test.tsx`
   - Test expectations:
     - Popover shows description when available.
5. [ ] Component test (client) — `client/src/test/flowsPage.test.tsx`: empty-state copy renders when no warnings/description (purpose: match Agents empty-state).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.test.tsx`
   - Test expectations:
     - Empty-state copy renders when warnings + description are missing.
6. [ ] Update `design.md` (repo root `design.md`) with flow info popover behavior (purpose: document the updated Flows UI architecture).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (repo root; update Flows info popover section)
   - Key requirements (repeat):
     - Mention removal of inline flow description in favor of popover.
     - Add/update a Mermaid diagram that shows the Flows info popover in the page UX flow.
7. [ ] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
8. [ ] Add a client log line when the flow info popover opens (purpose: verify popover state in manual checks).
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Log line to add:
     - `flows.ui.info_popover.opened` with fields `{ flowName, hasWarnings, hasDescription }`.
   - Implementation details:
     - Emit when the info icon opens the popover.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
    - Jest: Context7 `/websites/jestjs_io_30_0`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check to confirm flow info popover behavior:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Open the info popover for a flow with warnings and confirm warnings render.
   - Open a flow with a Markdown description and confirm the description renders.
   - Open a flow with no warnings/description and confirm the empty-state copy renders.
   - Check the browser debug console for `flows.ui.info_popover.opened` entries with the expected `hasWarnings`/`hasDescription` flags.
   - Capture `0000030-06-flow-info-popover.png` in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) and confirm the popover UI matches expectations.
   - Ensure there are no logged errors in the browser debug console.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 7. Client: Add custom title input UI

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a custom title input field to the Flows controls, store it in local state, and reset it alongside other flow form fields.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [ ] Review the current Flows controls layout and reset helper:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/FlowsPage.tsx`
   - Key requirements (repeat):
     - Custom title is set only when starting a new flow; not editable afterward.
2. [ ] Add the custom title input field and local state:
   - Documentation to read (repeat):
     - MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Add `customTitle` state and a text input in the controls stack.
     - Use helper text “Optional: name for this run”.
     - Disable the input when resuming, when a run is in progress, or when an existing conversation is selected.
     - Clear `customTitle` inside the existing `resetConversation` helper so New Flow + flow changes reset it.
   - Key requirements (repeat):
     - Do not persist custom title in local storage; keep in component state only.
3. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: custom title input renders (purpose: confirm UI presence).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - Custom title input renders.
4. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: input disables during resume/inflight states (purpose: prevent edits after start).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - Input disables during resume/inflight states.
   - Key requirements (repeat):
     - Tests should not depend on server responses (UI-only).
5. [ ] Update `design.md` (repo root `design.md`) with custom title input behavior (purpose: document the updated flow run UX).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (repo root; update Flows controls section)
   - Key requirements (repeat):
     - Document that the title is only set at run start.
     - Add/update a Mermaid diagram showing the custom title captured before starting a flow.
6. [ ] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
7. [ ] Add a client log line when the custom title input is updated (purpose: verify input behavior in manual checks).
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Log line to add:
     - `flows.ui.custom_title.updated` with fields `{ customTitleLength }`.
   - Implementation details:
     - Emit on blur (or explicit commit) so the log fires once per input update.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/websites/jestjs_io_30_0`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check to confirm custom title input UX:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Confirm the custom title input renders on the Flows page.
   - Start/resume a flow and verify the input disables when a run is active or a conversation is selected.
   - Enter a custom title, blur the field, and confirm `flows.ui.custom_title.updated` appears with a non-zero `customTitleLength`.
   - Capture `0000030-07-custom-title-input.png` in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) and confirm the input layout matches expectations.
   - Ensure there are no logged errors in the browser debug console.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 8. Client: Send customTitle in flow run payload

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Send `customTitle` only when starting a new flow conversation and keep the payload empty for resumes or existing conversations.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (diagram syntax reference)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [ ] Review flow run payload handling:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/api/flows.ts`
     - `client/src/test/flowsApi.run.payload.test.ts`
   - Key requirements (repeat):
     - `customTitle` must only be sent for new runs (not resumes).
2. [ ] Add `customTitle` to the run payload logic:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/api/flows.ts`
   - Implementation details:
     - Extend the `runFlow` params to accept `customTitle?: string`.
     - Include `customTitle` in the request body only when `isNewConversation === true` and `mode === 'run'`.
   - Key requirements (repeat):
     - Never send `customTitle` on resume or existing-conversation runs.
3. [ ] Unit/API test (client) — `client/src/test/flowsApi.run.payload.test.ts`: include `customTitle` for new runs only (purpose: verify payload on new run).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsApi.run.payload.test.ts`
   - Test expectations:
     - `customTitle` is included only for new runs.
4. [ ] Unit/API test (client) — `client/src/test/flowsApi.run.payload.test.ts`: omit `customTitle` for resume/existing conversation runs (purpose: prevent accidental rename).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsApi.run.payload.test.ts`
   - Test expectations:
     - `customTitle` is omitted for resume or existing conversation runs.
5. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: when starting a new run, the UI passes `customTitle` into `runFlow` (purpose: confirm UI wiring).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - The run action includes the current `customTitle` when starting a new flow.
6. [ ] Update `design.md` (repo root `design.md`) with custom title payload rules (purpose: document when titles are sent).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (repo root; update flow run payload section)
   - Key requirements (repeat):
     - Mention that custom title is not editable after start.
     - Add/update a Mermaid diagram that shows `customTitle` included only on new flow runs.
7. [ ] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
8. [ ] Add a client log line when the run payload includes or omits `customTitle` (purpose: verify payload rules in manual checks).
   - Files to edit:
     - `client/src/api/flows.ts`
   - Log line to add:
     - `flows.run.payload.custom_title_included` with fields `{ included, isNewConversation }`.
   - Implementation details:
     - Emit immediately before sending the request body.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
     - Jest: Context7 `/websites/jestjs_io_30_0`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check to confirm `customTitle` payload rules:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Start a new flow with a custom title and inspect the `/flows/:flowName/run` request payload to confirm `customTitle` is present.
   - Resume an existing flow and confirm the run payload omits `customTitle`.
   - Check the browser debug console for `flows.run.payload.custom_title_included` with `included: true` for new runs and `included: false` for resumes.
   - Capture `0000030-08-custom-title-payload.png` in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) and confirm the run UI matches expectations.
   - Ensure there are no logged errors in the browser debug console.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 9. Client: Add “New Flow” reset action

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a “New Flow” action that clears the active conversation and transcript while keeping the selected flow, resetting custom title + working folder for a fresh run.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- Cucumber guides: https://cucumber.io/docs/guides/ (server test runner reference)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (syntax reference for docs updates)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command reference)
- Prettier CLI: https://prettier.io/docs/cli (format command reference)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)
- Playwright: Context7 `/microsoft/playwright` (e2e command reference)
- Docker/Compose: Context7 `/docker/docs` (compose build/up/down commands)

#### Subtasks

1. [ ] Review “New conversation” reset behavior in Agents/Chat:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/FlowsPage.tsx`
   - Key requirements (repeat):
     - New Flow must keep `selectedFlowName` intact.
2. [ ] Implement the “New Flow” reset action:
   - Documentation to read (repeat):
     - MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Reuse the existing `resetConversation` helper and extend it to clear `customTitle` alongside `workingFolder`.
     - Clear `activeConversationId`, transcript/messages, inflight state, `customTitle`, and `workingFolder`.
     - Keep `selectedFlowName` unchanged so the flow list and Run button stay enabled.
     - Reset any “resume” state so the next run is treated as a new flow.
   - Key requirements (repeat):
     - Do not clear the flow selection or flow list state.
3. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: “New Flow” clears transcript + active conversation (purpose: confirm reset behavior).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - Clicking “New Flow” clears the transcript and active conversation.
4. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: selected flow remains and Run stays enabled (purpose: keep flow selection intact).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - The selected flow remains highlighted and the Run button is still enabled.
5. [ ] Component test (client) — `client/src/test/flowsPage.run.test.tsx`: `customTitle` + `workingFolder` reset on New Flow (purpose: clear form state).
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - `customTitle` and `workingFolder` values reset.
6. [ ] Update `design.md` (repo root `design.md`) with New Flow reset behavior (purpose: document the reset flow without altering selection).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (repo root; update Flows reset section)
   - Key requirements (repeat):
     - Call out that New Flow does not change the selected flow.
     - Add/update a Mermaid diagram that shows the New Flow reset path without changing the selected flow.
7. [ ] Update `projectStructure.md` (repo root `projectStructure.md`) after any file additions/removals in this task (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this task.
     - Added files (if any): list each file path added in this task.
     - Removed files (if any): list each file path removed in this task.
8. [ ] Add a client log line when “New Flow” resets the form (purpose: verify reset behavior in manual checks).
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Log line to add:
     - `flows.ui.new_flow_reset` with fields `{ selectedFlowName, clearedFields }`.
   - Implementation details:
     - Emit after `resetConversation` completes and confirm `clearedFields` includes `customTitle` and `workingFolder`.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli

#### Testing

1. [ ] `npm run build --workspace server`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
2. [ ] `npm run build --workspace client`
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
3. [ ] `npm run test --workspace server`
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
4. [ ] `npm run test --workspace client`
   - Documentation to read (repeat):
    - Jest: Context7 `/websites/jestjs_io_30_0`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m`)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [ ] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [ ] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [ ] Manual Playwright-MCP check to confirm “New Flow” reset behavior:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Start a flow, set custom title + working folder, then click “New Flow”.
   - Confirm the selected flow stays highlighted, the Run button remains enabled, and the form fields reset.
   - Check the browser debug console for `flows.ui.new_flow_reset` with `clearedFields` including `customTitle` and `workingFolder`.
   - Capture `0000030-09-new-flow-reset.png` in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) and confirm the reset UI matches expectations.
   - Ensure there are no logged errors in the browser debug console.
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 10. Final Task: Validate, document, and summarize

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run full builds/tests, perform manual verification with Playwright MCP, ensure documentation is up to date, and produce the pull request summary for this story.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Markdown Guide: https://www.markdownguide.org/basic-syntax/
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage for server tests)
- npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test command usage)

#### Subtasks

1. [ ] Update `README.md` (repo root `README.md`) with any new commands or user-facing changes from this story (purpose: keep onboarding and usage docs accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `README.md` (repo root)
   - Update scope:
     - Add/adjust commands, configuration notes, or feature summaries introduced by this story.
2. [ ] Update `design.md` (repo root `design.md`) with any required behavior or diagram updates from this story (purpose: keep architecture notes current).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
     - Mermaid diagrams: Context7 `/mermaid-js/mermaid`
   - Files to edit:
     - `design.md` (repo root)
   - Update scope:
     - Add/update Mermaid diagrams reflecting flow-run UX, filters, and sidebar behavior changes.
3. [ ] Update `projectStructure.md` (repo root `projectStructure.md`) with any added/removed/renamed files from this story (purpose: keep the repository tree accurate).
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `projectStructure.md` (repo root; existing tree format)
   - Files to edit:
     - `projectStructure.md` (repo root)
   - Update scope:
     - Add/remove/rename entries for any files changed by this story.
     - Added files (if any): list each file path added in this story.
     - Removed files (if any): list each file path removed in this story.
4. [ ] Create a pull request summary covering all changes in this story.
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
5. [ ] Add a client log line when the Flows page is ready for manual validation (purpose: confirm QA readiness in manual checks).
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Log line to add:
     - `flows.qa.validation_ready` with fields `{ flowCount }`.
   - Implementation details:
     - Emit once when the flows list has loaded (non-loading state) and counts are available.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to confirm story requirements and regressions:
   - Use Playwright MCP against http://host.docker.internal:5001.
   - Verify flows run UX and capture screenshots in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`) using:
     - `0000030-10-flows-run.png`
     - `0000030-10-flow-info-popover.png`
     - `0000030-10-working-folder-picker.png`
     - `0000030-10-custom-title.png`
     - `0000030-10-new-flow-reset.png`
   - Review the stored screenshots to confirm the GUI matches the task expectations.
   - Check the browser debug console for `flows.qa.validation_ready` with a non-zero `flowCount`.
   - Ensure there are no logged errors in the browser debug console.
9. [ ] `npm run compose:down`

#### Implementation notes

- 

## Reference: Agents “i” button UX (structure match)

- Shows **Warnings** header when warnings exist, listing each warning.
- Shows the agent description rendered as Markdown inside an outlined panel.
- If both warnings and description are missing, Agents displays: “No description or warnings are available for this agent yet.”
- For Flows, use the same structure but replace the noun: “No description or warnings are available for this flow yet.”
- Uses a popover anchored to the info icon with left-bottom anchoring.
- Use MUI Popover positioning (`anchorOrigin: { vertical: 'bottom', horizontal: 'left' }`, `transformOrigin: { vertical: 'top', horizontal: 'left' }`) so the popover behaves like other MUI info popovers.

## Reference: Directory Picker UX (must match)

- Uses the existing `DirectoryPickerDialog` component and `GET /ingest/dirs` endpoint.
- Shows base path, current path, list of child directories, and “Use this folder” action.
- Includes loading and error states identical to the Ingest/Agents usage.
