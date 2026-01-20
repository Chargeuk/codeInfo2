# Story 0000029 - Flow agent transcripts + inflight hydration

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Flow runs currently create per-agent conversations that appear in the Agents sidebar, but those conversations are empty because turns are only persisted to the flow conversation. Separately, opening a second window during an active run (Agents/Flows/Chat, which all use the same hydration hook) drops previously generated assistant messages and shows only user turns plus the in-flight thinking bubble. This story will ensure per-agent flow conversations contain the expected transcript, and that in-flight snapshot hydration preserves prior assistant output when viewing a run mid-stream from another window. The intended behavior is to treat the REST snapshot as the source of truth and only overlay a single in-flight assistant bubble when the current run is still processing and the snapshot does not already contain that assistant text.

Investigation notes (current behaviour):

- Flow runs set `skipPersistence: true` in `runFlowInstruction`, so `chat.run()` does not store turns for the agent conversation while the flow runner manually persists turns only to the flow conversation. This leaves per-agent conversations empty even though they appear in the Agents sidebar.
- Hydration during inflight runs uses merge/dedupe logic that compares persisted history against a “processing” assistant bubble. When the in-flight assistant content is empty (thinking only), the dedupe logic treats every assistant message as a duplicate and filters them out, leaving only user messages plus the processing bubble.

Context for new contributors:

- Flow runs intentionally maintain two conversation types: a flow conversation that stores the merged transcript (used by the Flows page) and per-agent conversations keyed by agent name (used by the Agents sidebar). The current bug is that flow steps only persist to the flow conversation.
- The REST snapshot endpoint already returns all persisted turns plus a merged inflight snapshot, so the client should treat it as authoritative and only overlay an in-flight assistant bubble when the server snapshot does not already include assistant text.
- The in-flight snapshot only includes an assistant turn if there is assistant text or a final status; when the assistant is “thinking” with empty text, no assistant turn is present in the snapshot, which is why the client overlay is still required.

Visual reference (missing assistant history during inflight view):

- `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/missing-agent-turns.png` shows an Agents conversation opened mid-run in a second window: only the user messages and the current processing/thought bubble appear, while prior assistant replies are missing from the transcript.

---

## Acceptance Criteria

- After a flow run completes, each per-agent conversation shown in the Agents sidebar contains the full transcript for that agent:
  - All user messages and assistant replies from the flow steps that targeted that agent appear in order.
  - The per-agent transcript is not empty and matches what the flow run produced for that agent.
- The flow conversation still retains the merged flow transcript (including command metadata) and is unchanged in structure.
- When a second window/tab opens during an in-progress run on the Chat, Agents, or Flows pages:
  - The transcript shows all previously persisted user and assistant messages (no missing assistant replies).
  - Exactly one in-flight assistant bubble is shown (thinking or partial text) for the current inflight run.
- Hydration behavior is deterministic and based on the REST snapshot (`GET /conversations/:id/turns`):
  - The REST snapshot becomes the base transcript state every time a run is hydrated.
  - A single in-flight assistant bubble is layered on top only when the snapshot does **not** already include an assistant turn for the inflight run.
- If the REST snapshot already contains an assistant turn for the inflight run (non-empty assistant text or a finalized status), the UI does **not** add a duplicate assistant bubble.
- When the inflight run changes (new `inflightId`), any previous processing bubble is replaced with the new one.

---

## Out Of Scope

- UI layout or styling changes unrelated to transcript hydration.
- Changes to flow step orchestration, agent discovery, or command schemas.
- Altering persistence backends (Mongo vs memory) beyond ensuring correct turns are stored.

---

## Questions

Resolved:

- Persist per-agent flow conversations the same way as direct agent runs (full duplication of that agent’s portion of the flow transcript).
- No UI cue is needed to indicate duplication.
- Flow-created agent conversations should remain visible in the Agents sidebar (and will be persisted).
- Use the REST snapshot as the source of truth and only overlay in-progress output from the AI when needed.
- If the REST snapshot already includes inflight assistant text (non-empty assistantText or finalized status), skip the overlay to avoid duplicate bubbles.
- Only one processing bubble should exist at a time; use the newest inflight snapshot by `seq`, and replace the processing bubble when the inflight ID changes.

Open:

None.

---

## Scope Review & Research Notes

Scope assessment:

- The story is well scoped for a focused persistence + hydration fix: it targets flow-run persistence and the client’s inflight merge logic without introducing new UI redesigns or new API shapes.
- The scope will stay tight if changes are limited to:
  - Server flow execution/persistence (flow + per-agent conversations).
  - Client hydration logic in the existing turns hook used by Chat/Agents/Flows.
- Improvement suggestion (scope guardrails): explicitly validate at least one multi-agent flow run to confirm per-agent transcripts do not leak across agents, and verify a second-window inflight hydration check on each page that uses `useConversationTurns` (Chat/Agents/Flows).

Research findings (codebase):

