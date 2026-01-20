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
- When a second window/tab opens during an in-progress run (Agents/Flows/Chat if it uses the same hydration path):
  - The transcript shows all previously persisted user and assistant messages (no missing assistant replies).
  - Exactly one in-flight assistant bubble is shown (thinking or partial text) for the current inflight run.
- Hydration behavior is deterministic and based on the REST snapshot:
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

Research findings (codebase):

- Flow conversations are created in the flows service; per-agent flow conversations are also created there but currently do not receive persisted turns when `skipPersistence` is active in flow execution.
- Inflight snapshots are produced server-side by the inflight registry and merged into `/conversations/:id/turns` responses.
- The client hook `useConversationTurns` is used by Chat, Agents, and Flows, so a fix here will apply consistently across those pages.

Tests/fixtures likely impacted:

- Server: flow run integration tests (`flows.run.basic`, `flows.run.resume`) and inflight snapshot tests (`conversations.turns`).
- Client: `useConversationTurns` refresh tests and page-level tests for Agents/Flows/Chat hydration behavior.

Unknowns resolved:

- The hydration path is centralized (`useConversationTurns`) and shared by Chat/Agents/Flows.
- No new API or storage schema changes are required; the fix should reuse existing conversation/turn persistence.

External reference check:

- React state guidance emphasizes avoiding duplicated/contradicting state and using a single source of truth for derived UI; this aligns with using the REST snapshot as the base transcript state.

---

## Implementation Ideas

- **Server: persist per-agent flow turns**
  - Update flow execution in `server/src/flows/service.ts` so each agent conversation created for a flow receives user/assistant turns during flow runs (not just the flow conversation). Ensure `flags.flow.agentConversations` remains the mapping source of truth.
  - Confirm `ensureFlowAgentConversation` is used for each agent step and the agent conversation is updated when a step completes.

- **Server: inflight snapshot correctness**
  - Review inflight snapshot generation in `server/src/chat/inflightRegistry.ts` and the merge in `server/src/routes/conversations.ts` so snapshots include the latest inflight state and do not drop persisted assistant turns.
  - Add/adjust tests in `server/src/test/integration/conversations.turns.test.ts` and flow integration tests (`flows.run.basic`, `flows.run.resume`) to cover per-agent turns plus inflight snapshots.

- **Client: useConversationTurns hydration**
  - Update `client/src/hooks/useConversationTurns.ts` to treat the REST snapshot as the base transcript each time it hydrates, then overlay only one inflight assistant bubble when the snapshot does **not** include an assistant turn for the inflight run.
  - Ensure the overlay resets when `inflightId` changes; avoid duplicate assistant bubbles when the snapshot already contains assistant text or a finalized status.
  - Extend hook tests (`client/src/test/useConversationTurns.refresh.test.ts`) and page-level tests (Agents/Flows/Chat if they share the hook) to assert the new behavior.

- **Evidence**
  - Capture screenshots reproducing the “missing assistant history during inflight” bug before/after to validate the fix for Agents and Flows (and Chat if applicable).

---

## Message Contracts & Storage Impact

- No new API message contracts or storage schema changes are required for this story.
- Existing flow/chat/agent contracts already carry the data we need:
  - Flow run responses already include `conversationId`, `inflightId`, and `modelId`.
  - Conversations already support `flowName` and `flags.flow` for per-agent mappings.
  - Inflight snapshots already include assistant text/status and command metadata in the `/conversations/:id/turns` response.
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

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Ensure each flow step also persists its user/assistant turns into the per-agent flow conversation, while keeping the merged flow conversation intact.

#### Documentation Locations

- Express routing (server handlers): Context7 `/expressjs/express/v5.1.0`
- Node.js test runner: https://nodejs.org/api/test.html
- Mermaid diagrams: Context7 `/mermaid-js/mermaid`
- Mermaid 11.12.1 release notes: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.12.1
- Playwright docs: Context7 `/microsoft/playwright` (manual verification + screenshots)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review current flow persistence + agent conversation mapping:
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Files to read:
     - `server/src/flows/service.ts`
     - `server/src/flows/flowState.ts`
     - `server/src/flows/types.ts`
     - `server/src/chat/interfaces/ChatInterface.ts`
     - `server/src/chat/inflightRegistry.ts`
     - `server/src/mongo/repo.ts`
   - Snippet to locate (flow persistence path):
     - `ensureFlowAgentConversation`, `runFlowUnlocked`, `runFlowInstruction`
     - `skipPersistence: true` in flow execution paths
   - Story requirements to repeat here so they are not missed:
     - Per-agent flow conversations must contain user + assistant turns for their steps.
     - The flow conversation remains the merged transcript and keeps command metadata.

