# Story 0000049 PR Summary

## What Changed

Story 49 centralizes long-transcript rendering for Chat, Agents, and Flows under the shared transcript layer in `client/src/components/chat/` instead of leaving each page with its own inline transcript bubble loop. The work stages this through shared Chat extraction, Agents composer isolation, Agents and Flows adoption, shared transcript state ownership, a shared scroll contract, virtualization, and final dynamic row remeasurement for streaming and expandable rich rows.

## Major Story Steps

- Task 1 extracted the first shared Chat transcript foundation into `SharedTranscript.tsx`, `SharedTranscriptMessageRow.tsx`, transcript formatting helpers, and shared tool-detail rendering.
- Task 2 isolated the Agents composer from transcript rerenders with `AgentsComposerPanel.tsx` and `AgentsTranscriptPane.tsx` so typing in `agent-input` no longer walks the full transcript subtree on every keystroke.
- Task 3 added the narrow allowed server-side exception for stop-near-complete Flow and coding-agent runs so deferred websocket final status stays aligned with persisted assistant-turn status, with diagnostic breadcrumbs for stop-path investigation.
- Task 4 moved Agents onto the shared transcript path while preserving agent-specific warning, stopped-marker, and transcript affordances.
- Task 5 moved Flows onto the shared transcript path while preserving `bubble-flow-meta`, retained-assistant behavior, and the explicit no-citations contract.
- Task 6 added the opt-in transcript measurement harness and runtime proof markers for measurement-ready and safe missing-row handling.
- Task 7 centralized transcript row expansion state into `useSharedTranscriptState.ts` so tool, tool-error, citation, and thought-process state survives virtual unmount/remount.
- Task 8 implemented the shared pinned-bottom versus manual-scroll-away contract and anchor preservation in `SharedTranscript.tsx`.
- Task 9 introduced the shared virtualization seam with `@tanstack/react-virtual` and `VirtualizedTranscript.tsx` while keeping container ownership in `SharedTranscript.tsx`.
- Task 10 finished dynamic row remeasurement and virtualization-sensitive regressions, including guarded `DEV-0000049:T10:*` proof markers for row growth and settling.

## Validation Summary

- Client build and full client regression wrappers pass on the finished Story 49 code path.
- The story includes a final long-transcript Agents browser regression in `e2e/agents.spec.ts` that seeds a long transcript and proves typing remains usable while the transcript stays populated and scrollable.
- Manual proof markers now exist across the whole story from `DEV-0000049:T01:*` through `DEV-0000049:T11:*`, including the final manual-validation start and completion markers.

## Scope Boundaries

- The final Story 49 diff stays in the client transcript, tests, docs, `client/package.json`, and `package-lock.json` footprint for the completed long-transcript work.
- The only allowed server-side exception was the Task 3 stop-status alignment and diagnostic logging path; no new API, websocket payload, or persisted storage shape was introduced for Story 49.