- Flow conversations and per-agent flow conversations are created in `server/src/flows/service.ts` via `ensureFlowConversation` and `ensureFlowAgentConversation`, but flow execution currently sets `skipPersistence`, so agent conversations never receive their turns.
- Turn persistence is centralized in `server/src/chat/interfaces/ChatInterface.ts` (Mongo + memory fallback); `server/src/chat/memoryPersistence.ts` holds the in-memory stores used when Mongo is unavailable.
- Inflight snapshots are produced by `server/src/chat/inflightRegistry.ts` (`snapshotInflightTurns`) and merged into `GET /conversations/:id/turns` responses; ordering + dedupe are covered by `server/src/test/integration/conversations.turns.test.ts`.
- Flow run persistence/resume behavior is already covered by `server/src/test/integration/flows.run.resume.test.ts`, while flow run error/lock cases are covered by `server/src/test/integration/flows.run.errors.test.ts`.
- The client merge path is split between `client/src/hooks/useConversationTurns.ts` (REST snapshot + inflight state) and `client/src/hooks/useChatStream.ts` (hydration/stream merge); Chat, Agents, and Flows all import `useConversationTurns` (verified in `client/src/pages/ChatPage.tsx`, `AgentsPage.tsx`, and `FlowsPage.tsx`).

Tests/fixtures likely impacted:

- Server: flow run integration tests (`flows.run.basic`, `flows.run.resume`) and inflight snapshot tests (`conversations.turns`).
- Client: `useConversationTurns` refresh tests and page-level tests for Agents/Flows/Chat hydration behavior.

Unknowns resolved:

- The hydration path is centralized (`useConversationTurns`) and shared by Chat/Agents/Flows.
- No new API or storage schema changes are required; the fix should reuse existing conversation/turn persistence.
- Deepwiki does not currently have indexed docs for this repository, so codebase + Context7 + web sources are the available references.

External reference check:

- React state guidance emphasizes avoiding redundant/duplicate state and using a single source of truth for derived UI (React “Choosing the State Structure” and “You Might Not Need an Effect” docs); this aligns with using the REST snapshot as the base transcript state and avoiding duplicate in-flight state in the UI.

---

## Implementation Ideas

- **Server: confirm persistence bypass point**
  - Trace flow execution in `server/src/flows/service.ts` (notably `ensureAgentState`, `ensureFlowAgentConversation`, and the flow runner) to identify where persistence is bypassed for per-agent conversations. The current code_info snapshot did not find an explicit `skipPersistence` flag, so the first step is to confirm the actual guard before changing it.

- **Server: persist per-agent flow turns**
  - Update flow execution in `server/src/flows/service.ts` so each agent conversation created for a flow receives user/assistant turns during flow runs (not just the flow conversation). Ensure `flags.flow.agentConversations` remains the mapping source of truth.
  - Confirm `ensureFlowAgentConversation` is used for each agent step and the agent conversation is updated when a step completes.

- **Server: inflight snapshot correctness**
  - Review inflight snapshot generation in `server/src/chat/inflightRegistry.ts` and the merge in `server/src/routes/conversations.ts` so snapshots include the latest inflight state and do not drop persisted assistant turns.
  - Add/adjust tests in `server/src/test/integration/conversations.turns.test.ts` and flow integration tests (`flows.run.basic`, `flows.run.resume`) to cover per-agent turns plus inflight snapshots.

- **Client: useConversationTurns hydration**
  - Update `client/src/hooks/useConversationTurns.ts` to treat the REST snapshot as the base transcript each time it hydrates, then overlay only one inflight assistant bubble when the snapshot does **not** include an assistant turn for the inflight run.
  - Validate the inflight overlay decision point in `client/src/hooks/useChatStream.ts` (for example `ensureAssistantMessage`) so inflight assistant bubbles map to a single `inflightId` and do not erase persisted assistant turns from the snapshot.
  - Ensure the overlay resets when `inflightId` changes; avoid duplicate assistant bubbles when the snapshot already contains assistant text or a finalized status.
  - Extend hook tests (`client/src/test/useConversationTurns.refresh.test.ts`) and page-level tests (Agents/Flows/Chat if they share the hook) to assert the new behavior.

- **Evidence**
  - Capture screenshots reproducing the “missing assistant history during inflight” bug before/after to validate the fix for Agents and Flows (and Chat if applicable).

---

## Message Contracts & Storage Impact

- No new API message contracts or storage schema changes are required for this story.
- Existing flow/chat/agent contracts already carry the data we need:
  - Conversation storage already supports `flowName`, `agentName`, and `flags.flow` for per-agent mappings (`server/src/mongo/conversation.ts`).
  - Turn storage already supports `command` metadata (step index/label/agent info), `usage`/`timing`, and tool calls (`server/src/mongo/turn.ts`).
  - Flow run responses already include `conversationId`, `inflightId`, and `modelId` (`POST /flows/:flowName/run`).