2. [ ] Persist per-agent flow turns during execution:
   - Documentation to read (repeat):
     - Express routing: Context7 `/expressjs/express/v5.1.0`
   - Files to edit:
     - `server/src/flows/service.ts`
     - `server/src/chat/inflightRegistry.ts` (only if per-agent inflight persistence needs updates)
     - `server/src/mongo/repo.ts` (only if helper updates are needed)
   - Implementation details:
     - When a flow step runs for an agent, append the user + assistant turns to that agent’s conversation ID (from `agentConversationState` / `flags.flow.agentConversations`).
     - Ensure both Mongo and memory persistence paths record these turns (mirror the existing flow conversation path).
     - Keep `turn.command` metadata on the flow conversation, and copy it to the agent conversation turns when available so per-agent transcripts retain step context.
     - Do **not** change the merged flow conversation behavior or existing `flags.flow` structure.

3. [ ] Test (integration/server): Per-agent transcript populated (single agent)
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Location:
     - `server/src/test/integration/flows.run.loop.test.ts` (extend existing integration suite)
   - Description:
     - Start a flow with a single agent step, run it, fetch the agent conversation ID from `flags.flow.agentConversations`, and assert user + assistant turns were persisted.
   - Purpose:
     - Confirms per-agent conversations are no longer empty after flow runs.

4. [ ] Test (integration/server): Multi-agent isolation
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Location:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Description:
     - Run a flow with two different agent identifiers and assert each agent conversation only contains turns for its own steps.
   - Purpose:
     - Ensures turns don’t leak across agents in multi-agent flows.

5. [ ] Test (integration/server): Flow conversation remains merged
   - Documentation to read (repeat):
     - Node.js test runner: https://nodejs.org/api/test.html
   - Location:
     - `server/src/test/integration/flows.run.loop.test.ts`
   - Description:
     - Run a flow with multiple steps and assert the flow conversation (the main `conversationId`) still contains the merged transcript with command metadata.
   - Purpose:
     - Confirms per-agent persistence does not alter the merged flow conversation structure.

