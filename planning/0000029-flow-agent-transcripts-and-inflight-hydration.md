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

- Per-agent conversations created during flows contain the expected user + assistant turns so the Agents sidebar transcript is complete after a flow run.
- Flow conversations still retain the merged flow transcript with command metadata.
- Opening a second window during an in-progress run shows the full transcript history (user + assistant messages) plus the current in-flight assistant output/thinking, without hiding earlier assistant responses.
- Transcript hydration uses the REST snapshot as the base state; only the active in-flight assistant bubble is layered on top when needed.
- When the REST snapshot already includes an inflight assistant turn (non-empty assistant text or finalized status), the UI does not duplicate the assistant bubble.
- The fix applies consistently for Agents and Flows, and Chat if the same hydration path is used.

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

## Implementation Plan

Tasks will be defined after we agree on the desired behavior for the two issues above.