- Inflight snapshots already include assistant text/status and optional command metadata in the `/conversations/:id/turns` response (when an inflight run exists).
- The fix should reuse the current contracts and persistence shape by ensuring per-agent flow turns are written and the client hydration logic uses the REST snapshot as the single source of truth.

---

## Edge Cases and Failure Modes

- **Multiple agents in one flow:** Ensure each agent’s conversation only contains turns from steps targeting that agent and does not leak turns from other agents.
- **Empty assistant output while inflight:** When the inflight assistant has no text (thinking only), the UI should still keep prior assistant messages from the snapshot and show exactly one processing bubble.
- **Inflight snapshot already includes assistant text:** Do not add a duplicate assistant bubble when the snapshot contains a non-empty assistant turn or a finalized status.
- **Inflight ID changes mid-view:** When a new inflight run starts, replace the prior processing bubble instead of stacking multiple inflight bubbles.
- **Resume after reconnect:** If the user opens a second window mid-run and refreshes, the transcript should match the REST snapshot and not drop assistant history.
- **Persistence disabled/temporary failures:** If Mongo is unavailable and persistence falls back to in-memory, ensure flow conversations and per-agent conversations remain consistent within the session.

---

## Implementation Plan

### 1. Server: Persist per-agent flow transcripts

- Task Status: **__done__**
- Git Commits: 7c87179

#### Overview

Ensure each flow step also persists its user/assistant turns into the per-agent flow conversation, while keeping the merged flow conversation intact.

#### Documentation Locations

- Express routing (server handlers): Context7 `/expressjs/express/v5.1.0` (Express 5 route handler signatures + async handlers)
- Node.js test runner: https://nodejs.org/api/test.html (`node:test` usage, `test`/`describe`/`it` aliases)
- Supertest HTTP assertions: https://github.com/forwardemail/supertest (request/expect patterns for integration tests)
- ws WebSocket client/server: https://www.npmjs.com/package/ws (WS client API used by test harness)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (sequence diagram syntax for design updates)
- Mermaid sequence diagram reference (DeepWiki): `mermaid-js/mermaid` (sequence diagram syntax)
- Mermaid 11.12.1 release notes: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.12.1 (confirm version-specific syntax)
- Playwright docs: Context7 `/microsoft/playwright` (browser automation for manual verification)
- Playwright Page screenshot API: https://playwright.dev/docs/api/class-page (page.screenshot usage for evidence capture)
- Docker/Compose docs: Context7 `/docker/docs` (compose CLI behavior for local testing)
- Docker Compose CLI reference: https://docs.docker.com/reference/cli/docker/compose/ (build/up/down commands in testing)
- Docker Compose logs: https://docs.docker.com/reference/cli/docker/compose/logs/ (log inspection during manual checks)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (workspace script execution)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint options + exit codes)
- Prettier CLI: https://prettier.io/docs/cli (`--check` vs `--write` formatting flows)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates syntax)

#### Subtasks

1. [x] Review flow persistence path (flow conversation):
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/flows/flowState.ts`
     - `server/src/flows/types.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
   - Snippet to locate (flow persistence path):
     - `ensureFlowConversation`, `runFlowUnlocked`, `runFlowInstruction`
     - `skipPersistence: true` in flow execution paths
   - Story requirements to repeat here so they are not missed:
     - The flow conversation remains the merged transcript and keeps command metadata.

2. [x] Review agent conversation mapping + resume state:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/flows/flowState.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/mongo/repo.ts`
   - Snippet to locate (agent conversation mapping):
     - `ensureFlowAgentConversation`, `agentConversationState`, `persistFlowResumeState`
   - Story requirements to repeat here so they are not missed:
     - Per-agent flow conversations must contain user + assistant turns for their steps.

3. [x] Persist per-agent flow turns in Mongo-backed storage:
   - Documentation to read (repeat):
     - Express routing: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/flows/flowState.ts`
     - `server/src/mongo/repo.ts`
   - Files to edit:
     - `server/src/flows/service.ts`
   - Snippet to locate (existing helpers + state):
     - `persistFlowTurn(...)` (writes `appendTurn` + `updateConversationMeta`)
     - `runFlowInstruction(...)` around `skipPersistence: true`
     - `getAgentKey(...)` / `agentConversationState`
   - Implementation details:
     - Reuse the existing `persistFlowTurn(...)` helper already defined in `flows/service.ts`; **do not** create a new persistence helper.
     - Confirm `runFlowInstruction(...)` already persists per-agent user + assistant turns via `conversationId: params.agentConversationId`; only adjust if a gap is found.
     - Reuse the same `createdAt` timestamps (`userCreatedAt`, `assistantCreatedAt`) so per-agent ordering matches the flow transcript order.
     - Keep `skipPersistence: true` in `chat.run()` so the agent conversation is **only** persisted via these explicit calls.
     - Preserve existing flow behavior: do not change the merged flow conversation, and do not alter `flags.flow` structure.
     - Reuse the existing `command` metadata payload (no new metadata shaping).
     - Do **not** call `markInflightPersisted` for the agent conversation (inflight tracking stays on the flow conversation only).

