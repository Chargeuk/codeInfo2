# Users can use the redesigned transcript-first GUI

# Acceptance

1. Users can work in `Chat`, `Agents`, and `Flows` through one shared desktop workspace shell and one shared mobile workspace model.
2. Users can read longer conversations with more vertical transcript space and a bottom-anchored composer.
3. Users can open an existing conversation at the newest visible content and keep their place when they scroll up to older messages.
4. Users can use message `Copy` actions that copy only the visible message content and not footer metadata.
5. Users can keep the current supported `Chat`, `Agents`, and `Flows` behavior they already know, including resumed-conversation rules, selector resets, and fresh-run versus resume distinctions.
6. Users can use `Home` as the main system-status page for provider state, auth entry points, and LM Studio controls.
7. Users can still open old `/lmstudio` bookmarks and land in `Home` with the LM Studio section visible.
8. Users can use `Ingest` and `Logs` through the new utility-page layout without changing the existing ingest or logging behavior.
9. Users can rely on the supported runtime to pick up host-backed Codex auth state again in the main and e2e stacks.
10. Users cannot accidentally submit duplicate fresh flow runs from rapid retries, ambiguous replays, or stale retry ownership.
11. Users and operators can rely on the documented host Codex-home launcher contract instead of a silent fallback runtime path.
12. Users get the final desktop and mobile shell, conversation-row, transcript, and composer polish promised by the Story 58 design contract.
13. Users cannot select arbitrary mounted working folders unless the application can still prove the folder belongs to an ingested repository under the intended contract.
14. Users do not lose a newer saved working-folder choice because an older restore or cleanup path clears stale state.
15. Users cannot let a contradictory fresh-run replay or weaker resumed child-provider history silently overwrite the accepted parent flow identity.
16. Users keep an accepted flow or agent launch visible even if the follow-up conversation refresh fails.
17. Users do not see a stale aborted conversation request clear loading state for a newer in-flight request.
18. Support and reviewers can rely on refreshed retained visual proof and one final regression pass that covers the redesign plus the later review-created fixes.

# Description

This story reshapes CodeInfo2 into a transcript-first product with more usable workspace space, shared desktop and mobile shells, and a clearer split between day-to-day conversation work and global runtime setup. It moves global status into `Home`, modernizes the workspace shells, transcript surfaces, conversation panes, and composers, and preserves the existing chat, agent, flow, ingest, and logging behaviors people already depend on. The final tasked version of the story also includes the later runtime, flow-safety, state-management, working-folder, and retained-proof fixes that were required by review before the redesign can close safely.

# Tasks

1. [codeInfo2] - Restyle shared transcript rows and isolate copy payloads
- Update the shared transcript components under `client/src/components/chat`.
- Extend transcript proof so copy output and scroll behavior stay honest.

2. [codeInfo2] - Repair the shared client lint baseline and React compiler policy
- Fix the shared client lint and compiler baseline before larger UI work builds on it.
- Keep the repo-wide frontend quality rules stable for later redesign tasks.

3. [codeInfo2] - Build the shared workspace shell and conversation pane chrome
- Create the reusable desktop and mobile workspace shell, rail, and conversation-pane structure.
- Prove shared layout and state retention before page-specific adapters plug in.

4. [codeInfo2] - Adapt Chat to the shared workspace shell and bottom composer
- Move `Chat` into the shared shell and bottom-composer family.
- Preserve resumed-chat identity, provider rules, and working-folder behavior.

5. [codeInfo2] - Adapt Agents to the shared workspace shell while preserving selector resets
- Move `Agents` into the shared shell and composer pattern.
- Keep agent, command, and step reset behavior explicit in proof.

6. [codeInfo2] - Adapt Flows to the shared workspace shell while preserving resume semantics
- Move `Flows` into the shared shell and composer pattern.
- Preserve fresh-run, resume, and custom-title semantics through focused proof.

