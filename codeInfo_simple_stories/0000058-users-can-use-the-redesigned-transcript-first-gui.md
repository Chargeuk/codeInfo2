# Users can use the redesigned transcript-first GUI

# Acceptance

1. Users can work in `Chat`, `Agents`, and `Flows` through one shared desktop workspace shell and one shared mobile workspace model.
2. Users can read longer conversations with more vertical transcript space and a bottom-anchored composer.
3. Users can scroll up to older transcript content without being snapped back to the newest message when new activity arrives.
4. Users can use message `Copy` actions that copy only the visible message content and not footer metadata such as status, timing, or provider details.
5. Users can keep the current `Chat`, `Agents`, and `Flows` behavior they already know, including resumed-conversation rules, selector resets, and fresh-run versus resume distinctions.
6. Users can use `Home` as the main system-status page for provider state, auth entry points, and LM Studio controls.
7. Users can still open old `/lmstudio` bookmarks and land in `Home` with the LM Studio section visible.
8. Users can use `Ingest` and `Logs` through the new utility-page layout without changing the existing ingest or logging behavior.
9. Users can rely on the supported runtime to pick up host-backed Codex auth state again in the main and e2e stacks.
10. Users cannot accidentally submit duplicate fresh flow runs from a rapid double-click before the disabled state appears.
11. Users cannot start a second logical fresh flow run when they retry after an ambiguous lost response from an already accepted launch.
12. Support and engineering reviewers can trust the rollout because the story closes with wrapper-first build, test, compose, browser, and final review revalidation for both the main redesign and the review-created follow-up fixes.

# Description

This story redesigns CodeInfo2 around a transcript-first interface so the main workspaces feel like one coherent product instead of separate admin-style pages. It gives users more room to read and work in conversations, moves global runtime setup into `Home`, keeps old LM Studio links working, and preserves the current supported chat, agent, flow, ingest, and log behavior. The final tasked version of the story also includes the follow-up runtime and flow-safety fixes needed to keep Codex auth seeding reliable, prevent duplicate fresh flow launches from rapid replays, and stop ambiguous fresh-run retries from creating a second logical launch.

# Tasks

1. [codeInfo2] - Restyle shared transcript rows and isolate copy payloads

- Update the shared transcript row components so all workspace pages use one transcript presentation.
- Add proof that copy actions include only visible message content and keep the scroll behavior contract honest.

2. [codeInfo2] - Repair the shared client lint baseline and React compiler policy

- Fix the shared client lint and compiler baseline so the redesign can land on a stable frontend foundation.
- Keep the repo-wide client quality rules aligned before later layout tasks build on them.

3. [codeInfo2] - Build the shared workspace shell and conversation pane chrome

- Create the reusable desktop and mobile workspace shell, app rail, and conversation-pane structure.
- Prove shell layout, space reclaim, and state retention before page-specific adapters plug into it.

4. [codeInfo2] - Adapt Chat to the shared workspace shell and bottom composer

- Move `Chat` into the shared shell and bottom composer without changing the conversation model.
- Preserve resumed-chat identity, provider and model rules, and working-folder behavior through focused proof.

5. [codeInfo2] - Adapt Agents to the shared workspace shell while preserving selector resets

- Move `Agents` into the shared shell and composer pattern.
- Keep agent, command, and step reset behavior plus prompt-discovery rules explicit in proof.

6. [codeInfo2] - Adapt Flows to the shared workspace shell while preserving resume semantics

- Move `Flows` into the shared shell and composer pattern while keeping fresh-run and resume behavior separate.
- Preserve custom-title and resume payload rules through targeted client proof.

7. [codeInfo2] - Build the utility status shell and move LM Studio into Home

- Create the shared utility-page shell and migrate provider status, auth entry points, and LM Studio controls into `Home`.
- Preserve the committed-versus-draft LM Studio base-URL lifecycle and prove the new status-page ownership model.

8. [codeInfo2] - Apply the utility shell to Ingest and Logs

- Move `Ingest` and `Logs` into the shared utility-page layout without changing backend behavior.
- Keep the current alerts, filters, and operational controls intact through layout-level proof.

9. [codeInfo2] - Replace top tabs with the shared navigation model and `/lmstudio` compatibility redirect

- Remove the old top-tab navigation and switch the visible route chrome to the shared navigation model.
- Redirect `/lmstudio` into `Home` and prove direct navigation, refresh, and bookmarks still work.

10. [codeInfo2] - Final Story 58 validation and close-out

- Re-run the full redesign validation path and refresh the reviewer-facing closeout summary.
- Keep traceability, wrapper evidence, and final proof ownership honest for the base redesign rollout.

11. [codeInfo2] - Restore host-backed Codex auth seeding for main and e2e stacks

- Repair the compose and startup bootstrap contract so `/host/codex` is a real host-backed seed source again.
- Add targeted server, runtime, and guidance proof so the supported auth-seeding path is trustworthy.

12. [codeInfo2] - Add a real replay barrier for fresh flow runs

- Patch the fresh flow launch seam so one logical new-run intent cannot submit twice before the disabled state commits.
- Prove the replay barrier without breaking resume behavior, payload shaping, or retry-ready reset behavior.

13. [codeInfo2] - Re-validate Story 58 after review pass `0000058-20260520T055359Z-8bffd025`

- Re-run the full current-repository regression pass after the Codex auth and replay-barrier fixes are complete.
- Refresh the final review-cycle summary so the serious findings and inline minor fixes from this review pass close with one final proof owner.

14. [codeInfo2] - Add fresh-run retry idempotency ownership after review pass `0000058-20260520T175414Z-385d67b3`

- Patch the client and server flow-run seam so one fresh-run retry intent keeps one launch identity even after an ambiguous lost response.
- Add focused client, server, Cucumber, and e2e proof that the retry returns the existing accepted launch instead of creating a second logical run.

15. [codeInfo2] - Re-validate Story 58 after review pass `0000058-20260520T175414Z-385d67b3`

- Re-run the broad current-repository regression proof after the retry-ownership repair is complete.
- Refresh the final review-cycle summary so the remaining task-required finding and the inline-resolved minor fixes close under one final revalidation owner.