4. [x] Mirror per-agent flow persistence for memory fallback:
   - Documentation to read (repeat):
     - Express routing: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/chat/memoryPersistence.ts`
   - Files to edit:
     - `server/src/flows/service.ts`
   - Snippet to locate (memory helpers):
     - `recordMemoryTurn(...)` and `updateMemoryConversationMeta(...)`
   - Implementation details:
     - Confirm the existing per-agent `persistFlowTurn(...)` calls run in memory mode (test mode or Mongo down) and write to `memoryTurns`.
     - Use the existing `recordMemoryTurn(...)` behavior without adding new helper functions.
     - Keep memory conversation metadata aligned with Mongo behavior by relying on `updateMemoryConversationMeta(...)` in the existing helper.
     - Verify in memory mode that `memoryConversations.get(agentConversationId)?.lastMessageAt` advances for both user and assistant turns.

5. [x] Align existing per-agent persistence log line:
   - Documentation to read (repeat):
     - Express routing: Context7 `/expressjs/express/v5.1.0`
   - Files to read:
     - `server/src/flows/service.ts`
   - Files to edit:
     - `server/src/flows/service.ts`
   - Snippet to locate (existing log line):
     - `flows.agent.turn_persisted`
   - Implementation details:
     - Ensure the existing `flows.agent.turn_persisted` log line includes context: `{ flowConversationId, agentConversationId, agentType, identifier, role, turnId }`.
     - Keep logging consistent with the flow logger already used in `flows/service.ts` (do not introduce a second logger).

6. [x] Test (integration/server): Per-agent transcript populated (single agent)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - Integration test (server)
   - Files to read:
     - `server/src/test/integration/flows.run.loop.test.ts`
     - `server/src/flows/service.ts` (for `getAgentKey(...)` + `agentConversationState` usage)
   - Files to edit:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Description:
     - Start a flow with a single agent step, read `memoryConversations.get(flowConversationId)?.flags?.flow?.agentConversations`, then assert the mapped agent conversation ID has both a user turn and assistant turn in `memoryTurns`.
     - Assert counts explicitly (e.g., `userTurns.length === 1`, `assistantTurns.length === 1`) and verify their `content` strings match the flow step instruction/response.
   - Purpose:
     - Confirms per-agent conversations are no longer empty after flow runs.

7. [x] Test (integration/server): Multi-agent isolation
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - Integration test (server)
   - Files to read:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Files to edit:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Description:
     - Run a flow with two different agent identifiers, capture both agent conversation IDs from `flags.flow.agentConversations`, and assert each `memoryTurns` entry only includes the step content for that agent.
     - Explicitly assert that the “other agent” content is absent from each conversation.
   - Purpose:
     - Ensures turns don’t leak across agents in multi-agent flows.

8. [x] Test (integration/server): Flow conversation remains merged
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - Integration test (server)
   - Files to read:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Files to edit:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Description:
     - Run a multi-step flow and assert the main flow conversation `memoryTurns` still includes the full merged transcript, including `turn.command` metadata for flow steps.
     - Assert the number of flow turns matches the expected steps (user + assistant pairs per step) to prove no turns were dropped.
   - Purpose:
     - Confirms per-agent persistence does not alter the merged flow conversation structure.

9. [x] Test (integration/server): Failed flow step persists to agent conversation
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Test type:
     - Integration test (server)
   - Files to read:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Files to edit:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Description:
     - Use the existing “break step fails on invalid JSON response” flow, then assert the agent conversation ID in `flags.flow.agentConversations` has an assistant turn with `status: 'failed'` (or `stopped` if that status is emitted) and content fallback.
   - Purpose:
     - Ensures error cases still persist per-agent turns for debugging.

10. [x] Documentation update: `design.md` (mermaid diagram)
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a short section describing per-agent flow transcript persistence and include a Mermaid sequence diagram showing flow steps writing to both flow and agent conversations.

11. [x] Documentation update: `projectStructure.md` (after new files are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include (after the manual Playwright screenshots are captured in Testing step 8):
       - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-agent-transcripts.png`
       - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-flow-transcript.png`

12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

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
     - Jest: Context7 `/jestjs/jest`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
6. [x] `npm run compose:build`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
7. [x] `npm run compose:up`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
8. [x] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a flow, open the agent conversation in the Agents sidebar, confirm the transcript includes the flow’s user + assistant turns, then open the Flows page and confirm the merged flow transcript (with command metadata) is intact, and confirm the debug console shows no errors.
   - Confirm server logs include `flows.agent.turn_persisted` entries for each agent step with the expected `agentConversationId`, `agentType`, and `role` values (use `docker compose logs --tail=200 server`).
   - Capture Playwright MCP screenshots for the agent transcript and the flow transcript, confirm they appear under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`, then move/rename them to:
     - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-agent-transcripts.png`
     - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-flow-transcript.png`
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [x] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- Reviewed flow persistence + agent conversation mapping across flow service/state and persistence helpers to locate `skipPersistence` and resume-state usage.
- Added per-agent persistence using the existing `persistFlowTurn` helper and aligned timestamps with flow conversation turns.
- Confirmed memory persistence paths are reused via `persistFlowTurn` so agent transcripts hydrate in memory mode without extra helpers.
- Added `flows.agent.turn_persisted` log entries with flow + agent conversation context for both user and assistant turns.
- Added integration coverage in `flows.run.loop.test.ts` for single-agent transcripts, multi-agent isolation, merged flow conversation metadata, and failed-step persistence.
- Added `server/src/test/fixtures/flows/multi-agent.json` to drive multi-agent isolation + merged transcript assertions.
- Documented per-agent flow persistence in `design.md` with a sequence diagram showing flow + agent conversation writes.
- `npm run build --workspace server` passed.
- `npm run build --workspace client` passed (chunk-size warning noted by Vite).
- `npm run test --workspace server` required extended timeout; updated `flows.list.test.ts` to include the new `multi-agent` fixture and reran until green.
- `npm run test --workspace client` passed (JSDOM console warnings from markdown tests persist as in baseline).
- `npm run e2e` passed (compose build + up/test/down).
- `npm run compose:build` completed successfully.
- `npm run compose:up` started the stack successfully.
- Manual Playwright check: ran `execute_plan`, refreshed the Flows list, and confirmed the flow transcript renders command metadata.
- Manual Playwright check: switched to Agents with `planning_agent`, selected `Flow: execute_plan (planner)`, and verified user/assistant turns were present.
- `docker compose logs --tail=200 server` showed `flows.agent.turn_persisted` entries during the flow run.
- Saved MCP screenshots to `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/` and updated `projectStructure.md`.
- `npm run lint --workspaces` completed with existing import-order warnings.
- `npm run format:check --workspaces` failed on `server/src/test/integration/flows.run.loop.test.ts`, fixed via `npm run format --workspaces`, and rechecked clean.
- `npm run compose:down` completed successfully.

