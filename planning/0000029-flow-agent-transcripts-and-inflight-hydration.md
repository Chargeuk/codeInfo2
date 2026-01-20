# Story 0000029 - Flow agent transcripts + inflight hydration

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Flow runs currently create per-agent conversations that appear in the Agents sidebar, but those conversations are empty because turns are only persisted to the flow conversation. Separately, opening a second window during an active run (Agents/Flows and possibly Chat) drops previously generated assistant messages and shows only user turns plus the in-flight thinking bubble. This story will ensure per-agent flow conversations contain the expected transcript, and that in-flight snapshot hydration preserves prior assistant output when viewing a run mid-stream from another window. The proposed UX fix is to treat the REST snapshot as the source of truth, replacing the transcript with the snapshot and only overlaying a single in-flight assistant bubble when the current run is still processing and the snapshot does not already contain that assistant text.

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
- Use the REST snapshot as the source of truth and only merge in-progress output from the AI.
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

## Implementation Plan

Tasks will be defined after we agree on the desired behavior for the two issues above.