7. [codeInfo2] - Build the utility status shell and move LM Studio into Home
- Rework `Home` into the shared status page for runtime, auth, and LM Studio controls.
- Preserve the committed-versus-draft LM Studio base URL lifecycle.

8. [codeInfo2] - Apply the utility shell to Ingest and Logs
- Move `Ingest` and `Logs` into the shared utility-page layout.
- Keep the current ingest and log behavior unchanged while updating the shell.

9. [codeInfo2] - Replace top tabs with the shared navigation model and `/lmstudio` compatibility redirect
- Remove the old top-tab navigation and switch to the shared navigation model.
- Redirect `/lmstudio` into `Home` without breaking bookmarks or refresh behavior.

10. [codeInfo2] - Final Story 58 validation and close-out
- Re-run the base redesign validation path once the first shell and route work lands.
- Refresh the closeout summary so wrapper evidence and proof ownership stay clear.

11. [codeInfo2] - Restore host-backed Codex auth seeding for main and e2e stacks
- Repair the compose and startup bootstrap contract for host-backed Codex auth seeding.
- Add targeted server and runtime proof for the supported auth-seeding path.

12. [codeInfo2] - Add a real replay barrier for fresh flow runs
- Patch the fresh flow launch seam so one logical new-run intent cannot submit twice.
- Prove the replay barrier without breaking resume behavior or payload shaping.

13. [codeInfo2] - Re-validate Story 58 after review pass `0000058-20260520T055359Z-8bffd025`
- Re-run broad regression after the Codex auth and replay-barrier fixes land.
- Keep one final proof owner for that review cycle and its inline minor fix.

14. [codeInfo2] - Add fresh-run retry idempotency ownership after review pass `0000058-20260520T175414Z-385d67b3`
- Patch the client and server flow-run seam so one retry intent keeps one launch identity.
- Add focused client, server, Cucumber, and e2e proof for retry ownership.

15. [codeInfo2] - Re-validate Story 58 after review pass `0000058-20260520T175414Z-385d67b3`
- Re-run broad regression after the retry-ownership repair is complete.
- Refresh the review-cycle summary so the open finding and inline fixes close under one owner.

16. [codeInfo2] - Release fresh-run retry ownership on pre-launch persistence failure after review pass `0000058-20260521T010700Z-65288aea`
- Patch the server launch lifecycle so failed pre-launch starts do not leave stale retry ownership behind.
- Keep accepted replay behavior working for real in-flight launches.

17. [codeInfo2] - Restore the host Codex launcher contract after review pass `0000058-20260521T010700Z-65288aea`
- Repair the checked-in env, compose, and README contract for the host Codex-home launcher path.
- Prove the launcher contract through targeted contract tests and compose smoke.

18. [codeInfo2] - Re-validate Story 58 after review pass `0000058-20260521T010700Z-65288aea`
- Re-run the broad current-repository regression pass after the latest review fixes land.
- Refresh the review-cycle summary and final proof ownership for that pass.

19. [codeInfo2] - Re-validate Story 58 after inline minor review fixes
- Re-run final automation for the inline fix that hides fake Home runtime-selection state.
- Keep one broad proof owner for that clean minor-fix review cycle.

20. [codeInfo2] - Re-validate Story 58 after inline minor review fixes
- Re-run final automation for the inline fixes covering transcript debug logging and archive-delete safety.
- Keep the proof-owner notes aligned with the resolved minor findings.

21. [codeInfo2] - Make the desktop app rail match the final workspace navigation design without changing the mobile app menu
- Refine the desktop app rail to match the approved Story 58 workspace design.
- Keep mobile navigation behavior out of scope for this task.

22. [codeInfo2] - Redesign shared conversation rows to match the final desktop and mobile metadata model
- Rework shared conversation rows in `client/src/components/chat/ConversationList.tsx`.
- Preserve filters, archive actions, and conversation selection while changing the row presentation.