---

### 2. Client: Inflight snapshot hydration overlay

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make the REST snapshot the base transcript in `useConversationTurns`, then overlay at most one inflight assistant bubble only when the snapshot does not already include assistant output for the inflight run.

#### Documentation Locations

- React state + effects guidance: Context7 `/websites/react_dev` (useEffect cleanup + async fetch patterns)
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/ (render/screen queries used in tests)
- Testing Library user-event: https://testing-library.com/docs/user-event/intro (userEvent.setup + interaction simulation)
- Jest DOM matchers: https://testing-library.com/docs/ecosystem-jest-dom/ (custom matchers like toBeInTheDocument)
- React Router 7.9.x data routers: Context7 `/remix-run/react-router/react-router_7.9.4` (createMemoryRouter/RouterProvider test setup; closest to repo 7.9.6)
- Jest docs: Context7 `/jestjs/jest` (test structure, async matchers)
- Jest 30.x docs: Context7 `/websites/jestjs_io_30_0` (version-aligned API references)
- Jest Getting Started: https://jestjs.io/docs/getting-started (CLI usage + matcher patterns)
- Jest 30.2.0 release notes: https://github.com/jestjs/jest/releases/tag/v30.2.0 (version-specific changes)
- MUI useMediaQuery hook (closest available 6.4.12 docs; repo uses @mui/material 6.5.0): https://llms.mui.com/material-ui/6.4.12/components/use-media-query.md (responsive layout behavior in Chat/Agents pages)
- Mermaid diagrams: Context7 `/mermaid-js/mermaid` (sequence diagram syntax for design updates)
- Mermaid sequence diagram reference (DeepWiki): `mermaid-js/mermaid` (sequence diagram syntax)
- Mermaid 11.12.1 release notes: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.12.1 (confirm version-specific syntax)
- Playwright docs: Context7 `/microsoft/playwright` (browser automation for manual verification)
- Playwright Page screenshot API: https://playwright.dev/docs/api/class-page (page.screenshot usage for evidence capture)
- Docker/Compose docs: Context7 `/docker/docs` (compose CLI behavior for local testing)
- Docker Compose CLI reference: https://docs.docker.com/reference/cli/docker/compose/ (build/up/down commands in testing)
- Docker Compose logs: https://docs.docker.com/reference/cli/docker/compose/logs/ (log inspection during manual checks)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (workspace script execution)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint options + exit codes)
- Prettier CLI: https://prettier.io/docs/cli (`--check` vs `--write` formatting flows)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates syntax)

#### Subtasks