6. [ ] Capture UI screenshots (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-agent-transcripts.png`
     - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-flow-transcript.png`
   - Description:
     - Use Playwright MCP to capture the Agents sidebar showing a flow-generated agent conversation with its transcript visible.
     - Capture a second screenshot on the Flows page showing the merged flow conversation transcript.
   - Purpose:
     - Provides visual evidence the agent transcript is now populated.
     - Confirms the flow transcript remains intact in the Flows UI.

7. [ ] Documentation update: `design.md` (mermaid diagram)
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a short section describing per-agent flow transcript persistence and include a Mermaid sequence diagram showing flow steps writing to both flow and agent conversations.

8. [ ] Documentation update: `projectStructure.md` (after new files are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-agent-transcripts.png`
       - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-1-flow-transcript.png`

9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
8. [ ] Manual Playwright-MCP check: open `http://host.docker.internal:5001`, run a flow, open the agent conversation in the Agents sidebar, confirm the transcript includes the flow’s user + assistant turns, then open the Flows page and confirm the merged flow transcript (with command metadata) is intact, and confirm the debug console shows no errors.
   - Capture Playwright MCP screenshots for the agent transcript and the flow transcript, and confirm they are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---

### 2. Client: Inflight snapshot hydration overlay

- Task Status: **__to_do__**
- Git Commits: **__to_do__**

#### Overview

Make the REST snapshot the base transcript in `useConversationTurns`, then overlay at most one inflight assistant bubble only when the snapshot does not already include assistant output for the inflight run.

#### Documentation Locations

- React state + effects guidance: Context7 `/websites/react_dev`
- Jest docs: Context7 `/jestjs/jest` (client tests)
- Jest 30.2.0 release notes: https://github.com/jestjs/jest/releases/tag/v30.2.0
- Mermaid diagrams: Context7 `/mermaid-js/mermaid`
- Mermaid 11.12.1 release notes: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.12.1
- Playwright docs: Context7 `/microsoft/playwright` (manual verification + screenshots)
- Docker/Compose docs: Context7 `/docker/docs` (compose checks in testing steps)
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script (build/test scripts)
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface (lint command behavior)
- Prettier CLI: https://prettier.io/docs/cli (format check/write behavior)
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (documentation updates)

#### Subtasks

1. [ ] Review current hydration logic in the shared hook:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to read:
     - `client/src/hooks/useConversationTurns.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/useConversationTurns.refresh.test.ts`
     - `client/src/test/useConversationTurns.commandMetadata.test.ts`
   - Snippet to locate (snapshot + inflight state):
     - `setTurns(...)` and `setInflight(...)` in the refresh path
   - Story requirements to repeat here so they are not missed:
     - REST snapshot is always the base transcript state.
     - Overlay only one inflight assistant bubble if snapshot lacks inflight assistant output.
     - No duplicate assistant bubbles when snapshot already includes inflight assistant text/final state.

2. [ ] Update `useConversationTurns` to use snapshot-first overlay rules:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to edit:
     - `client/src/hooks/useConversationTurns.ts`
   - Implementation details:
     - After fetching `/conversations/:id/turns`, treat the returned `items` as the authoritative turns list.
     - Reuse the existing `data.inflight` snapshot fields (`assistantText`, `startedAt`) and the hydrated turn list to decide if an inflight assistant turn is already present (do not add a new helper unless needed).
     - Determine whether the snapshot already includes an assistant turn for the active inflight run:
       - If `data.inflight.assistantText` is non-empty, treat any matching assistant turn as already-present.
       - If `data.inflight.assistantText` is empty, treat any assistant turn with `status` of `failed` or `stopped` and a `createdAt` at/after `data.inflight.startedAt` as already-present.
     - Only keep an overlay inflight assistant bubble when no assistant turn exists for the current inflight run (set `inflight` to `null` when already present).
     - When `inflightId` changes, clear any prior overlay state before applying the new inflight bubble.

3. [ ] Update hydration de-duplication so empty inflight bubbles do not drop history:
   - Documentation to read (repeat):
     - React hooks guidance: Context7 `/websites/react_dev`
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Implementation details:
     - In `hydrateHistory`, only treat a `processing` message as a replacement candidate when the existing message content is non-empty.
     - This prevents an empty inflight bubble from matching every assistant message and removing history during hydration.

4. [ ] Test (unit/client): Snapshot retains assistant history during inflight thinking
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Mock a snapshot containing prior assistant turns plus an inflight payload with empty assistant text; ensure the assistant history remains in `turns` and only one inflight bubble is shown.
   - Purpose:
     - Prevents dropping assistant history when inflight output is empty.

5. [ ] Test (unit/client): No duplicate assistant bubble when snapshot includes inflight assistant
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Mock a snapshot where the inflight assistant turn is already present and ensure the overlay does not add another assistant bubble.
   - Purpose:
     - Ensures the snapshot remains the single source of truth when assistant text exists.

6. [ ] Test (unit/client): Inflight ID change resets overlay
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/useConversationTurns.refresh.test.ts`
   - Description:
     - Simulate two refreshes with different `inflightId` values and assert the overlay state is replaced, not stacked.
   - Purpose:
     - Prevents multiple inflight bubbles when a new run starts.

7. [ ] Test (unit/client): Hydration keeps assistant history when inflight bubble is empty
   - Documentation to read (repeat):
     - Jest: Context7 `/jestjs/jest`
   - Location:
     - `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx` (extend existing inflight snapshot merge suite)
   - Description:
     - Seed `useChatStream` with an empty processing assistant bubble, hydrate history with multiple assistant turns, and assert all assistant turns remain.
   - Purpose:
     - Proves the de-duplication fix prevents history loss when inflight content is empty.

8. [ ] Capture UI screenshot (required for this task):
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
   - Files to add:
     - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-2-inflight-hydration.png`
   - Description:
     - Use Playwright MCP to capture a second-window view during an in-progress run showing prior assistant history plus a single inflight bubble.

9. [ ] Documentation update: `design.md` (mermaid diagram)
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `design.md`
   - Description:
     - Add a Mermaid sequence diagram showing snapshot-first hydration with a conditional inflight overlay.

10. [ ] Documentation update: `projectStructure.md` (after new files are added)
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Location:
     - `projectStructure.md`
   - Description:
     - Update the repo tree to include:
       - `planning/0000029-flow-agent-transcripts-and-inflight-hydration-data/0000029-2-inflight-hydration.png`

11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Capture a Playwright MCP screenshot and confirm it is stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording it.
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

- Docker/Compose docs: Context7 `/docker/docs`
- Playwright docs: Context7 `/microsoft/playwright`
- Husky docs: https://typicode.github.io/husky/get-started.html
- Mermaid docs: Context7 `/mermaid-js/mermaid`
- Mermaid 11.12.1 release notes: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.12.1
- Jest docs: Context7 `/jestjs/jest`
- Jest 30.2.0 release notes: https://github.com/jestjs/jest/releases/tag/v30.2.0
- Cucumber guides: https://cucumber.io/docs/guides/
- npm run-script docs: https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Markdown Guide: https://www.markdownguide.org/basic-syntax/

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
     - Update the repo tree to include any new screenshots:
       - `test-results/screenshots/0000029-3-<short-name>.png`

4. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Files to edit: none (comment only)

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
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
   - Each screenshot should be named `0000029-3-<short-name>.png`.
   - Capture Playwright MCP screenshots for every acceptance-criteria UI state and confirm the images are stored under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` before moving/recording them.
   - Documentation to read (repeat):
     - Playwright: Context7 `/microsoft/playwright`
9. [ ] `npm run compose:down`
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`

#### Implementation notes

- (fill in during execution)

---