23. [codeInfo2] - Make the shared conversation controls and mobile conversations overlay match the final design contract
- Tighten the shared conversation controls and the mobile conversations overlay chrome.
- Keep the overlay behavior and row-level actions consistent with the final contract.

24. [codeInfo2] - Make the mobile app menu match the final full-screen navigation design without changing the desktop rail
- Rebuild the mobile app menu into the full-screen navigation model.
- Leave the desktop rail behavior unchanged while proving the mobile path.

25. [codeInfo2] - Rebuild the shared assistant and user transcript surfaces to match the final desktop and mobile reading design
- Restyle the shared transcript bubbles, footer surfaces, and reading layout.
- Preserve the shared transcript data path while updating the visual contract.

26. [codeInfo2] - Polish the Chat transcript chrome and conversations pane to match the final desktop and mobile contract
- Apply the final Chat-specific transcript, footer, and conversation-pane polish.
- Refresh focused client and browser proof for the accepted Chat contract.

27. [codeInfo2] - Build the shared composer shell and migrate the Chat composer to the final desktop and mobile design
- Create the shared composer shell and move `Chat` onto it.
- Prove the final desktop and mobile composer behavior through shared and Chat-focused proof.

28. [codeInfo2] - Migrate the Agents composer onto the shared composer shell and match the final Agents footer contract
- Move the `Agents` composer onto the shared shell and final footer layout.
- Preserve selector resets, prompts, and current agent-specific footer behavior.

29. [codeInfo2] - Migrate the Flows composer onto the shared composer shell and match the final Flows footer contract
- Move the `Flows` composer onto the shared shell and final footer layout.
- Keep the shared arrow action meaning explicit for fresh runs versus resumes.

30. [codeInfo2] - Unify the mobile top bar and remove bulky mobile shell padding across workspace and utility pages
- Tighten the mobile shell spacing and top-bar behavior across the redesign surfaces.
- Keep the mobile shell family visually consistent across workspace and utility pages.

31. [codeInfo2] - Reverse the shared transcript reading order and open existing conversations at the latest content while preserving Story 49 virtualization
- Switch the shared transcript to chronological top-to-bottom reading order.
- Preserve virtualization, pinned-bottom logic, and scroll-away stability while landing existing conversations at the newest content.

32. [codeInfo2] - Repair server unit summary wrapper environment inheritance for final Story 58 proof
- Fix the server unit summary wrapper environment inheritance before final proof depends on it.
- Keep the final proof path aligned with the repo-supported wrapper contract.

33. [codeInfo2] - Run final automated validation and manual Story 58 proof for the full story 58 redesign
- Re-run the broad automated validation path for the full redesign.
- Refresh the retained manual proof and closeout notes for the main Story 58 rollout.

34. [codeInfo2] - Restore shared working-folder validation and stale-clear ownership after review pass `0000058-20260525T060243Z-e4ce8252`
- Repair the shared working-folder validator and stale-clear ownership in the server working-folder seam.
- Add focused unit and integration proof for repository membership and stale cleanup ordering.

35. [codeInfo2] - Repair flow run request identity and resume provider precedence after review pass `0000058-20260525T060243Z-e4ce8252`
- Repair fresh-run replay ownership and resume provider precedence in the server flow-run seam.
- Add focused integration proof for contradictory replay rejection and parent-versus-child provider precedence.

36. [codeInfo2] - Stabilize accepted-launch UI state and shared conversation loading after review pass `0000058-20260525T060243Z-e4ce8252`
- Repair accepted-launch refresh-failure behavior and stale-abort loading races in the shared client lifecycle.
- Add focused client proof for both workspace launch surfaces and the shared conversations hook.

37. [codeInfo2] - Re-validate Story 58 after review pass `0000058-20260525T060243Z-e4ce8252`
- Re-run the broad server, client, browser, compose, lint, and format proof for the final review-created findings block.
- Refresh the retained proof notes and close the cycle with one final revalidation owner that also rechecks the inline minor fixes and retained proof chain.
