# Story 0000059 - Users can rerun a flow in place with the current agent set

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Story 53 introduced an execution boundary so a fresh flow run no longer leaked agent conversations from an older execution. That work deliberately made the `Run` button create a new parent flow conversation and a fresh set of child agent conversations, while `Resume` kept using the stopped execution. The user now wants a different product contract.

From the user's point of view, pressing `Run` on an existing flow should mean "start this flow again here" rather than "fork me into a brand-new flow conversation." The user still wants a fresh execution, but they want it to happen inside the currently selected flow conversation, using the same active child agent conversations that already belong to that flow. If they want a brand-new parent flow conversation and a brand-new set of child agent conversations, that should happen only through `New Flow`.

This creates three distinct user actions that must stay easy to understand:

- `Run` starts a fresh execution in the currently selected flow conversation.
- `New Flow` creates a new parent flow conversation and therefore a fresh child-agent set.
- `Resume` continues a previously stopped execution.

The important part is that a fresh execution and a fresh flow are no longer the same thing. A fresh execution still needs its own execution identity so the runtime can distinguish one run from another, clear any stopped-step bookkeeping, and avoid accidentally resuming stale paused state. At the same time, an in-place rerun should preserve the current flow conversation and keep using the child agent conversations that already belong to that flow. This makes the flow feel more like a reusable workspace and less like a one-run disposable shell.

This story should stay focused on that contract change only. It should not grow into a full execution-history redesign, a hidden-child-conversation model, or a broader change to how agents appear in the product. Child agent conversations should remain normal visible conversations in the Agents page. Users should still be able to open them, chat manually, and then return to the flow.

The story must also be honest about the current codebase. Story 53 and its proofs currently encode the opposite rule, so this story exists to deliberately replace that contract rather than quietly patch around it. The new implementation must keep the product simple and predictable for the user, even if that means reshaping some of the execution-marker logic added by Story 53.

### Acceptance Criteria

- Pressing `Run` while an existing flow conversation is selected starts a fresh execution in that same parent flow conversation.
- An in-place rerun creates a new execution identity for that run.
- Pressing `Run` in an existing flow conversation does not create a new parent flow conversation row in the Flows sidebar.
- Pressing `Run` in an existing flow conversation reuses the current child agent conversations that already belong to that flow conversation.
- `New Flow` is the only flow action that creates a new parent flow conversation and a fresh set of child agent conversations.
- `Resume` continues the stopped execution rather than starting a new one.
- Starting a fresh execution in place clears or replaces stopped-execution bookkeeping that would otherwise make the next run behave like a resume.
- The server and client contract clearly distinguishes `run in place`, `new flow`, and `resume` semantics instead of relying on ambiguous inference from partially related fields.
- The flow parent conversation remains the source of truth for which child agent conversations belong to that flow workspace.
- Child agent conversations remain visible and usable in the Agents page.
- Manual chat added to a reused child agent conversation remains part of that same child conversation after a later in-place rerun.
- The UI does not leak stale transcript state into the wrong conversation when a run-in-place request fails.
- Existing same-conversation in-flight protection remains coherent so the user cannot accidentally start overlapping runs in the same flow conversation.
- Starting a new flow in a different parent conversation can still create a separate execution without being blocked by an unrelated conversation.
- Browser-visible metadata remains understandable after the contract change, even though repeated `Run` actions no longer create multiple parent conversation rows.
- Automated tests prove the new `Run`, `New Flow`, and `Resume` semantics at the client, server, and end-to-end levels.

### Out Of Scope

- Building a full per-execution history browser inside one flow conversation.
- Preserving separate parent sidebar rows for each rerun in the same flow conversation.
- Hiding or locking flow-created child agent conversations.
- Reworking unrelated flow-step behavior outside the parts needed for the new run semantics.
- Redesigning the general chat or agents sidebars beyond what is necessary to keep the flow contract understandable.
- Adding a broader orchestration system for queued, scheduled, or named execution sessions.
- Changing how normal non-flow conversations work.

### Additional Repositories

- No Additional Repositories

### Questions

None. The product contract for `Run`, `New Flow`, and `Resume` is now fixed for this story.

## Implementation Ideas

- Rework the flow-start contract so the request shape can explicitly represent three modes: `run_in_place`, `new_flow`, and `resume`.
- Update the Flows page so:
  - `Run` keeps the selected parent flow conversation when one already exists;
  - `New Flow` resets to a genuinely fresh parent conversation;
  - `Resume` keeps the current stopped execution behavior.
- Revisit the server flow-start entry point so it no longer treats every non-resume run as a new parent conversation.
- Keep a fresh execution identity for each rerun, but separate that concept from "create a new parent conversation."
- Prefer the parent flow conversation's persisted child-conversation mapping as the stable ownership source for the flow workspace.
- Revisit any child execution-marker logic added by Story 53 so it does not incorrectly reject the now-valid case where the same child conversation is intentionally reused across multiple executions in one flow workspace.
- Reset or replace stale resume-state data before a new in-place run starts so the next execution cannot accidentally inherit an old paused step path, loop stack, or stop state.
- Update client error handling so a failed run-in-place request does not fabricate a fresh conversation or clone stale turns into an unrelated transcript.
- Update sidebar metadata rules so they still help the user understand the current execution state without depending on repeated parent conversation rows.
- Rewrite the Story 53 proofs that currently assert:
  - fresh `Run` creates a new parent conversation;
  - repeated executions create separate parent rows;
  - child execution ownership is always one-execution-only.
- Add focused proof for:
  - `Run` in place reuses the current parent and child conversations;
  - `New Flow` creates a fresh parent and fresh child set;
  - `Resume` continues the stopped execution only;
  - failed run requests do not corrupt the visible transcript;
  - existing in-flight protection still prevents overlapping runs in one conversation.
