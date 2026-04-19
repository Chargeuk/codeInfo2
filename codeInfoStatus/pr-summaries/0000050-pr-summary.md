# Story 0000050 PR Summary

## What Changed

Story 50 extends repository re-ingest beyond the original single-`sourceId` contract by adding shared selector orchestration for `sourceId`, `target: "current"`, and `target: "all"`, then persists those outcomes through richer single-target and batch transcript payloads. It also tightens markdown execution by skipping whitespace-only markdown explicitly, normalizes all checked-in MCP endpoint configuration behind one shared runtime contract, and moves the checked-in server plus Playwright MCP Compose stacks to the final host-network runtime model with image-baked assets instead of source-tree bind mounts.

## Major Story Steps

- Tasks 1 through 4 introduced the new re-ingest request union, the strict normalized single-target result, the shared target orchestration seam, and the persisted single-versus-batch transcript payloads.
- Task 5 added the blank-markdown skip seam so whitespace-only markdown is observable and safe without weakening real missing-file or decode failures.
- Tasks 6 and 7 finalized the checked-in MCP endpoint contract, including the `CODEINFO_CHAT_MCP_PORT`, `CODEINFO_AGENTS_MCP_PORT`, and `CODEINFO_PLAYWRIGHT_MCP_URL` cutover plus runtime proof markers for normalized endpoint loading.
- Tasks 8 through 12 added the vendored shell harness, host-network preflight, image-baked runtime packaging, host-network Compose topology, and the reusable main-stack host-network proof wrapper.
- Task 13 aligned the e2e host-visible browser/MCP split and made the `DEV-0000050:T13:e2e_host_network_config_verified` marker persist in the saved wrapper output.
- Task 14 restored the repo-wide root lint and format gates, including the narrow `.prettierignore` exception for the intentional invalid JSON fixture and the final `SharedTranscript.tsx` hook cleanup.
- Task 15 completed the final host-network validation pass with wrapper-first proof, live endpoint verification, marker review, and Manual Playwright-MCP evidence.
- Task 16 synchronized the shared documentation, marker matrix, structure ledger, and this reviewer-facing PR summary with the final validated Story 50 state.

## Validation Summary

- Root gates now pass again:
  - `npm run lint`
  - `npm run format:check`
  - `git diff --check`
- Story validation wrappers passed on the validated stack:
  - `npm run build:summary:server`
  - `npm run build:summary:client`
  - `npm run test:summary:server:unit`
  - `npm run test:summary:server:cucumber`
  - `npm run test:summary:client`
  - `npm run test:summary:e2e`
  - `npm run compose:build:summary`
  - `npm run test:summary:host-network:main`
- Manual proof artifacts are captured in:
  - `playwright-output-local/0000050-14-chat-ready.png`
  - `playwright-output-local/0000050-14-logs-proof.png`
- Final proof markers include the full `DEV-0000050:T01` through `DEV-0000050:T14` chain, with the final completion marker emitted by `scripts/emit-task14-validation-marker.mjs`.

## Highest-Risk Compatibility Changes

- `CODEINFO_CHAT_MCP_PORT` is now a first-class dedicated chat MCP listener and must not be treated as an alias for the classic `POST /mcp` surface on `CODEINFO_SERVER_PORT`.
- The checked-in main/local server and Playwright MCP Compose services now rely on host networking, so developers need working host-network support and a correct `host.docker.internal` mapping for the wrapper and browser tooling.
- Re-ingest transcript behavior is now one-payload-per-action: single-target runs persist `reingest_step_result`, while `target: "all"` persists one ordered batch payload instead of pretending the batch was a single repository outcome.
