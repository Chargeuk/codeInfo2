# Story 0000058 PR Summary

- Plan: `planning/0000058-users-can-use-the-redesigned-transcript-first-gui.md`
- Repository scope: current repository only
- Manual proof bundle: `codeInfoStatus/manual-proof/0000058/`

## Final Summary

1. Story 58 delivers the redesigned transcript-first GUI with the shared transcript shell, the shared workspace shell, the utility-page shell family, the `Home` LM Studio migration, the `/lmstudio` compatibility redirect, and the visible navigation model that no longer exposes a standalone LM Studio destination.
2. The story is intentionally split into shell-family work, page-adapter work, route/navigation work, and proof-authoring work so that the shared state rules stay honest: transcript copy stays isolated from metadata, scroll-away transcript reading keeps its place, page-local drafts stay local until committed, and intentionally hidden or unsupported values never leak into submission or persistence.
3. Reviewers should use the Story 58 task map in the plan as the primary traceability source, then spot-check the implementation and proof homes recorded there. The most important surfaces are the transcript rows and copy/scroll proof in Task 1, the shared workspace shell in Task 3, the page adapters in Tasks 4 through 6, the Home and LM Studio migration in Task 7, the utility shell in Task 8, and the route/navigation compatibility proof in Task 9.
4. The story has been validated with the repository’s wrapper-first proof path throughout implementation, including client build, client unit, and browser e2e wrappers, plus task-scoped manual proof under the repo-owned scratch-artifact contract. Final close-out still depends on the Task 10 wrapper run, but the proof homes and artifact locations are already fixed and documented here.

## Task / Proof Map

- Task 1: shared transcript row restyle and message-copy isolation. Proof homes: `client/src/test/sharedTranscript.proofContract.test.tsx`, `client/src/test/sharedTranscript.copy.test.tsx`, `client/src/test/sharedTranscript.scrollBehavior.test.tsx`, and the shared transcript implementation files.
- Task 3: shared workspace shell and desktop/mobile app chrome. Proof homes: `client/src/test/workspaceShell.test.tsx` and the workspace shell implementation files.
- Task 4: Chat page adapter into the shared shell. Proof homes: the `chatPage.*` unit tests and `e2e/chat.spec.ts`.
- Task 5: Agents page adapter and selector-reset behavior. Proof homes: the `agentsPage.*` unit tests and `e2e/agents.spec.ts`.
- Task 6: Flows page adapter and resume semantics. Proof homes: the `flowsPage.*` unit tests and `e2e/flows-execution-runs.spec.ts`.
- Task 7: utility shell, `Home`, and LM Studio migration. Proof homes: `client/src/test/lmstudio.test.tsx`, `client/src/test/useLmStudioStatus.test.ts`, `client/src/test/homePage.layout.test.tsx`, `client/src/test/homePage.status.test.tsx`, and `e2e/lmstudio.spec.ts`.
- Task 8: utility shell adoption for `Ingest` and `Logs`. Proof homes: `client/src/test/ingestPage.layout.test.tsx`, `client/src/test/logsPage.layout.test.tsx`, `e2e/ingest.spec.ts`, and `e2e/logs.spec.ts`.
- Task 9: route tree, visible navigation model, `/lmstudio` compatibility redirect, and mobile app-menu accessibility repair. Proof homes: `client/src/test/router.test.tsx`, `client/src/test/navBar.navigation.test.tsx`, and `e2e/lmstudio.spec.ts`.

## Wrapper Evidence

- Client build wrapper: `npm run build:summary:client`
- Client unit wrapper: `npm run test:summary:client`
- Browser e2e wrappers: targeted Story 58 browser runs under `npm run test:summary:e2e -- --file e2e/lmstudio.spec.ts`, `e2e/chat.spec.ts`, `e2e/agents.spec.ts`, `e2e/flows-execution-runs.spec.ts`, `e2e/ingest.spec.ts`, and `e2e/logs.spec.ts`
- Client lint/format wrappers: `npm run lint --workspace client` and `npm run format:check --workspace client`

## Bounded Caveats

- Manual proof should use the checked-in main stack, not `codeinfo:local`.
- Auth-dependent provider proof may be skipped only when restoring login would require human-controlled two-factor authentication.
- Scratch proof belongs under `codeInfoTmp/manual-testing/0000058/10/`, with Playwright staging using `playwright-output/`.
- The supported main-stack ports are `5001` and `5010`; the supported e2e-stack ports are `6001` and `6010`.

## Status Note

- Task 10 is the story-level close-out task and remains responsible for the final wrapper validation and any final reviewer-facing close-out edits before Story 58 can be considered fully complete on disk.