1. [ ] Review REST snapshot hydration (useConversationTurns):
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/test/useConversationTurns.refresh.test.ts`
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Snippet to locate (snapshot + inflight state):
     - `fetchSnapshot(...)`, `setTurns(...)`, and `setInflight(...)` in the refresh path
     - `/conversations/:id/turns` fetch URL (no `includeInflight` query param; inflight snapshot is always included server-side)
   - Story requirements to repeat here so they are not missed:
     - REST snapshot is always the base transcript state.
     - Overlay only one inflight assistant bubble if snapshot lacks inflight assistant output.
     - No duplicate assistant bubbles when snapshot already includes inflight assistant text/final state.

2. [ ] Review streaming hydration + inflight overlay (useChatStream):
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`
   - Snippet to locate (overlay + dedupe):
     - `hydrateHistory(...)` merge logic
     - `hydrateInflightSnapshot(...)` + `ensureAssistantMessage(...)` (existing inflight overlay path)
     - `HYDRATION_DEDUPE_WINDOW_MS` (existing dedupe window constant)
   - Story requirements to repeat here so they are not missed:
     - Hydration must not drop prior assistant history when inflight content is empty.
     - Only one inflight assistant bubble should exist per inflight run.

3. [ ] Add snapshot inflight-assistant detection logic:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Snippet to locate (inflight payload):
      - `type InflightSnapshot` (fields: `assistantText`, `startedAt`, `inflightId`)
      - `const inflight = data.inflight ? (...) : null;`
      - `const data = (await res.json()) as ApiResponse;` and `const hydrated = items.map(...)`
   - Implementation details:
      - Reuse the existing `data.inflight` snapshot fields (`assistantText`, `startedAt`) and the hydrated turn list to determine if an inflight assistant turn already exists.
      - Treat the snapshot as authoritative; detection must not introduce new helper utilities unless necessary.
      - Detection rules:
        - Treat any assistant turn with `createdAt` at/after `data.inflight.startedAt` as already-present (regardless of status).
        - Do not perform string matching on `assistantText`; the timestamp check is sufficient and simpler.
     - Matching guidance (for junior devs):
       - Use only `createdAt >= startedAt` on assistant-role turns to detect the inflight assistant.
       - Keep logic inline in `fetchSnapshot` to avoid new helpers.
     - Example shape (adapt to existing variables):
       - `const startedAtMs = Date.parse(inflight.startedAt);`
       - `const assistantPresent = hydrated.some(turn => turn.role === 'assistant' && Date.parse(turn.createdAt) >= startedAtMs);`
     - Reminder from acceptance criteria:
       - If an assistant turn already exists, the UI must **not** add a second inflight bubble.

4. [ ] Apply snapshot-first overlay state rules:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Snippet to locate (state updates):
     - `setInflight(inflight);`
     - `setTurns(dedupeTurns(chronological));`
   - Implementation details:
     - After fetching `/conversations/:id/turns`, treat the returned `items` as the authoritative turns list.
     - Do **not** add an `includeInflight` query param; the server already attaches inflight data by default.
     - Only keep an overlay inflight assistant bubble when no assistant turn exists for the current inflight run (set `inflight` to `null` when already present).
     - Explicitly set `setInflight(null)` before `setTurns(...)` when the snapshot already contains an inflight assistant (so the UI never renders a second bubble).
     - Example ordering (adapt to existing names):
       - `const nextInflight = assistantPresent ? null : inflight;`
       - `setInflight(nextInflight);`
       - `setTurns(dedupeTurns(chronological));`

5. [ ] Reset overlay when the inflight run changes:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Snippet to locate (refresh flow):
     - `const inflight = data.inflight ? (...) : null;`
   - Implementation details:
     - When `inflightId` changes between refreshes, clear any prior overlay state before applying the new inflight bubble.
     - Add a guard so a stale `inflightId` cannot reuse the previous overlay content.
     - Example guard (adapt to existing state):
       - Store the previous `inflightId` in a `useRef` or local variable scoped to `fetchSnapshot`.
       - If `prevInflightId !== inflight.inflightId`, set `setInflight(null)` before applying the new inflight snapshot.

6. [ ] Update hydration de-duplication so empty inflight bubbles do not drop history:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Snippet to locate (dedupe window):
     - `normalizeMessageContent(...)` in `hydrateHistory`
     - `HYDRATION_DEDUPE_WINDOW_MS` (existing dedupe window constant)
     - `if (match.streamStatus === 'processing') { ... }`
   - Implementation details:
     - Reuse `hydrateHistory` and `HYDRATION_DEDUPE_WINDOW_MS`; do not introduce a new dedupe helper or constant.
     - In `hydrateHistory`, only treat a `processing` message as a replacement candidate when the existing message content is non-empty.
     - This prevents an empty inflight bubble from matching every assistant message and removing history during hydration.
     - Ensure the filter path keeps prior assistant messages when `existing.content` is empty and `entry.content` is non-empty.
     - Example check (adapt to existing code):
       - `if (match.streamStatus === 'processing' && !match.content?.trim()) return false;`

