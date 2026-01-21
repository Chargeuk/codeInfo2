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

### 1. Server: Add custom title support to flow runs

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add an optional `customTitle` field to `POST /flows/:flowName/run`, validate it with the same trim/empty rules as other optional fields, and apply it to the flow conversation title for both the main flow and per-agent flow conversations. Reuse the existing `Conversation.title` field (no schema changes).

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0` (route handlers, async error handling)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage)
- Supertest HTTP assertions: https://github.com/forwardemail/supertest (request/expect patterns)

#### Subtasks

1. [ ] Review the current flow run request validation and title creation flow:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/routes/flowsRun.ts`
     - `server/src/flows/service.ts`
      - `server/src/flows/types.ts`
     - `server/src/mongo/conversation.ts`
   - Snippets to locate:
     - `validateBody` body parsing logic
     - `ensureFlowConversation` and `ensureFlowAgentConversation` title formatting
     - `Conversation.title` field definition (confirm no schema changes needed)
2. [ ] Extend the flow run request validator to accept `customTitle`:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/routes/flowsRun.ts`
   - Implementation details:
     - Add `customTitle?: unknown` to `FlowRunBody`.
     - Treat non-string values as invalid (`invalid_request`).
     - Trim strings and set `customTitle` to `undefined` when empty.
     - Include `customTitle` in the parsed body output and in the `startFlowRun` call.
3. [ ] Thread `customTitle` through flow run parameters:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/flows/types.ts`
     - `server/src/flows/service.ts`
   - Implementation details:
     - Update `FlowRunStartParams` to include `customTitle?: string`.
     - Pass `customTitle` into `ensureFlowConversation` and `ensureAgentState` calls.
     - Update `ensureAgentState` and `ensureFlowAgentConversation` signatures to accept the optional title.
4. [ ] Apply `customTitle` when creating flow conversations:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/flows/types.ts`
     - `server/src/flows/service.ts`
   - Implementation details:
     - Update the `startFlowRun` parameter type to accept `customTitle?: string`.
     - When creating the main flow conversation, use `customTitle` as the title when provided (fallback to `Flow: <flowName>`).
     - When creating per-agent flow conversations, use `${customTitle} (${identifier})` when provided (fallback to `Flow: <flowName> (<identifier>)`).
     - Do **not** rename existing conversations; only apply the title on creation.
5. [ ] Add integration coverage for custom titles:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/flows.run.basic.test.ts`
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Test expectations:
     - The main flow conversation title reflects `customTitle` when supplied.
     - The per-agent flow conversation title includes `customTitle` + identifier.
     - Empty/whitespace `customTitle` values are ignored.
6. [ ] Update documentation after the server change:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (document `customTitle` in the Flows run behavior section)
     - `openapi.json` (add `customTitle` to `POST /flows/:flowName/run` request body)
     - `projectStructure.md` (only if new fixtures/files are added)
7. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: start a flow run with `customTitle`, confirm the Flows sidebar title and per-agent titles reflect the custom value.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 2. Server: Fix chat-only conversation filtering for agent + flow

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Update the conversations list query so `agentName=__none__` and `flowName=__none__` can be combined without clobbering each other, ensuring chat-only sidebars exclude both agent and flow conversations.

#### Documentation Locations

- Express routing + handlers: Context7 `/expressjs/express/v5.1.0` (route handlers, async error handling)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage)
- Supertest HTTP assertions: https://github.com/forwardemail/supertest (request/expect patterns)

#### Subtasks

1. [ ] Review conversation list query construction:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/mongo/repo.ts`
     - `server/src/routes/conversations.ts`
     - `server/src/test/integration/conversations.list.test.ts`
   - Snippet to locate:
     - `agentName` and `flowName` filter building logic
2. [ ] Combine `agentName=__none__` and `flowName=__none__` filters safely:
   - Documentation to read (repeat):
     - Express routing + handlers: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/mongo/repo.ts`
   - Implementation details:
     - Build each `$or` block separately, then combine them with `$and` when both filters are present.
     - Preserve existing behavior for single filters and explicit `agentName`/`flowName` values.
3. [ ] Add/extend list-conversations tests for combined filters:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
     - Supertest HTTP assertions: https://github.com/forwardemail/supertest
   - Files to edit:
     - `server/src/test/integration/conversations.list.test.ts`
   - Test expectations:
     - `?agentName=__none__&flowName=__none__` returns only chat conversations.
     - `?agentName=__none__&flowName=<name>` returns non-agent flow conversations only.
4. [ ] Update documentation after the query change:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (document combined filter behavior for chat-only lists)
     - `projectStructure.md` (only if new files are added)
5. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: open Chat sidebar with `flowName=__none__` + `agentName=__none__` filters and confirm only chat conversations are listed.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 3. Client: Preserve flowName on WS upserts

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Prevent the Flows page from dropping the active conversation during a `conversation_upsert` by ensuring `flowName` is preserved when WS updates are applied.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/ (render + screen usage)
- MUI Popover API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/popover.md

#### Subtasks

1. [ ] Review Flows page WS upsert handling and conversation list filtering:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/hooks/useConversations.ts`
     - `client/src/hooks/useConversationSidebar.ts`
   - Snippets to locate:
     - `conversation_upsert` event handling
     - `applyWsUpsert` call site
2. [ ] Preserve `flowName` when applying WS updates:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/hooks/useConversations.ts`
   - Implementation details:
     - Forward `event.conversation.flowName` when present.
     - In `applyWsUpsert`, merge missing `flowName` (and `agentName`) from the existing summary before filtering.
     - Ensure per-agent conversations (with `agentName`) are still excluded from the Flows sidebar.
3. [ ] Add/update Flows page tests for WS upserts:
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.test.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - `conversation_upsert` keeps the conversation visible when `flowName` is missing from the payload (merge uses previous value).
4. [ ] Update documentation after the client fix:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (document WS upsert behavior for flow sidebar)
     - `projectStructure.md` (only if new test files are added)
5. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: run a flow, wait for a streamed update, and confirm the Flows sidebar + transcript remain visible (no reset) when WS updates arrive.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 4. Client: Add working-folder picker to Flows page

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add working-folder UI parity to the Flows page using the existing `DirectoryPickerDialog` and `/ingest/dirs` API so users can pick a folder before starting a flow.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
- MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md

#### Subtasks

1. [ ] Review how Agents/Ingest handle working folders and the directory picker:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/ingest/DirectoryPickerDialog.tsx`
     - `client/src/components/ingest/ingestDirsApi.ts`
     - `client/src/pages/FlowsPage.tsx`
2. [ ] Add a directory picker button + dialog to FlowsPage:
   - Documentation to read (repeat):
     - MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
     - MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Reuse the existing `workingFolder` text field; keep manual entry available.
     - Add a “Choose folder…” button to open `DirectoryPickerDialog`.
     - Mirror Agents behavior (`handleOpenDirPicker`, `handlePickDir`, `handleCloseDirPicker`).
     - Keep the selected value on dialog cancel; update on confirm.
3. [ ] Add/update Flows page tests for working-folder selection:
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/flowsApi.run.payload.test.ts`
   - Test expectations:
     - Opening the picker populates the input after selecting a folder.
     - The chosen `working_folder` is sent in the flow run payload.
4. [ ] Update documentation after the UI addition:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (note working-folder picker parity on Flows page)
     - `projectStructure.md` (only if new files are added)
5. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: open Flows page, open the directory picker, select a folder, and confirm the selected path appears in the working folder input.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 5. Client: Add flow info popover

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add the Flows page info (“i”) popover matching the Agents UI, including warnings for disabled flows, Markdown descriptions, and an empty-state message when no content is available.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI Popover API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/popover.md
- MUI IconButton API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
- MUI Tooltip API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/tooltip.md

#### Subtasks

1. [ ] Review the Agents info popover implementation and Flow summary data:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
     - `client/src/pages/FlowsPage.tsx`
2. [ ] Implement the Flows info popover (matching Agents behavior):
   - Documentation to read (repeat):
     - MUI Popover API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/popover.md
     - MUI IconButton API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/icon-button.md
     - MUI Tooltip API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/tooltip.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Implementation details:
     - Show warnings when `disabled === true` and `error` is present.
     - Render the description via the shared Markdown component.
     - When both warning + description are missing, show the same empty-state copy as Agents.
     - Match the popover anchoring (`anchorOrigin` bottom/left; `transformOrigin` top/left).
     - Avoid deprecated `components`/`componentsProps` props in Tooltip/Popover; use default slots unless customization is required.
     - Remove the inline flow description + warning alert beneath the controls so the popover becomes the single source of flow details.
3. [ ] Add/update Flows page tests for the info popover:
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.test.tsx`
   - Test expectations:
     - Popover shows warnings when flow is disabled.
     - Popover shows description when available.
     - Empty-state copy renders when warnings + description are missing.
4. [ ] Update documentation after the UI addition:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (document Flow info popover behavior)
     - `projectStructure.md` (only if new files are added)
5. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: open the Flows info popover and confirm warnings, description, and empty-state behaviors.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 6. Client: Add custom title input + payload

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a custom title input to Flows, send it on new runs only, and disable the field during active/resume runs so the title is immutable once started.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md

#### Subtasks

1. [ ] Review flow run payload handling and Flows page run/resume logic:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/api/flows.ts`
     - `client/src/test/flowsApi.run.payload.test.ts`
