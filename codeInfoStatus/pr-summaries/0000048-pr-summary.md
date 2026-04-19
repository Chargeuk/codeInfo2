# Story 0000048 PR Summary

## Summary

- Replaced owner-first reference lookup with one shared working-repo-first repository-order helper for command and markdown resolution, including nested-hop restart behavior, duplicate-path dedupe, compact lookup metadata persistence, and structured debug markers.
- Persisted working-folder state across chat, agent, flow, and direct-command surfaces, added the idle conversation edit route, restored picker state in the client, locked edits during active runs, and cleared stale saved folders back to the normal empty state.
- Completed the env cutover to `CODEINFO_*` and `VITE_CODEINFO_*` across checked-in runtime readers, compose wiring, Docker build/runtime injection, wrappers, tests, and documentation.
- Replaced OpenAI heuristic token counting with one shared `tiktoken`-backed helper using the real `8192`-token limit and explicit no-fallback failure handling for guardrails, provider counting, and chunk sizing.

## Validation

- `npm run build:summary:server`
- `npm run build:summary:client`
- `npm run test:summary:server:unit`
- `npm run test:summary:server:cucumber`
- `npm run test:summary:client`
- `npm run test:summary:e2e`
- `npm run compose:build:summary`
- `npm run compose:up`
- Manual Playwright-MCP verification at `http://host.docker.internal:5001`
- `npm run compose:down`

## Notable Contracts

- Repository order: working repo -> referencing owner -> local `codeInfo2` -> other ingested repos.
- Persisted runtime lookup metadata stays compact: `selectedRepositoryPath`, `fallbackUsed`, `workingRepositoryAvailable`.
- Working-folder ownership stays on the conversation record; direct commands reuse the owning agent conversation.
- Final marker set verified in logs/browser:
  - `DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER`
  - `DEV_0000040_T11_FLOW_RESOLUTION_ORDER`
  - `DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER`
  - `DEV_0000048_T4_WORKING_FOLDER_STATE_STORED`
  - `DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION`
  - `DEV_0000048_T6_PICKER_SYNC`
  - `DEV_0000048_T7_CODEINFO_ENV_RESOLVED`
  - `DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG`
  - `DEV_0000048_T9_OPENAI_TOKENIZER_COUNT`