7. [ ] Add client log line for overlay decisions:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/logging/logger.ts`
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Snippet to locate (existing log calls):
     - `log('info', 'DEV-0000024:T7:rest_usage_mapped', ...)`
   - Implementation details:
     - Add `log('info', 'DEV-0000029:T2:inflight_overlay_decision', { inflightId, overlayApplied, assistantPresent })` after the snapshot + inflight decision is computed.
     - `overlayApplied` should be `true` only when the UI will render a new inflight bubble.
     - `assistantPresent` should indicate whether a matching assistant turn already exists in the snapshot.
     - Use the existing `log` instance from `createLogger` to keep log formatting consistent with other chat logs.
     - Reminder from acceptance criteria:
       - Manual checks will look for both `overlayApplied: true` and `overlayApplied: false` at different stages of a run.

8. [ ] Test (unit/client): Snapshot retains assistant history during inflight thinking
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Test type:
     - Unit test (client)
   - Files to read:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Files to edit:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Mock a snapshot containing prior assistant turns plus an inflight payload with empty assistant text; ensure the assistant history remains in `turns` and only one inflight bubble is shown.
     - Assert the log line `DEV-0000029:T2:inflight_overlay_decision` includes `overlayApplied: true`.
   - Purpose:
     - Prevents dropping assistant history when inflight output is empty.

9. [ ] Test (unit/client): No duplicate assistant bubble when snapshot includes inflight assistant
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Test type:
     - Unit test (client)
   - Files to read:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Files to edit:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Mock a snapshot where the inflight assistant turn is already present and ensure the overlay does not add another assistant bubble.
     - Assert the log line `DEV-0000029:T2:inflight_overlay_decision` includes `overlayApplied: false`.
   - Purpose:
     - Ensures the snapshot remains the single source of truth when assistant text exists.

10. [ ] Test (unit/client): No overlay when snapshot has finalized inflight assistant (empty text)
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Test type:
     - Unit test (client)
   - Files to read:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Files to edit:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Mock `data.inflight.assistantText` as empty and include an assistant turn with `createdAt` >= `data.inflight.startedAt` (status can be `ok`, `failed`, or `stopped`), then assert the overlay is cleared (no extra inflight bubble).
     - Assert the log line `DEV-0000029:T2:inflight_overlay_decision` includes `overlayApplied: false`.
   - Purpose:
     - Confirms the corner case where inflight finalization is already in the snapshot.

11. [ ] Test (unit/client): Overlay appears when snapshot has no inflight assistant
    - Documentation to read (repeat):
      - Jest: Context7 `/jestjs/jest`
    - Test type:
      - Unit test (client)
    - Files to read:
      - `client/src/test/useConversationTurns.refresh.test.ts`
    - Files to edit:
      - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Mock an inflight payload with empty `assistantText` and ensure no assistant turns exist at/after `startedAt`; assert the overlay inflight bubble remains present.
     - Assert the log line `DEV-0000029:T2:inflight_overlay_decision` includes `overlayApplied: true`.
    - Purpose:
      - Validates the happy-path overlay behavior for thinking-only inflight runs.

12. [ ] Test (unit/client): Inflight ID change resets overlay
    - Documentation to read (repeat):
      - Jest: Context7 `/jestjs/jest`
    - Test type:
      - Unit test (client)
    - Files to read:
      - `client/src/test/useConversationTurns.refresh.test.ts`
    - Files to edit:
      - `client/src/test/useConversationTurns.refresh.test.ts`
    - Description:
      - Simulate two refreshes with different `inflightId` values and assert the overlay state is replaced, not stacked.
      - Assert the old inflight bubble content is not present after the second refresh.
    - Purpose:
      - Prevents multiple inflight bubbles when a new run starts.

13. [ ] Test (unit/client): Hydration keeps assistant history when inflight bubble is empty
    - Documentation to read (repeat):
      - Jest: Context7 `/jestjs/jest`
    - Test type:
      - Unit test (client)
    - Files to read:
      - `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`
   - Files to edit:
     - `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx` (extend existing inflight snapshot merge suite)
    - Description:
      - Seed `useChatStream` with an empty processing assistant bubble, hydrate history with multiple assistant turns, and assert all assistant turns remain.
      - Assert the assistant count equals the persisted history count (no drops) after hydration.
   - Purpose:
     - Proves the de-duplication fix prevents history loss when inflight content is empty.

14. [ ] Test (integration/server): Inflight final status yields assistant turn even with empty assistantText
    - Documentation to read (repeat):
      - Node.js test runner: https://nodejs.org/api/test.html
    - Test type:
      - Integration test (server)
    - Files to read:
      - `server/src/test/integration/conversations.turns.test.ts`
      - `server/src/chat/inflightRegistry.ts` (for `markInflightFinal` + `snapshotInflightTurns` behavior)
    - Files to edit:
      - `server/src/test/integration/conversations.turns.test.ts`
    - Description:
      - Create an inflight run without assistant deltas, call `markInflightFinal` with `status: 'ok'`, then GET `/conversations/:id/turns` and assert an assistant turn is present with empty content and matching status.
      - Use the existing inflight-only snapshot test as a template and reuse its cleanup pattern.
    - Purpose:
      - Confirms server snapshots always expose final inflight assistant turns for hydration edge cases.

15. [ ] Documentation update: `design.md` (mermaid diagram)
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a Mermaid sequence diagram showing snapshot-first hydration with a conditional inflight overlay.

16. [ ] Documentation update: `projectStructure.md` (after new files are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include (after the manual Playwright screenshot is captured in Testing step 8):
       - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-2-inflight-hydration.png`

17. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

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
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, start a run in one window, open a second window mid-run, verify prior assistant turns remain visible with exactly one inflight bubble, and confirm the debug console shows no errors.
   - Confirm the browser console logs include `DEV-0000029:T2:inflight_overlay_decision` with `overlayApplied: true` when the snapshot lacks assistant output, and `overlayApplied: false` when the snapshot already includes assistant text.
   - Capture a Playwright MCP screenshot and confirm it is stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording it to `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-2-inflight-hydration.png`.
   - Review the screenshot to confirm the UI matches the expected transcript + single inflight bubble state.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 3. Final: Verify acceptance criteria + full regression

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Validate the full story requirements end-to-end and capture final evidence, including builds, tests, screenshots, and documentation updates.

#### Documentation Locations

- Docker Compose CLI reference: https://docs.docker.com/reference/cli/docker/compose/ (build/up/down commands in testing)
- Docker Compose logs: https://docs.docker.com/reference/cli/docker/compose/logs/ (log inspection during manual checks)
- Docker/Compose docs: Context7 `/docker/docs` (compose CLI behavior for local testing)
- Playwright docs: Context7 `/microsoft/playwright` (browser automation for manual verification)
- Playwright Page screenshot API: https://playwright.dev/docs/api/class-page (page.screenshot usage for evidence capture)
- Husky docs: https://typicode.github.io/husky/get-started.html (pre-commit hook behavior)
- Mermaid docs: Context7 `/mermaid-js/mermaid` (sequence diagram syntax)
- Mermaid sequence diagram reference (DeepWiki): `mermaid-js/mermaid` (sequence diagram syntax)
- Mermaid 11.12.1 release notes: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.12.1 (confirm version-specific syntax)
- Jest docs: Context7 `/jestjs/jest` (test structure, async matchers)
- Jest Getting Started: https://jestjs.io/docs/getting-started (CLI usage + matcher patterns)
- Jest 30.2.0 release notes: https://github.com/jestjs/jest/releases/tag/v30.2.0 (version-specific changes)
- Cucumber guides: https://cucumber.io/docs/guides/ (BDD feature/test guidance)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (workspace script execution)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates syntax)

#### Subtasks

1. [ ] Documentation update: `README.md`
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `README.md`
   - Description:
     - Add/adjust any README guidance introduced by this story (flow transcript persistence + inflight hydration behavior if user-facing).

2. [ ] Documentation update: `design.md`
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Confirm flow transcript persistence and hydration diagrams are present and accurate.

3. [ ] Documentation update: `projectStructure.md` (after test screenshots are captured)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include **every** screenshot created in Testing step 8, listing each exact file path under `test-results/screenshots/` (for example `test-results/screenshots/0000029-3-<short-name>.png`).

4. [ ] Log line checklist for final verification (no new logs added here):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to read:
     - `planning/0000029-flow-agent-transcripts-and-inflight-hydration.md` (Task 1 + Task 2 log line subtasks)
   - Description:
     - Record the expected log lines that must appear during Testing step 8:
       - `flows.agent.turn_persisted` (server log, one or more entries per flow step)
       - `DEV-0000029:T2:inflight_overlay_decision` (browser console log, emitted on each snapshot refresh)
     - Note: these log lines are added in Tasks 1 and 2; this subtask only captures expectations for the final manual check.

5. [ ] Draft a concise summary of all story changes
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Description:
     - Summarize server persistence changes, client inflight hydration updates, tests added, and documentation updates.

6. [ ] Create the pull request comment using the summary
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit: none (comment only)

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
     - Prettier CLI/options: https://prettier.io/docs/options
   - Snippet to run:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run lint:fix --workspaces`
     - `npm run format --workspaces`

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
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, verify all acceptance criteria, run a quick regression sweep, capture screenshots to `./test-results/screenshots/`, and confirm the debug console shows no errors.
   - Confirm server logs include `flows.agent.turn_persisted` during flow runs (use `docker compose logs --tail=200 server`) and that at least one entry appears per flow step.
   - Confirm browser console logs include `DEV-0000029:T2:inflight_overlay_decision` for inflight hydration checks and that both `overlayApplied: true` and `overlayApplied: false` appear across the run lifecycle.
   - Each screenshot should be named `0000029-3-<short-name>.png`.
   - Capture Playwright MCP screenshots for every acceptance-criteria UI state and confirm the images are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Review each screenshot to confirm the GUI matches the acceptance criteria and regression expectations.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---
