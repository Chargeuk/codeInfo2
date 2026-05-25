# Story 0000058 PR Summary

- Plan: `planning/0000058-users-can-use-the-redesigned-transcript-first-gui.md`
- Repository scope: current repository only
- Manual proof bundle: `codeInfoStatus/manual-proof/0000058/`

## Final Summary

1. Story 58 now ships the transcript-first redesign across `Home`, `Chat`, `Agents`, `Flows`, `Ingest`, and `Logs`, including the shared desktop/mobile shell, bottom-anchored transcript behavior, the `Home`-owned LM Studio and provider-status migration, the `/lmstudio` compatibility redirect, and the review-driven hardening around runtime-selection display, transcript debug logging, archived bulk-delete gating, and the host Codex launcher contract.
2. The story changed to reclaim transcript space, unify the workspace surfaces into one design system, preserve the existing chat/agent/flow control contracts while moving global runtime state into `Home`, and then harden the final branch against review-discovered regressions before closeout.
3. The main complex logic is state ownership across hidden or resumed UI modes: the transcript only auto-follows near the bottom, `Home` keeps LM Studio draft input separate from the committed base URL, `Flows` distinguishes fresh-run and resume payload rules, and the run-ownership or retry seams must reuse or reject state without leaking stale hidden values into new requests. The launcher-contract follow-up also keeps Docker and host Codex-home mapping portable so the supported wrappers, e2e stack, and browser-facing proof all run against the intended runtime contract.
4. The current review cycle is `0000058-rc-20260525T082128Z-2279fe86`, and the current review pass `0000058-20260525T060243Z-e4ce8252` now has review-created Tasks 34 through 37 plus the inline minor findings `finding-4`, `finding-5`, `finding-8`, `finding-10`, `finding-11`, and `finding-13` all tied to the same current-repository-only applicability decision. Reviewers should focus on the server replay/resume seams, the shared client accepted-launch/loading seams, the retained-proof refresh path, and the wrapper-backed broad regression proof that closes the loop; for closeout evidence, the strongest curated manual/browser proof now lives under `codeInfoStatus/manual-proof/0000058/`.

## Review Status

- The latest `Post-Implementation Code Review` on disk closes review pass `0000058-20260521T182529Z-f48ecb4f` cleanly on local `HEAD` against `origin/main`.
- The active review disposition state for review cycle `0000058-rc-20260525T082128Z-2279fe86` records the review-created repair block for pass `0000058-20260525T060243Z-e4ce8252`, the inline minor fixes already covered by this cycle, and Task 37 as the single final revalidation owner on the current repository only.
- The final broad proof still needs to revalidate the server, client, retained-proof, and wrapper-backed surfaces after Tasks 34 through 36 land, but no additional repository is in scope for this cycle.