2. [ ] Add custom title input and wire it into the run payload:
   - Documentation to read (repeat):
     - MUI TextField API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/text-field.md
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/api/flows.ts`
   - Implementation details:
     - Add `customTitle` state and a text input.
     - Only send `customTitle` when starting a **new** conversation (`isNewConversation === true`) and not when resuming.
     - Disable the input when resuming, when a run is in progress, or when an existing conversation is selected.
     - Clear `customTitle` inside the existing `resetConversation` helper so New Flow + flow changes reset it.
3. [ ] Update flow API + page tests for custom titles:
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsApi.run.payload.test.ts`
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - `customTitle` is included only for new runs.
     - The input disables during resume/inflight states.
4. [ ] Update documentation after the UI addition:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (document custom title behavior)
     - `projectStructure.md` (only if new files are added)
5. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: start a new flow with a custom title and confirm it appears in the Flows sidebar after the run starts.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 7. Client: Add “New Flow” reset action

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Add a “New Flow” action that clears the active conversation and transcript while keeping the selected flow, resetting custom title + working folder for a fresh run.

#### Documentation Locations

- React hooks/state: Context7 `/facebook/react/v19_2_0` (React 19.2 hooks API)
- Jest: Context7 `/websites/jestjs_io_30_0` (test structure)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- MUI Button API (closest to @mui/material 6.4.1): https://llms.mui.com/material-ui/6.4.12/api/button.md

#### Subtasks

1. [ ] Review “New conversation” reset behavior in Agents/Chat:
   - Documentation to read (repeat):
     - React hooks/state: Context7 `/facebook/react/v19_2_0`
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/FlowsPage.tsx`
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
3. [ ] Add/update Flows page tests for the reset action:
   - Documentation to read (repeat):
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - Jest: Context7 `/websites/jestjs_io_30_0`
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Test expectations:
     - Clicking “New Flow” clears the transcript and active conversation.
     - The selected flow remains highlighted and the Run button is still enabled.
4. [ ] Update documentation after the UI addition:
   - Documentation to read (repeat):
     - Markdown Guide: https://www.markdownguide.org/basic-syntax/
   - Files to edit:
     - `design.md` (document new flow reset behavior)
     - `projectStructure.md` (only if new files are added)
5. [ ] Run full lint + format check:
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI: https://prettier.io/docs/cli
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

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
8. [ ] Manual check: click “New Flow” after a run and confirm the transcript clears while the flow selection remains.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- 

---

### 8. Final Task: Validate, document, and summarize

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Run full builds/tests, perform manual verification with Playwright MCP, ensure documentation is up to date, and produce the pull request summary for this story.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/websites/jestjs_io_30_0`
- Cucumber guides: https://cucumber.io/docs/guides/

#### Subtasks

1. [ ] Build the server (`npm run build --workspace server`).
2. [ ] Build the client (`npm run build --workspace client`).
3. [ ] Perform a clean Docker build (`npm run compose:build`).
4. [ ] Ensure `README.md` is updated with any required description/command changes for this story.
5. [ ] Ensure `design.md` is updated with any required behavior or diagram updates for this story.
6. [ ] Ensure `projectStructure.md` is updated with any added/removed/renamed files.
7. [ ] Create a pull request summary covering all changes in this story.

#### Testing

1. [ ] Run client Jest tests (`npm run test --workspace client`).
2. [ ] Run server tests (`npm run test --workspace server`).
3. [ ] Restart the Docker environment (`npm run compose:down`, then `npm run compose:up`).
4. [ ] Run e2e tests (`npm run e2e`).
5. [ ] Use Playwright MCP to manually verify flows run UX and save screenshots to `test-results/screenshots/` using the naming pattern:
   - `0000030-8-flows-run.png`
   - `0000030-8-flow-info-popover.png`
   - `0000030-8-working-folder-picker.png`
   - `0000030-8-custom-title.png`
   - `0000030-8-new-flow-reset.png`

#### Implementation notes

- 

## Reference: Agents “i” button UX (must match)

- Shows **Warnings** header when warnings exist, listing each warning.
- Shows the agent description rendered as Markdown inside an outlined panel.
- If both warnings and description are missing, displays: “No description or warnings are available for this agent yet.”
- Uses a popover anchored to the info icon with left-bottom anchoring.
- Use MUI Popover positioning (`anchorOrigin: { vertical: 'bottom', horizontal: 'left' }`, `transformOrigin: { vertical: 'top', horizontal: 'left' }`) so the popover behaves like other MUI info popovers.

## Reference: Directory Picker UX (must match)

- Uses the existing `DirectoryPickerDialog` component and `GET /ingest/dirs` endpoint.
- Shows base path, current path, list of child directories, and “Use this folder” action.
- Includes loading and error states identical to the Ingest/Agents usage.
