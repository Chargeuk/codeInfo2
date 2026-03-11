# Project Structure (full tree)

## Story 0000045 final helper and test inventory

Added helper files:

- `server/src/agents/commandItemExecutor.ts`
- `server/src/chat/reingestStepLifecycle.ts`
- `server/src/chat/reingestToolResult.ts`
- `server/src/flows/markdownFileResolver.ts`

Added Story 45 test files:

- `server/src/test/integration/commands.markdown-file.test.ts`
- `server/src/test/integration/commands.reingest.test.ts`
- `server/src/test/unit/markdown-file-resolver.test.ts`
- `server/src/test/unit/reingest-step-lifecycle.test.ts`
- `server/src/test/unit/reingest-tool-result.test.ts`

Permanent fixture directories added by Story 45:

- None. Story 45 documents a repository-level `codeinfo_markdown/` convention for local and ingested repositories, but it does not add a committed fixture directory under the `codeInfo2` repository itself.

## Story 0000045 Task 11 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`
- `server/src/agents/commandItemExecutor.ts`
- `server/src/flows/service.ts`
- `server/src/test/integration/flows.run.command.test.ts`

## Story 0000045 Task 10 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`
- `server/src/flows/service.ts`
- `server/src/mongo/turn.ts`
- `server/src/test/integration/flows.run.errors.test.ts`
- `server/src/test/unit/turn-command-metadata.test.ts`

## Story 0000045 Task 9 structural change ledger

Added files:

- `server/src/test/integration/commands.reingest.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`
- `server/src/agents/commandsRunner.ts`
- `server/src/agents/service.ts`
- `server/src/test/unit/agent-commands-runner.test.ts`

## Story 0000045 Task 8 structural change ledger

Added files:

- `server/src/chat/reingestStepLifecycle.ts`
- `server/src/test/unit/reingest-step-lifecycle.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`

## Story 0000045 Task 7 structural change ledger

Added files:

- `server/src/chat/reingestToolResult.ts`
- `server/src/test/unit/reingest-tool-result.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`

## Story 0000045 Task 6 structural change ledger

Added files:

- `server/src/agents/commandItemExecutor.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`
- `server/src/agents/commandsRunner.ts`
- `server/src/flows/service.ts`
- `server/src/test/integration/flows.run.command.test.ts`

## Story 0000045 Task 4 structural change ledger

Added files:

- `server/src/test/integration/commands.markdown-file.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`
- `server/src/agents/commandsRunner.ts`
- `server/src/agents/service.ts`
- `server/src/flows/markdownFileResolver.ts`
- `server/src/test/unit/agent-commands-runner.test.ts`

## Story 0000045 Task 3 structural change ledger

Added files:

- `server/src/flows/markdownFileResolver.ts`
- `server/src/test/unit/markdown-file-resolver.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`
- `projectStructure.md`
- `server/src/flows/service.ts`

## Story 0000039 Task 1 structural change ledger

Added files:

- `server/src/test/unit/openapi.prompts-route.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `openapi.json`
- `server/src/agents/service.ts`
- `server/src/routes/agentsCommands.ts`
- `server/src/test/unit/agents-commands-router-list.test.ts`

## Story 0000039 Task 2 structural change ledger

Added files:

- `server/src/test/unit/agent-prompts-list.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `server/src/agents/service.ts`

## Story 0000039 Task 3 structural change ledger

Added files:

- `client/src/test/agentsApi.promptsList.test.ts`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/api/agents.ts`
- `design.md`

## Story 0000039 Task 4 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/pages/AgentsPage.tsx`
- `client/src/test/agentsPage.descriptionPopover.test.tsx`
- `design.md`

## Story 0000040 Task 4 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/api/agents.ts`
- `client/src/test/agentsApi.commandsList.test.ts`
- `client/src/test/agentsApi.commandsRun.test.ts`
- `design.md`

## Story 0000040 Task 6 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `server/src/config/chatDefaults.ts`
- `server/src/test/unit/config.chatDefaults.test.ts`

## Story 0000040 Task 7 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `README.md`
- `design.md`
- `projectStructure.md`
- `server/src/codex/capabilityResolver.ts`
- `server/src/routes/chat.ts`
- `server/src/routes/chatModels.ts`
- `server/src/routes/chatProviders.ts`
- `server/src/routes/chatValidators.ts`
- `server/src/test/integration/chat-codex.test.ts`
- `server/src/test/unit/capabilityResolver.test.ts`
- `server/src/test/unit/chat-codex-reasoning-delta.test.ts`
- `server/src/test/unit/chatModels.codex.test.ts`
- `server/src/test/unit/chatProviders.test.ts`
- `server/src/test/unit/chatValidators.test.ts`

## Story 0000040 Task 8 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `projectStructure.md`
- `server/src/mcp2/tools/codebaseQuestion.ts`
- `server/src/test/integration/chat-codex-mcp.test.ts`
- `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
- `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
- `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`

## Story 0000040 Task 9 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `README.md`
- `design.md`
- `projectStructure.md`
- `server/src/config/runtimeConfig.ts`
- `server/src/test/unit/runtimeConfig.test.ts`

## Story 0000040 Task 10 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `README.md`
- `design.md`
- `package-lock.json`
- `projectStructure.md`
- `server/package.json`
- `server/src/config/codexSdkUpgrade.ts`
- `server/src/index.ts`
- `server/src/test/integration/agents-run-ws-stream.test.ts`
- `server/src/test/integration/chat-codex.test.ts`
- `server/src/test/integration/flows.run.basic.test.ts`
- `server/src/test/unit/codexSdkUpgrade.test.ts`

## Story 0000040 Task 11 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `projectStructure.md`
- `server/src/flows/service.ts`
- `server/src/test/integration/flows.run.command.test.ts`

## Story 0000040 Task 12 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

## Story 0000041 Task 3 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md`
- `projectStructure.md`
- `server/Dockerfile`
- `server/entrypoint.sh`
- `server/npm-global.txt`

## Story 0000041 Task 5 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md`
- `projectStructure.md`
- `server/entrypoint.sh`

## Story 0000041 Task 6 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md`
- `projectStructure.md`
- `server/entrypoint.sh`

## Story 0000041 Task 7 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `design.md`
- `planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md`
- `projectStructure.md`
- `start-gcf-server.sh`

## Story 0000041 Task 8 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `README.md`
- `design.md`
- `planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md`
- `projectStructure.md`
- `server/entrypoint.sh`

- None.

Modified files (implementation traceability):

- `README.md`
- `design.md`
- `openapi.json`
- `planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md`
- `projectStructure.md`

## Story 0000040 Task 13 structural change ledger

Added files:

- `playwright-output-local/task13-agents-start-step-options.png`
- `playwright-output-local/task13-agents-start-step-reset-on-command-change.png`
- `playwright-output-local/task13-chat-codex-flags-expanded.png`
- `playwright-output-local/task13-flows-smoke-failure-working-folder.png`
- `playwright-output-local/task13-flows-smoke-success.png`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `planning/0000040-command-step-start-chat-config-defaults-and-flow-command-resolution.md`
- `projectStructure.md`

## Story 0000038 Tasks 1-7 structural change ledger

Added files:

- `docs/developer-reference.md`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/components/ingest/RootsTable.tsx`
- `client/src/hooks/useChatWs.ts`
- `client/src/hooks/useIngestRoots.ts`
- `client/src/pages/AgentsPage.tsx`
- `client/src/test/agentsPage.commandsRun.abort.test.tsx`
- `client/src/test/agentsPage.conversationSelection.test.tsx`
- `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`
- `client/src/test/agentsPage.sidebarActions.test.tsx`
- `client/src/test/chatPage.stop.test.tsx`
- `client/src/test/flowsPage.stop.test.tsx`
- `client/src/test/ingestRoots.test.tsx`
- `client/src/test/ingestStatus.test.tsx`
- `client/src/test/useChatWs.test.ts`
- `client/src/test/useIngestRoots.test.tsx`
- `common/src/lmstudio.ts`
- `design.md`
- `openapi.json`
- `server/src/agents/commandsRunner.ts`
- `server/src/ingest/ingestJob.ts`
- `server/src/ingest/reingestService.ts`
- `server/src/lmstudio/toolService.ts`
- `server/src/mcp/server.ts`
- `server/src/mcp2/tools/reingestRepository.ts`
- `server/src/routes/ingestRoots.ts`
- `server/src/test/features/ingest-delta-reembed.feature`
- `server/src/test/features/ingest-logging.feature`
- `server/src/test/integration/agents-run-client-conversation-id.test.ts`
- `server/src/test/integration/mcp-ingested-repositories.test.ts`
- `server/src/test/steps/ingest-delta-reembed.steps.ts`
- `server/src/test/steps/ingest-manage.steps.ts`
- `server/src/test/unit/agent-commands-runner-abort-retry.test.ts`
- `server/src/test/unit/ingest-ast-indexing.test.ts`
- `server/src/test/unit/ingest-roots-dedupe.test.ts`
- `server/src/test/unit/mcp-ingested-repositories.test.ts`
- `server/src/test/unit/mcp.keepalive.helper.test.ts`
- `server/src/test/unit/mcp.reingest.classic.test.ts`
- `server/src/test/unit/mcp2.reingest.tool.test.ts`
- `server/src/test/unit/openapi.contract.test.ts`
- `server/src/test/unit/reingestService.test.ts`
- `server/src/test/unit/tools-ingested-repos.test.ts`
- `server/src/test/unit/ws-chat-stream.test.ts`
- `server/src/test/unit/ws-server.test.ts`
- `server/src/ws/server.ts`
- `server/src/ws/types.ts`

Tree covers all tracked files (excluding `.git`, `node_modules`, `dist`). Keep this in sync whenever files are added/removed/renamed; each line has a brief comment.

```
.
â”œâ”€ .DS_Store â€” macOS metadata (safe to delete)
â”œâ”€ .editorconfig â€” shared editor defaults
â”œâ”€ .gitattributes â€” git attributes (line endings, linguist)
â”œâ”€ .gitignore â€” ignore rules (node_modules, dist, env.local, etc.)
â”œâ”€ .dockerignore â€” root docker build ignores (keeps Codex auth out of build contexts)
â”œâ”€ .npmrc â€” npm config (save-exact)
â”œâ”€ .prettierignore â€” files skipped by Prettier
â”œâ”€ .prettierrc â€” Prettier settings
â”œâ”€ AGENTS.md â€” agent workflow rules
â”œâ”€ README.md â€” repo overview and commands, including corporate registry/certificate override setup guidance and workflow-specific env-source rules
â”œâ”€ start-gcf-server.sh â€” macOS/Linux helper to install/run git-credential-forwarder with optional `CODEINFO_NPM_REGISTRY` override for the global install step
â”œâ”€ logs/ â€” runtime server log output (gitignored, host-mounted)
â”œâ”€ design.md â€” design notes and diagrams, including end-to-end corporate override flow (env source -> compose interpolation -> build overrides -> runtime gate -> startup/fail-fast)
â”œâ”€ flows/ â€” flow JSON definitions (hot-reloaded, user-managed; resolved as sibling to codex_agents by default)
â”œâ”€ flows-sandbox/ â€” safe flow JSON definitions for manual MCP/Playwright testing
â”œâ”€ observability/ â€” shared OpenTelemetry collector config for Chroma traces
â”‚  â””â”€ otel-collector-config.yaml â€” OTLP->Zipkin/logging pipeline used by all compose stacks
â”œâ”€ docker-compose.yml â€” compose stack for client/server
â”œâ”€ docker-compose.e2e.yml — isolated e2e stack (client 6001, server 6010, chroma 8800, fixtures mount)
â”œâ”€ eslint.config.js â€” root ESLint flat config
â”œâ”€ package-lock.json â€” workspace lockfile
â”œâ”€ package.json â€” root package/workspaces/scripts, including compact summary wrappers such as `build:summary:client` (client typecheck + build), `test:summary:client`, and `typecheck:summary:client`; summary wrappers now emit heartbeat/final-action guidance (`agent_action`, `do_not_read_log`, `log`) so healthy runs can avoid unnecessary log reads while warned/failed/ambiguous runs still point maintainers to the saved log
â”œâ”€ tsconfig.base.json â€” shared TS config
â”œâ”€ tsconfig.json â€” project references entry
â”œâ”€ client/ â€” React 19 Vite app
â”‚  â”œâ”€ .dockerignore â€” client docker build ignores
â”‚  â”œâ”€ .env â€” client default env (VITE_API_URL, VITE_LMSTUDIO_URL)
â”‚  â”œâ”€ .env.local â€” client local overrides (ignored by git consumers)
â”‚  â”œâ”€ .gitignore â€” client-specific ignores
â”‚  â”œâ”€ Dockerfile â€” client image build with optional corporate npm registry override during `npm ci` and build-state metadata handoff (`CODEINFO_CLIENT_BUILD_OVERRIDE_STATE`)
â”‚  â”œâ”€ entrypoint.sh â€” client runtime config writer + preview runner
â”‚  â”œâ”€ README.md â€” client-specific notes
â”‚  â”œâ”€ eslint.config.js â€” client ESLint entry
â”‚  â”œâ”€ index.html â€” Vite HTML shell
â”‚  â”œâ”€ jest.config.ts â€” Jest config
â”‚  â”œâ”€ package.json â€” client workspace manifest
â”‚  â”œâ”€ tsconfig.app.json â€” TS config for app build
â”‚  â”œâ”€ tsconfig.json â€” client-local browser typecheck config overriding the shared `NodeNext` base with Vite-friendly bundler resolution plus explicit `vite/client`/`jest`/`node` ambient types; used by the non-emitting `npm run typecheck --workspace client` command and the `typecheck:summary:client` wrapper that `build:summary:client` now runs before the Vite build
â”‚  â”œâ”€ tsconfig.node.json â€” TS config for tools
â”‚  â”œâ”€ vite.config.ts â€” Vite config
â”‚  â”œâ”€ public/
â”‚  â”‚  â”œâ”€ config.js â€” runtime client config (API base/port)
â”‚  â”‚  â””â”€ vite.svg â€” Vite logo asset
â”‚  â””â”€ src/
â”‚     â”œâ”€ App.tsx â€” app shell with CssBaseline/NavBar/Container
â”‚     â”œâ”€ assets/react.svg â€” React logo asset
â”‚     â”œâ”€ components/
â”‚     â”‚  â”œâ”€ codex/
â”‚     â”‚  â”‚  â””â”€ CodexDeviceAuthDialog.tsx â€” device-auth dialog with target select, API call, and copy helpers
â”‚     â”‚  â”œâ”€ NavBar.tsx â€” top navigation AppBar/Tabs
|     |  |  |- chat/
|     |  |  |  â”œâ”€ CodexFlagsPanel.tsx â€” Codex-only flags accordion with sandbox select
|     |  |  |  â””â”€ ConversationList.tsx â€” conversation sidebar with infinite scroll + archive/restore
|     |  |- Markdown.tsx ? sanitized GFM renderer shared by chat+agents assistant/user bubbles (and expanded think text) with code block + mermaid handling
â”‚     â”‚  â””â”€ ingest/
â”‚     â”‚     â”œâ”€ ActiveRunCard.tsx — shows active ingest status, counts, cancel + logs link
â”‚     â”‚     â””â”€ IngestForm.tsx — ingest form with validation, lock banner, submit handler
â”‚     â”‚     â”œâ”€ DirectoryPickerDialog.tsx — server-backed directory picker modal for Folder path
â”‚     â”‚     â”œâ”€ ingestDirsApi.ts — typed fetch helper for GET /ingest/dirs
â”‚     â”‚     â”œâ”€ RootsTable.tsx — embedded roots table with bulk/row actions and lock chip
â”‚     â”‚     â””â”€ RootDetailsDrawer.tsx — drawer showing root metadata, counts, include/exclude lists
â”‚     â”œâ”€ logging/
â”‚     â”‚  â”œâ”€ index.ts â€” logging exports
|     |  |- logger.ts ? client logger factory (console tee + queue)
|     |  - transport.ts ? forwarding queue placeholder
â”‚     â”œâ”€ constants/
|     |  â””â”€ systemContext.ts — holds optional system prompt prepended to chat payloads when non-empty
|     |- hooks/
|     |  |- useChatModel.ts ? fetches /chat/models, tracks selected model state
|     |  |- useChatWs.ts — WebSocket client hook (connect/reconnect, subscribe/unsubscribe, per-inflight seq gating, JSON codec, client log forwarding)
|     |  |- useChatStream.ts — chat run hook (POST /chat start-run 202 + merges WS transcript events into ChatMessage state, preserving raw non-whitespace outbound input, blocking whitespace-only sends, ignoring stale older-inflight non-final events, and preserving late older `turn_final` updates non-destructively)
|     |  |- useLmStudioStatus.ts ? LM Studio status/models data hook
|     |  |- useConversations.ts ? conversation list infinite scroll + archive/restore helpers
|     |  |- useConversationTurns.ts ? lazy turn loading with load-older cursor handling
|     |  |- usePersistenceStatus.ts ? fetches /health for mongoConnected banner flag
|     |  |- useIngestStatus.ts ? polls /ingest/status/:runId and supports cancelling
|     |  |- useIngestRoots.ts ? fetches /ingest/roots with canonical-first lock/error normalization, alias fallback, and refetch helper
|     |  |- useIngestModels.ts ? fetches /ingest/models with canonical-first lock normalization, provider envelope parsing, and default selection
|     |  - useLogs.ts ? log history + SSE hook with filters
|     |- utils/
|     |  - isDevEnv.ts ? shared dev/test environment detection helper
|     |- api/
|     |  - agents.ts ? client wrapper for agent discovery + command/instruction runs, including strict command `stepCount` parsing and optional `startStep` payload wiring
|     |  - baseUrl.ts ? runtime API base resolver (config/env/location)
|     |  - codex.ts ? client wrapper for POST /codex/device-auth with structured errors + logging
|     |  - flows.ts ? client wrapper for GET /flows and POST /flows/:flowName/run with structured errors + logging
|     |- index.css ? minimal global styles (font smoothing, margin reset)
|     |- main.tsx ? app entry with RouterProvider
|     |- pages/
|     |  |- ChatPage.tsx ? chat shell with model select, streaming transcript, rounded 14px bubbles, tool blocks, citations accordion (closed by default), stream status/thinking UI (1s idle guard, ignores tool-only waits), and raw-input send guards/logging
|     |  |- AgentsPage.tsx ? agents UI with selector/stop/new-conversation controls, command `Start step` selector (`Step 1..N`), persisted conversation continuation, raw-instruction send guards, and shared user-markdown rendering/logging
|     |  |- FlowsPage.tsx ? flows UI with selector/run/resume/stop controls, flow-filtered sidebar, step metadata transcript, and `flows.page.live_transcript_retained` logging only after post-event UI proof shows the earlier bubble stayed visible through the next-step transition
|     |  |- IngestPage.tsx ? ingest UI shell (lock banner, form, run/status placeholders)
|     |  |- HomePage.tsx ? version card page
|     |  |- LmStudioPage.tsx ? LM Studio config/status/models UI
|     |  - LogsPage.tsx ? log viewer with filters, live toggle, sample emitter
|     |  |- router.tsx ? React Router setup
|     |  - test/
|     |     |- logging/
|     |     |  |- logger.test.ts ? logger creation/global hooks coverage
|     |     |  - transport.test.ts ? client log transport queue/backoff tests
|     |     |- chatPage.models.test.tsx ? chat page models list states
|     |     |- chatPage.newConversation.test.tsx ? chat page new conversation reset behaviour
|     |     |- chatPage.stream.test.tsx ? chat streaming hook + UI coverage (status chip/thinking gating incl. pre-token + mid-turn idle waits, raw payload preservation, whitespace-only blocking, whitespace-distinct turns)
|     |     |- chatPage.citations.test.tsx ? chat citations accordion default-closed with host paths shown when expanded
|     |     |- chatPage.noPaths.test.tsx ? chat citations render when host path missing
|     |     |- chatPage.stop.test.tsx ? chat stop control aborts streams and shows status bubble
|     |     |- chatPage.toolDetails.test.tsx ? tool detail UI (parameters, repos, vector files, errors)
|     |     |- chatPage.reasoning.test.tsx ? Harmony/think reasoning collapse spinner + toggle
|     |     |- chatPage.flags.sandbox.default.test.tsx ? Codex flags panel renders with default sandbox and helper
|     |     |- chatPage.flags.sandbox.payload.test.tsx ? sandbox flag sent only for Codex payloads
|     |     |- chatPage.flags.sandbox.reset.test.tsx ? sandbox flag resets on provider change or new conversation
|     |     |- chatPage.flags.network.default.test.tsx ? Codex network access toggle defaults to enabled with helper copy
|     |     |- chatPage.flags.network.payload.test.tsx ? network flag omitted for LM Studio, forwarded/reset for Codex payloads
|     |     |- chatPage.flags.websearch.default.test.tsx ? Codex web search toggle defaults to enabled with helper copy
|     |     |- chatPage.flags.websearch.payload.test.tsx ? web search flag omitted for LM Studio, forwarded/reset for Codex payloads
|     |     |- chatPage.flags.approval.default.test.tsx ? Codex approval policy select default and helper
|     |     |- chatPage.flags.approval.payload.test.tsx ? approval policy omitted for LM Studio and forwarded/reset for Codex
|     |     |- chatPage.flags.reasoning.default.test.tsx ? Codex reasoning effort select default and helper
|     |     |- chatPage.flags.reasoning.payload.test.tsx ? reasoning effort omitted for LM Studio and forwarded/reset for Codex
|     |     |- chatPage.codexDefaults.test.tsx ? Codex defaults sourced from server, reset on provider/new conversation, panel disabled without defaults
|     |     |- chatPage.provider.test.tsx ? provider dropdown, Codex disabled guidance, provider lock after first send
|     |     |- chatPage.markdown.test.tsx ? assistant/user markdown parity for lists/code plus sanitization coverage
|     |     |- chatPage.mermaid.test.tsx ? assistant/user mermaid parity and malformed-fallback coverage
|     |     |- codexDeviceAuthApi.test.ts ? codex device-auth API helper parsing + errors
|     |     |- codexDeviceAuthDialog.test.tsx ? codex device-auth dialog states + copy actions
|     |     |- agentsPage.list.test.tsx ? Agents page loads agent list and populates dropdown
|     |     |- agentsPage.descriptionPopover.test.tsx ? Agents page renders selected agent description markdown
|     |     |- agentsPage.agentChange.test.tsx ? switching agent aborts run and resets conversation state
|     |     |- agentsPage.conversationSelection.test.tsx ? selecting a conversation continues via conversationId
|     |     |- agentsPage.turnHydration.test.tsx ? selecting a conversation hydrates whitespace-distinct turns and asserts user/assistant markdown+safety parity
|     |     |- agentsPage.run.test.tsx ? agent run (realtime) renders transcript from WS and verifies raw payload + whitespace guard + user/assistant markdown parity
|     |     |- agentsPage.run.instructionError.test.tsx ? Agents page shows error banner when instruction start fails
|     |     |- agentsPage.workingFolderPicker.test.tsx ? Agents working-folder picker dialog open/pick/cancel/error coverage
|     |     |- flowsPage.test.tsx ? Flows page renders flow list and step metadata
|     |     |- flowsPage.run.test.tsx ? Flows page run/resume controls plus two-step live transcript retention coverage while stale earlier-step replays are ignored
|     |     |- flowsPage.stop.test.tsx ? Flows page stop button sends cancel_inflight
|     |     |- agentsPage.run.commandError.test.tsx ? Agents page shows command start errors, including unchanged `INVALID_START_STEP` range text
|     |     |- agentsPage.navigateAway.keepsRun.test.tsx ? navigating away does not cancel run; transcript resumes via WS
|     |     |- agentsPage.persistenceFallbackSegments.test.tsx ? Agents page shows realtime banner + disables Send when WS is unavailable
|     |     |- agentsPage.commandsList.test.tsx ? Agents page command dropdown + `Start step` ordering/state rules, disabled entries, labels, and execute gating
|     |     |- agentsPage.commandsRun.refreshTurns.test.tsx ? Agents page command execute triggers run, then refreshes conversations and hydrates turns
|     |     |- agentsPage.commandsRun.conflict.test.tsx ? Agents page surfaces RUN_IN_PROGRESS conflicts for command execute and normal send
|     |     |- agentsPage.commandsRun.persistenceDisabled.test.tsx ? Agents page persistence guard plus command-run payload coverage for selected `startStep`
|     |     |- agentsPage.commandMetadataRender.test.tsx ? Agents page renders per-turn command metadata note with step progress
|     |     |- agentsPage.commandsRun.abort.test.tsx ? Agents page Stop sends WS cancel_inflight (does not abort HTTP start)
|     |     |- ingestForm.test.tsx ? ingest form validation, lock banner, submit payloads
|     |     |- ingestPage.layout.test.tsx ? ingest page stays full width (no maxWidth lg container)
|     |     |- ingestStatus.test.tsx ? ingest status polling/cancel card tests
|     |     |- ingestStatus.progress.test.tsx ? ingest status progress row updates with MSW stubs
|     |     |- ingestRoots.test.tsx ? roots table + details drawer + actions coverage
|     |     |- logsPage.test.tsx ? Logs page renders data, live toggle behaviour
|     |     |- lmstudio.test.tsx ? LM Studio page tests
|     |     |- router.test.tsx ? nav/router tests
|     |     |- setupTests.ts ? Jest/test setup with typed fetch/browser polyfills and shared test globals
|     |     |- support/
|     |     |  |- fetchMock.ts ? typed `fetch` mock accessor shared by client tests and harness helpers
|     |     |  |- mockChatWs.ts ? shared WS + fetch harness helpers with typed transcript/sidebar event emitters
|     |     |  |- testEnvironment.d.ts ? ambient Jest/browser/test global declarations (`__wsMock`, `__CODEINFO_TEST__`, `window.__chatTest`)
|     |     |  - userEvent.ts ? shared `userEvent.setup()` helper/type used by support utilities and later test cleanup
|     |     |- useChatStream.reasoning.test.tsx ? chat hook reasoning parser coverage
|     |     |- useChatStream.toolPayloads.test.tsx ? chat hook WS tool payload handling plus raw outbound payload preservation assertions
|     |     |- useLmStudioStatus.test.ts ? hook tests
|     |     |- useLogs.test.ts ? log fetch + SSE hook tests
|     |     - version.test.tsx ? version card test
â”œâ”€ common/ â€” shared TypeScript package
â”‚  â”œâ”€ package.json â€” common workspace manifest
â”‚  â”œâ”€ tsconfig.json â€” TS config for common
â”‚  â”œâ”€ tsconfig.tsbuildinfo â€” TS build info cache
â”‚  â””â”€ src/
â”‚     â”œâ”€ fixtures/ â€” shared LM Studio model fixtures
â”‚     â”‚  â””â”€ mockModels.ts â€” shared fixture for LM Studio models list
â”‚     â”‚  â””â”€ chatStream.ts — canonical chat request fixtures + legacy SSE + WS event fixtures
â”‚     â”œâ”€ api.ts â€” fetch helpers (server version, LM Studio)
â”‚     â”œâ”€ index.ts â€” barrel exports
â”‚     â”œâ”€ lmstudio.ts â€” LM Studio DTOs/types
â”‚     â”œâ”€ logging.ts â€” LogEntry/LogLevel DTO + isLogEntry guard
â”‚     â”œâ”€ systemContext.ts — shared SYSTEM_CONTEXT prompt exported to client/server
â”‚     â””â”€ versionInfo.ts â€” VersionInfo DTO
â”œâ”€ e2e/ â€” Playwright specs
â”‚  â”œâ”€ fixtures/
â”‚  â”‚  â”œâ”€ repo/README.md — ingest e2e sample repo description
â”‚  â”‚  â””â”€ repo/main.txt — ingest e2e sample source file with deterministic Q&A text
â”‚  â”œâ”€ chat.spec.ts - chat page end-to-end (model select + two-turn stream + raw payload/whitespace guard checks; skips if models unavailable)
â”‚  â”œâ”€ chat-tools.spec.ts — chat citations e2e: ingest fixture, vector search, mock `POST /chat` (202) + chat WS, assert repo/host path citations
â”‚  â”œâ”€ chat-tools-visibility.spec.ts — chat tool detail UX e2e (closed state, params, repo expansion, vector aggregation, errors, thinking spinner idle/tool-wait behaviour)
â”‚  â”œâ”€ chat-reasoning.spec.ts — Harmony/think reasoning collapse e2e (mock WS)
â”‚  â”œâ”€ chat-mermaid.spec.ts — renders mermaid diagram from chat reply and captures screenshot
â”‚  â”œâ”€ lmstudio.spec.ts â€” LM Studio UI/proxy e2e
â”‚  â”œâ”€ logs.spec.ts â€” Logs UI end-to-end sample emission
â”‚  â””â”€ version.spec.ts â€” version display e2e
â”‚  â””â”€ ingest.spec.ts — ingest flows (happy path, cancel, re-embed, remove) with skip when models unavailable
â”œâ”€ planning/ â€” story plans and template
â”‚  â”œâ”€ 0000001-initial-skeleton-setup.md â€” plan for story 0000001
â”‚  â”œâ”€ 0000002-lmstudio-config.md â€” plan for story 0000002
â”‚  â”œâ”€ 0000003-logging-and-log-viewer.md â€” plan for story 0000003
â”‚  â”œâ”€ 0000004-lmstudio-chat.md â€” plan for story 0000004
â”‚  â”œâ”€ 0000005-ingest-embeddings.md â€” plan for story 0000005
â”‚  â”œâ”€ 0000006-lmstudio-chroma-tools.md â€” plan for story 0000006
â”‚  â”œâ”€ 0000007-ingest-visibility.md â€” plan for story 0000007
â”‚  â”œâ”€ 0000008-tool-visibility.md â€” plan for story 0000008
â”‚  â”œâ”€ 0000009-frontend-log-source.md â€” plan for story 0000009
â”‚  â”œâ”€ 0000010-codex-cli-integration.md â€” plan for story 0000010
â”‚  â”œâ”€ 0000011-codex-flags.md â€” plan for story 0000011
â”‚  â”œâ”€ 0000012-mcp-chat-interface.md â€” plan for story 0000012
â”‚  â”œâ”€ 0000013-conversation-persistence.md â€” plan for story 0000013
â”‚  â”œâ”€ 0000014-chat-interface-refactor.md â€” plan for story 0000014
â”‚  â”œâ”€ 0000015-mcp-common-refactor.md â€” plan for story 0000015
â”‚  â”œâ”€ 0000016-llm-agents.md â€” plan for story 0000016
â”‚  â”œâ”€ 0000017-agent-working-folder-and-codex-updates.md â€” plan for story 0000017
â”‚  â”œâ”€ 0000018-agent-commands.md â€” plan for story 0000018
â”‚  â”œâ”€ 0000019-chat-page-ux.md â€” plan for story 0000019 (current)
â”‚  â”œâ”€ 0000019-screenshots/ â€” screenshots captured for story 0000019
â”‚  â”œâ”€ 0000020-ingest-delta-reembed-and-ingest-page-ux.md â€” plan for story 0000020
â”‚  â”œâ”€ 0000020-screenshots/ â€” screenshots captured for story 0000020
â”‚  â”œâ”€ 0000021-agents-chat-unification.md â€” plan for story 0000021
â”‚  â”œâ”€ 0000022-ingest-ws-streaming-and-layout.md â€” plan for story 0000022
â”‚  â”œâ”€ 0000023-conversation-sidebar-fixes.md â€” plan for story 0000023
â”‚  â”œâ”€ 0000024-chat-bubble-metadata-and-agent-steps.md â€” plan for story 0000024
â”‚  â”œâ”€ 0000025-summary-first-retrieval.md â€” plan for story 0000025
â”‚  â”œâ”€ 0000026-codex-models-and-flag-defaults-via-env.md â€” plan for story 0000026
â”‚  â”œâ”€ 0000027-flows-mode.md â€” plan for story 0000027
â”‚  â”œâ”€ 0000028-agents-chat-gui-consistency-data/ â€” UI screenshots for story 0000028
â”‚  â”‚  â”œâ”€ 0000028-1-agents-height.png â€” Agents transcript height check
â”‚  â”‚  â”œâ”€ 0000028-1-chat-height.png â€” Chat transcript height check
â”‚  â”‚  â”œâ”€ 0000028-2-agents-popover.png â€” Agents info popover
â”‚  â”‚  â”œâ”€ 0000028-3-agents-controls.png â€” Agents controls row layout
â”‚  â”‚  â”œâ”€ 0000028-3-agents-controls-mobile.png â€” Agents controls stacked layout
â”‚  â”‚  â”œâ”€ 0000028-4-agents-send-stop-width.png â€” Agents Send/Stop fixed width
â”‚  â”‚  â”œâ”€ 0000028-5-agents-folder-picker.png â€” Agents working-folder picker dialog
â”‚  â”‚  â”œâ”€ 0000028-6-agents-sizing.png â€” Agents sizing + variant baseline
â”‚  â”‚  â”œâ”€ 0000028-6-chat-sizing.png â€” Chat sizing + variant baseline
â”‚  â”‚  â”œâ”€ 0000028-7-ingest-sizing.png â€” Ingest sizing + variant baseline
â”‚  â”‚  â””â”€ 0000028-7-lmstudio-sizing.png â€” LM Studio sizing + variant baseline
â”‚  â”œâ”€ 0000028-agents-chat-gui-consistency.md â€” plan for story 0000028
â”‚  â”œâ”€ 0000029-flow-agent-transcripts-and-inflight-hydration-data/ â€” UI screenshots for story 0000029
â”‚  â”‚  â”œâ”€ 0000029-1-agent-transcripts.png â€” Agents flow transcript evidence
â”‚  â”‚  â”œâ”€ 0000029-1-flow-transcript.png â€” Flow transcript evidence
â”‚  â”‚  â””â”€ 0000029-2-inflight-hydration.png â€” Inflight snapshot overlay evidence
â”‚  â”œâ”€ 0000029-flow-agent-transcripts-and-inflight-hydration.md â€” plan for story 0000029
â”‚  â”œâ”€ 0000031-codex-device-auth-relogin.md â€” plan for story 0000031
â”‚  â””â”€ plan_format.md â€” planning template/instructions
â”œâ”€ test-results/ â€” test artifacts (screenshots, reports)
â”‚  â””â”€ screenshots/ â€” manual verification screenshots
â”‚     â”œâ”€ 0000028-8-agents-final.png â€” Agents layout final check
â”‚     â”œâ”€ 0000028-8-agents-folder-picker.png â€” Agents folder picker dialog
â”‚     â”œâ”€ 0000028-8-agents-popover.png â€” Agents info popover
â”‚     â”œâ”€ 0000028-8-chat-final.png â€” Chat layout final check
â”‚     â”œâ”€ 0000028-8-ingest-final.png â€” Ingest layout final check
â”‚     â”œâ”€ 0000028-8-lmstudio-final.png â€” LM Studio layout final check
â”‚     â”œâ”€ 0000029-3-agent-transcript.png â€” Agents flow transcript verification
â”‚     â”œâ”€ 0000029-3-chat-inflight.png â€” Chat inflight overlay verification
â”‚     â”œâ”€ 0000029-3-flows-transcript.png â€” Flows transcript verification
â”‚     â”œâ”€ 0000033-5-chat.png â€” Chat page acceptance check for story 0000033
â”‚     â”œâ”€ 0000033-5-ingest.png â€” Ingest page acceptance check for story 0000033
â”‚     â””â”€ 0000033-5-logs.png â€” Logs page acceptance check for story 0000033
â”œâ”€ playwright-output-local/ â€” local Playwright MCP screenshot artifacts captured during story/task manual verification
â”‚  â”œâ”€ 0000035-13-chat-raw-input-parity.png â€” Task 13 chat raw-input parity verification capture
â”‚  â”œâ”€ 0000035-13-chat-user-markdown-parity.png â€” Task 13 chat user markdown parity verification capture
â”‚  â”œâ”€ 0000035-13-agents-raw-input-parity.png â€” Task 13 agents raw-input parity verification capture
â”‚  â”œâ”€ 0000035-13-agents-user-markdown-parity.png â€” Task 13 agents user markdown parity verification capture
â”‚  â”œâ”€ 0000035-13-general-regression.png â€” Task 13 overall UI regression verification capture
â”‚  â”œâ”€ 0000035-15-chat-raw-input-parity.png â€” Task 15 chat raw-input parity revalidation capture
â”‚  â”œâ”€ 0000035-15-chat-user-markdown-parity.png â€” Task 15 chat user markdown parity revalidation capture
â”‚  â”œâ”€ 0000035-15-agents-raw-input-parity.png â€” Task 15 agents raw-input parity revalidation capture
â”‚  â”œâ”€ 0000035-15-agents-user-markdown-parity.png â€” Task 15 agents user markdown parity revalidation capture
â”‚  â”œâ”€ task10-chat-stop-stopped.png â€” Story 0000043 Task 10 Chat stop UX verification capture showing the final visible `Stopped` state
â”‚  â”œâ”€ task11-agents-command-stop-bubble.png â€” Story 0000043 Task 11 Agents command stop verification capture showing the visible `Stopped` state
â”‚  â”œâ”€ task11-agents-instruction-stop-bubble.png â€” Story 0000043 Task 11 Agents instruction stop verification capture showing the visible `Stopped` state
â”‚  â”œâ”€ task12-flows-stop-stopped.png â€” Story 0000043 Task 12 Flows stop verification capture showing the visible `Stopped` state
â”‚  â”œâ”€ 0000043-14-chat-stopped.png â€” Story 0000043 Task 14 final Chat stopped-state acceptance capture
â”‚  â”œâ”€ 0000043-14-chat-noop-recovered.png â€” Story 0000043 Task 14 final Chat no-op recovery acceptance capture
â”‚  â”œâ”€ 0000043-14-agents-instruction-stopped.png â€” Story 0000043 Task 14 final Agents instruction stopped-state acceptance capture
â”‚  â”œâ”€ 0000043-14-agents-command-stopped.png â€” Story 0000043 Task 14 final Agents command stopped-state acceptance capture
â”‚  â”œâ”€ 0000043-14-flows-stopped.png â€” Story 0000043 Task 14 final Flows stopped-state acceptance capture
â”‚  â”œâ”€ 0000043-14-chat-multiwindow-a.png â€” Story 0000043 Task 14 multi-window source-tab acceptance capture after the first stop
â”‚  â”œâ”€ 0000043-14-chat-multiwindow-b.png â€” Story 0000043 Task 14 multi-window replacement-run acceptance capture showing the later run still active
â”‚  â””â”€ 0000035-15-general-regression.png â€” Task 15 overall regression revalidation capture
â”œâ”€ test-results/
â”‚  â”œâ”€ pr-comments/
â”‚  â”‚  â”œâ”€ 0000042-summary.md â€” Story 0000042 PR summary artifact
â”‚  â”‚  â””â”€ 0000043-summary.md â€” Story 0000043 PR summary artifact covering the stop contract, runtime changes, client UX alignment, and verification evidence
â”œâ”€ server/ â€” Express API
â”‚  â”œâ”€ .dockerignore â€” server docker build ignores
â”‚  â”œâ”€ .env â€” server default env (PORT, LMSTUDIO_BASE_URL)
â”‚  â”œâ”€ .env.local â€” server local overrides (ignored by git consumers)
â”‚  â”œâ”€ .prettierignore â€” server-specific Prettier ignore
â”‚  â”œâ”€ Dockerfile â€” server image build with stage-local corporate override args and conditional npm/pip install wiring (defaults preserved when unset)
â”‚  â”œâ”€ entrypoint.sh â€” server startup script (launches headless Chrome + API), resolves `NODE_EXTRA_CA_CERTS` default/override export, enforces refresh-gated cert discovery from `/usr/local/share/ca-certificates/codeinfo-corp` (including fail-fast missing/no-crt/unreadable/update failures), and emits CODEINFO wiring/build/runtime observability tokens
â”‚  â”œâ”€ npm-global.txt â€” source list consumed by `xargs -r npm install -g --force < /tmp/npm-global.txt` during runtime image global tool install
â”‚  â”œâ”€ requirements.txt â€” Python package list for the server image
â”‚  â”œâ”€ cucumber.js â€” Cucumber config
â”‚  â”œâ”€ package.json â€” server workspace manifest
â”‚  â”œâ”€ tsconfig.json â€” TS config for server
â”‚  â”œâ”€ tsconfig.tsbuildinfo â€” TS build info cache
â”‚  â””â”€ src/
â”‚     â”œâ”€ index.ts â€” Express app entry
â”‚     â”œâ”€ logger.ts â€” pino/pino-http setup with rotation and env config helper
â”‚     â”œâ”€ logStore.ts â€” in-memory log buffer with sequence numbers and filters
â”‚     â”œâ”€ ast/
â”‚     â”‚  â”œâ”€ parser.ts â€” Tree-sitter parser module for AST extraction
â”‚     â”‚  â”œâ”€ toolService.ts â€” AST tool validation and query service
â”‚     â”‚  â”œâ”€ types.ts â€” AST parser types and result shapes
â”‚     â”‚  â””â”€ queries/
â”‚     â”‚     â”œâ”€ python/locals.scm â€” Tree-sitter locals query for Python
â”‚     â”‚     â”œâ”€ c_sharp/locals.scm â€” Tree-sitter locals query for C#
â”‚     â”‚     â”œâ”€ rust/locals.scm â€” Tree-sitter locals query for Rust
â”‚     â”‚     â””â”€ cpp/locals.scm â€” Tree-sitter locals query for C++
â”‚     â”œâ”€ config/
â”‚     â”‚  â”œâ”€ codexConfig.ts â€” Codex home/env config builder
â”‚     â”‚  â”œâ”€ chatDefaults.ts â€” shared chat provider/model default resolver (request -> env -> fallback)
â”‚     â”‚  â””â”€ codexEnvDefaults.ts â€” Codex env defaults parser + warnings helper
â”‚     â”‚  â””â”€ startupEnv.ts â€” startup env bootstrap (`.env` then optional `.env.local`) + OpenAI capability-state resolver
â”‚     â”œâ”€ chatStream.ts — SSE helper for streaming endpoints (e.g., `/logs/stream`); chat runs stream over `/ws`
â”‚     â”œâ”€ chat/
â”‚     â”‚  â”œâ”€ factory.ts — provider map returning ChatInterface instances or throws UnsupportedProviderError
â”‚     â”‚  â”œâ”€ memoryPersistence.ts — shared in-memory conversation/turn store for Mongo-down/test fallback
â”‚     â”‚  â”œâ”€ interfaces/ChatInterface.ts — base chat abstraction with normalized events and persistence helpers
â”‚     â”‚  â”œâ”€ interfaces/ChatInterfaceCodex.ts — Codex provider implementation with item-keyed assistant merge + single authoritative finalization
â”‚     â”‚  â”œâ”€ interfaces/ChatInterfaceLMStudio.ts — LM Studio provider implementation emitting normalized chat events
â”‚     â”‚  â””â”€ responders/McpResponder.ts — buffers normalized chat events into MCP segments payload
â”‚     â”œâ”€ routes/
â”‚     â”‚  â”œâ”€ chat.ts — POST /chat run starter (202) + background execution + WS bridge
â”‚     â”‚  â”œâ”€ chatValidators.ts — chat request validation + Codex-only flag stripping/defaults
â”‚     â”‚  â”œâ”€ chatModels.ts â€” LM Studio chat models list endpoint
â”‚     â”‚  â”œâ”€ chatProviders.ts — lists chat providers with availability flags
â”‚     â”‚  â”œâ”€ conversations.ts — list/create/archive/restore conversations and turns append/list
â”‚     â”‚  â”œâ”€ ingestModels.ts — GET /ingest/models embedding models list + lock info
â”‚     â”‚  â”œâ”€ ingestRoots.ts — GET /ingest/roots listing embedded roots and lock state
â”‚     â”‚  â”œâ”€ ingestCancel.ts — POST /ingest/cancel/:runId cancels active ingest and cleans vectors
â”‚     â”‚  â”œâ”€ ingestReembed.ts — POST /ingest/reembed/:root re-runs ingest for a stored root
â”‚     â”‚  â”œâ”€ ingestRemove.ts — POST /ingest/remove/:root purge vectors/metadata and unlock if empty
â”‚     â”‚  â”œâ”€ logs.ts â€” log ingestion, history, and SSE streaming routes
â”‚     â”‚  â”œâ”€ flows.ts — GET /flows list endpoint
â”‚     â”‚  â”œâ”€ flowsRun.ts — POST /flows/:flowName/run flow runner endpoint
â”‚     â”‚  â”œâ”€ toolsIngestedRepos.ts â€” GET /tools/ingested-repos repo list for agent tools
â”‚     â”‚  â”œâ”€ toolsVectorSearch.ts â€” POST /tools/vector-search chunk search with optional repo filter
â”‚     â”‚  â”œâ”€ toolsAstListSymbols.ts â€” POST /tools/ast-list-symbols AST symbol listing
â”‚     â”‚  â”œâ”€ toolsAstFindDefinition.ts â€” POST /tools/ast-find-definition AST definition lookup
â”‚     â”‚  â”œâ”€ toolsAstFindReferences.ts â€” POST /tools/ast-find-references AST reference lookup
â”‚     â”‚  â”œâ”€ toolsAstCallGraph.ts â€” POST /tools/ast-call-graph AST call graph query
â”‚     â”‚  â”œâ”€ toolsAstModuleImports.ts â€” POST /tools/ast-module-imports AST module import summary
â”‚     â”‚  â””â”€ lmstudio.ts â€” LM Studio proxy route
â”‚     â”œâ”€ mongo/
â”‚     â”‚  â”œâ”€ connection.ts — Mongoose connect/disconnect helpers with strictQuery + logging
â”‚     â”‚  â”œâ”€ conversation.ts — conversation schema/model (provider, agentName?, flags, lastMessageAt, archivedAt)
â”‚     â”‚  â”œâ”€ turn.ts — turn schema/model (role/content/provider/model/toolCalls/status)
â”‚     â”‚  â”œâ”€ ingestFile.ts — per-file hash index schema/model for delta ingest decisions
â”‚     â”‚  â”œâ”€ astCoverage.ts — AST coverage schema/model (per-root counts + lastIndexedAt)
â”‚     â”‚  â”œâ”€ astEdge.ts — AST edge schema/model (call/import edges per file)
â”‚     â”‚  â”œâ”€ astModuleImport.ts — AST module import schema/model (source + imported names)
â”‚     â”‚  â”œâ”€ astReference.ts — AST reference schema/model (symbol/name references)
â”‚     â”‚  â”œâ”€ astSymbol.ts — AST symbol schema/model (deterministic symbolId + range)
â”‚     â”‚  â””â”€ repo.ts — persistence helpers for create/update/archive/restore/list + turn append
â”‚     â”œâ”€ mcp/ — Express MCP v1 endpoint (POST /mcp) exposing ingest tools to agent clients
â”‚     â”‚  â””â”€ server.ts — Express MCP v1 router (initialize/tools/resources); uses mcpCommon helpers while preserving wire formats, tool schemas, and domain error mapping
â”‚     â”œâ”€ mcpCommon/ — shared MCP/JSON-RPC infrastructure used by both MCP servers (helpers/dispatch only; must not change wire formats)
â”‚     â”‚  â”œâ”€ guards.ts — tiny shared type guards for MCP request validation
â”‚     â”‚  â”œâ”€ jsonRpc.ts — shared JSON-RPC response helpers (result/error envelopes)
â”‚     â”‚  â”œâ”€ dispatch.ts — shared method dispatch skeleton (routes to handler callbacks, returns verbatim payloads)
â”‚     â”‚  â””â”€ keepAlive.ts — shared MCP keepalive lifecycle helper (start/heartbeat/stop + safe response writes)
â”‚     â”œâ”€ mcp2/ — MCP v2 JSON-RPC server on port 5011
â”‚     â”‚  â”œâ”€ server.ts — start/stop JSON-RPC server
â”‚     â”‚  â”œâ”€ router.ts — JSON-RPC handlers (initialize/tools/resources); uses mcpCommon dispatch/guards while keeping body parsing, parse errors, response writing, and MCP v2 error contracts local
â”‚     â”‚  â”œâ”€ types.ts — JSON-RPC envelope helpers
â”‚     â”‚  â”œâ”€ errors.ts — shared MCP error helpers
â”‚     â”‚  â”œâ”€ codexAvailability.ts — detects Codex readiness for provider-aware execution fallback
â”‚     â”‚  â”œâ”€ tools.ts — MCP tool registry wiring (`codebase_question`, `reingest_repository`)
â”‚     â”‚  â”œâ”€ tools/codebaseQuestion.ts — `codebase_question` tool bridging chat with resolver-backed Codex defaults/warnings parity plus vector-search-backed answer shaping
â”‚     â”‚  â””â”€ tools/reingestRepository.ts — MCP v2 `reingest_repository` tool wrapper over shared reingest validation/service
â”‚     â”œâ”€ mcpAgents/ — Agents MCP v2 server on port 5012
â”‚     â”‚  â”œâ”€ server.ts — start/stop Agents JSON-RPC server
â”‚     â”‚  â”œâ”€ router.ts — JSON-RPC handlers (initialize/tools/resources); tools/list ungated; tools/call gated for run_agent_instruction
â”‚     â”‚  â”œâ”€ types.ts — JSON-RPC envelope helpers
â”‚     â”‚  â”œâ”€ errors.ts — Agents MCP domain errors (Codex unavailable)
â”‚     â”‚  â”œâ”€ codexAvailability.ts — Codex CLI availability check for tool call gating
â”‚     â”‚  â””â”€ tools.ts — Agents tool registry wiring
â”‚     â”œâ”€ flows/
â”‚     â”‚  â”œâ”€ discovery.ts — flow discovery and summary listing (hot reload)
â”‚     â”‚  â”œâ”€ flowSchema.ts — strict Zod schema for flow JSON validation
â”‚     â”‚  â”œâ”€ service.ts — flow run execution (llm-only core)
â”‚     â”‚  â””â”€ types.ts — flow run types + error codes
â”‚     â”œâ”€ test/unit/chat-assistant-suppress.test.ts â€” unit coverage for assistant-role tool payload suppression helpers
â”‚     â”œâ”€ test/unit/codexEnvDefaults.test.ts â€” unit coverage for Codex env defaults parsing/warnings
â”‚     â”œâ”€ test/unit/env-loading.test.ts â€” unit coverage for startup env precedence and missing `.env.local` fallback behavior
â”‚     â”œâ”€ test/unit/env-logging.test.ts â€” unit coverage for OpenAI capability-state logging redaction behavior
â”‚     â”œâ”€ ingest/ â€” ingest helpers (discovery, chunking, hashing, config)
â”‚     â”‚  â”œâ”€ __fixtures__/sample.ts â€” sample text blocks for chunking tests
â”‚     â”‚  â”œâ”€ lock.ts — single-flight ingest lock with TTL
â”‚     â”‚  â”œâ”€ chunker.ts â€” boundary-aware chunking with token limits
â”‚     â”‚  â”œâ”€ config.ts â€” ingest config resolver for include/exclude and token safety
â”‚     â”‚  â”œâ”€ discovery.ts â€” git-aware file discovery with exclude/include and text check
â”‚     â”‚  â”œâ”€ hashing.ts â€” sha256 hashing for files/chunks
â”‚     â”‚  â”œâ”€ deltaPlan.ts â€” pure delta planner for added/changed/deleted files (no IO)
â”‚     â”‚  â”œâ”€ pathMap.ts — maps container ingest paths to host paths for tooling responses
â”‚     â”‚  â”œâ”€ reingestService.ts — shared `reingest_repository` validation + canonical success/error mapping service
â”‚     â”‚  â”œâ”€ index.ts â€” barrel export for ingest helpers
â”‚     â”‚  â””â”€ types.ts â€” ingest types (DiscoveredFile, Chunk, IngestConfig)
â”‚     â”œâ”€ lmstudio/
â”‚     â”‚  â”œâ”€ clientPool.ts â€” pooled LM Studio clients with closeAll/reset helpers
â”‚     â”‚  â”œâ”€ toolService.ts â€” shared helpers for LM Studio tools + tooling routes (list/search)
â”‚     â”‚  â””â”€ tools.ts â€” LM Studio tool schemas for list/vector search used by chat
â”‚     â”œâ”€ types/
â”‚     â”‚  â”œâ”€ pino-roll.d.ts â€” module shim for pino-roll until official types
â”‚     â”‚  â””â”€ tree-sitter.d.ts â€” local module shim for tree-sitter typings
â”‚     â””â”€ test/
â”‚        â”œâ”€ fixtures/
â”‚        â”‚  â”œâ”€ flows/
â”‚        â”‚  â””â”€ multi-agent.json â€” flow fixture for multi-agent integration coverage
â”‚        â”œâ”€ features/
        - chat_stream.feature - chat run + WS streaming Cucumber coverage
        - chat_cancellation.feature - Cucumber coverage for aborting chat streams
        - chat_models.feature - Cucumber coverage for chat model list endpoint
        - chat-tools-visibility.feature - tool request/result metadata in chat stream
        - example.feature - sample feature
        - lmstudio.feature - LM Studio proxy scenarios
        - ingest-models.feature - embedding models endpoint scenarios
        - ingest-roots.feature - ingest roots listing endpoint scenarios
        - ingest-cancel.feature - cancel active ingest scenarios
        - ingest-reembed.feature - re-embed scenarios
        - ingest-remove.feature - remove root scenarios
        - ingest-dryrun-no-write.feature - dry-run skip write scenarios
        - ingest-status.feature - ingest status endpoint includes per-file progress fields
        - ingest-empty-drop-collection.feature - delete empty collection + re-ingest
â”‚        â”œâ”€ steps/
        - chat_stream.steps.ts - step defs for chat_stream.feature
        - chat_cancellation.steps.ts - step defs for chat_cancellation.feature
        - chat_models.steps.ts - step defs for chat_models.feature
        - chat-tools-visibility.steps.ts - step defs for chat tool metadata visibility
        - example.steps.ts - step defs for example.feature
        - lmstudio.steps.ts - step defs for LM Studio feature
        - ingest-models.steps.ts - step defs for ingest models endpoint
        - ingest-roots.steps.ts - step defs for ingest roots endpoint
        - ingest-manage.steps.ts - step defs for cancel/re-embed/remove endpoints
        - ingest-start.steps.ts - step defs for ingest start/status
        - ingest-start-body.steps.ts - step defs for ingest body validation
        - ingest-status.steps.ts - step defs for ingest status progress fields
        - ingest-roots-metadata.steps.ts - step defs for roots metadata
        - ingest-logging.steps.ts - step defs for ingest lifecycle logging
        - ingest-batch-flush.steps.ts - step defs for batched Chroma flush
        - ingest-lmstudio-protocol.steps.ts - step defs for LM Studio protocol guardrails
        - ingest-discovery-fallback.steps.ts - step defs for git fallback discovery
        - ingest-empty-drop-collection.steps.ts - step defs for collection delete/recreate
        - ingest-dryrun-no-write.steps.ts - step defs for dry-run no-write
â”‚        â”œâ”€ support/
â”‚        |  â””â”€ mockLmStudioSdk.ts â€” controllable LM Studio SDK mock
â”‚        â”œâ”€ fixtures/
â”‚        |  â”œâ”€ flows/
â”‚        |  â”œâ”€ hot-reload.json — flow run hot reload fixture
â”‚        |  â”œâ”€ ignore.txt — non-JSON flow fixture
â”‚        |  â”œâ”€ invalid-json.json — invalid flow JSON fixture
â”‚        |  â”œâ”€ invalid-schema.json — invalid flow schema fixture
â”‚        |  â”œâ”€ llm-basic.json — basic llm flow fixture
â”‚        |  â”œâ”€ command-step.json — command step flow fixture
â”‚        |  â”œâ”€ loop-break.json — loop + break flow fixture
â”‚        |  â””â”€ valid-flow.json — valid flow fixture
â”‚        â””â”€ unit/
â”‚           â”œâ”€ chunker.test.ts â€” chunking behaviour and slicing coverage
â”‚           â”œâ”€ discovery.test.ts â€” discovery include/exclude and git-tracked coverage
â”‚           â”œâ”€ hashing.test.ts â€” deterministic hashing coverage
â”‚           â”œâ”€ clientPool.test.ts â€” LM Studio client pooling + closeAll behaviour
â”‚           â”œâ”€ pathMap.test.ts â€” host/container path mapping helper coverage
â”‚           â”œâ”€ chat-tools.test.ts â€” LM Studio tools schemas/logging + list/search outputs
â”‚           â”œâ”€ chat-tools-wire.test.ts â€” chat router injects LM Studio tools into act calls
â”‚           â”œâ”€ chat-unsupported-provider.test.ts — REST /chat returns 400 on unsupported provider error path
â”‚           â”œâ”€ chat-interface-run-persistence.test.ts — ChatInterface.run persists user turn then delegates execute, with memory fallback coverage
â”‚           â”œâ”€ chat-command-metadata.test.ts — ChatInterface.run persists command metadata on user+assistant turns (including aborted/stopped runs)
â”‚           â”œâ”€ chatValidators.test.ts — unit coverage for Codex env defaults + warnings in chat validation
â”‚           â”œâ”€ flows-schema.test.ts — unit coverage for flow schema parsing/strictness/trimming
â”‚           â”œâ”€ flows.flags.test.ts — unit coverage for flow resume flags persistence
â”‚           â”œâ”€ turn-command-metadata.test.ts — Turn persistence plumbs optional command metadata through append/list helpers
â”‚           â”œâ”€ toolService.synthetic.test.ts — unit coverage for onToolResult callback emission
â”‚           â”œâ”€ chroma-embedding-selection.test.ts â€” locked-model embedding function selection + error paths
â”‚           â”œâ”€ ingest-models.test.ts â€” supertest coverage for /ingest/models lock-source parity
â”‚           â”œâ”€ ingest-status.test.ts â€” ingest status progress fields round-trip helper coverage
â”‚           â”œâ”€ ingest-ast-indexing.test.ts â€” unit coverage for AST ingest counts, delta handling, and persistence skipping
â”‚           â”œâ”€ ingest-files-schema.test.ts â€” unit coverage for `ingest_files` Mongoose schema fields + indexes
â”‚           â”œâ”€ ast-symbols-schema.test.ts â€” unit coverage for `ast_symbols` schema fields + indexes
â”‚           â”œâ”€ ast-edges-schema.test.ts â€” unit coverage for `ast_edges` schema fields + indexes
â”‚           â”œâ”€ ast-references-schema.test.ts â€” unit coverage for `ast_references` schema fields + indexes
â”‚           â”œâ”€ ast-module-imports-schema.test.ts â€” unit coverage for `ast_module_imports` schema fields + indexes
â”‚           â”œâ”€ ast-coverage-schema.test.ts â€” unit coverage for `ast_coverage` schema fields + indexes
â”‚           â”œâ”€ ast-parser.test.ts â€” unit coverage for Tree-sitter parser output shapes
â”‚           â”œâ”€ ast-repo-guards.test.ts â€” unit coverage for mongo disconnected guard behaviour in AST repo helpers
â”‚           â”œâ”€ ast-tool-service.test.ts â€” unit coverage for AST tool service queries and error mapping
â”‚           â”œâ”€ ast-tool-validation.test.ts â€” unit coverage for AST tool request validation
â”‚           â”œâ”€ ingest-files-repo-guards.test.ts â€” unit coverage for mongo disconnected guard behaviour in ingest_files repo helpers
â”‚           â”œâ”€ ingest-delta-plan.test.ts â€” unit coverage for delta planning categorization logic
â”‚           â”œâ”€ tools-ingested-repos.test.ts â€” supertest coverage for /tools/ingested-repos
â”‚           â”œâ”€ mcp-common-dispatch.test.ts â€” unit tests for shared MCP dispatcher routing/verbatim payload behavior
â”‚           â”œâ”€ mcp2-router-initialize.test.ts â€” MCP v2 initialize handshake protocol/serverInfo coverage
â”‚           â”œâ”€ mcp2-router-list-happy.test.ts â€” MCP v2 tools/list happy path characterization when Codex is forced available
â”‚           â”œâ”€ mcp2-router-list-unavailable.test.ts â€” MCP v2 tools/list gating + resources key naming characterization when Codex is forced unavailable
â”‚           â”œâ”€ mcp2-router-parse-error.test.ts â€” MCP v2 parse error (-32700) characterization (invalid JSON body)
â”‚           â”œâ”€ mcp2-router-invalid-request.test.ts â€” MCP v2 invalid request (-32600) characterization (invalid JSON-RPC envelope)
â”‚           â”œâ”€ mcp2-router-method-not-found.test.ts â€” MCP v2 method not found (-32601) characterization (unknown method)
â”‚           â”œâ”€ mcp2-router-tool-not-found.test.ts â€” MCP v2 unknown tool mapping characterization (tools/call -> -32601)
â”‚           â”œâ”€ mcp2.reingest.tool.test.ts â€” MCP v2 `reingest_repository` tools/list + tools/call success/error + parity contract coverage
â”‚           â”œâ”€ mcp-ingested-repositories.test.ts â€” supertest coverage for classic MCP ListIngestedRepositories lock parity
â”‚           â”œâ”€ mcp.keepalive.helper.test.ts â€” unit coverage for shared keepalive helper lifecycle and write-after-close protection
â”‚           â”œâ”€ mcp.reingest.classic.test.ts â€” unit coverage for classic MCP `reingest_repository` tools/list + tools/call success/error contracts
â”‚           â”œâ”€ reingest-tool-result.test.ts â€” unit coverage for the shared structured re-ingest tool-result builder, wrapper compatibility, and distinct `callId` preservation
â”‚           â”œâ”€ reingestService.test.ts â€” unit coverage for `reingest_repository` validation, success mapping, unknown root retry guidance, and busy contracts
â”‚           â”œâ”€ mcp-unsupported-provider.test.ts — MCP tools/call unsupported provider error path
â”‚           â””â”€ tools-vector-search.test.ts â€” supertest coverage for /tools/vector-search
â”‚        â”œâ”€ integration/
â”‚        |  â”œâ”€ flows.list.test.ts â€” integration coverage for GET /flows listing
â”‚        |  â”œâ”€ flows.run.basic.test.ts â€” integration coverage for POST /flows/:flowName/run streaming
â”‚        |  â”œâ”€ flows.run.command.test.ts â€” integration coverage for command-step flow runs
â”‚        |  â”œâ”€ flows.run.errors.test.ts â€” integration coverage for flow run error responses
â”‚        |  â”œâ”€ flows.run.resume.test.ts â€” integration coverage for flow run resume validation
â”‚        |  â”œâ”€ flows.run.working-folder.test.ts â€” integration coverage for flow run working_folder validation
â”‚        |  â”œâ”€ flows.run.hot-reload.test.ts â€” integration coverage for flow run hot reload
â”‚        |  â”œâ”€ flows.run.loop.test.ts â€” integration coverage for flow run loop + break
â”‚        |  â”œâ”€ flows.turn-metadata.test.ts â€” integration coverage for flow command metadata
â”‚        |  â””â”€ tools-ast.test.ts â€” integration coverage for AST REST tool routes
â”‚        |  â”œâ”€ commands.reingest.test.ts â€” integration coverage for direct-command re-ingest bootstrap, repeated `callId` handling, and mixed re-ingest/message runs
â”‚        |  â”œâ”€ chat-tools-wire.test.ts â€” chat route wiring (POST /chat 202 + WS bridge) with mocked LM Studio tools
â”‚        |  â”œâ”€ chat-vectorsearch-locked-model.test.ts â€” chat run error/success flows when vector search lock/embedding availability changes
â”‚        |  â”œâ”€ chat-codex.test.ts — Codex chat run flow, thread reuse, availability gating, and terminal dedupe regressions
â”‚        |  â”œâ”€ chat-codex-mcp.test.ts — Codex MCP tool-call mapping to WS `tool_event` and SYSTEM_CONTEXT injection
â”‚        |  â”œâ”€ chat-assistant-persistence.test.ts — assistant turn + toolCalls persisted once for Codex and LM Studio (memory mode)
â”‚        |  â”œâ”€ mcp-lmstudio-wrapper.test.ts — LM Studio MCP segments snapshot/order coverage
â”‚        |  â””â”€ mcp-codex-wrapper.test.ts — MCP responder segments snapshot/order coverage for Codex
â”‚        |  â”œâ”€ mcp-persistence.test.ts — MCP persistence source coverage (MCP chats stored with source metadata)
â”‚        |  â”œâ”€ rest-persistence-source.test.ts — REST chat run stores user + assistant turns with source tracking in memory mode
â”œâ”€ .husky/ â€” git hooks managed by Husky
â”‚  â”œâ”€ pre-commit â€” runs lint-staged
â”‚  â””â”€ _/
â”‚     â”œâ”€ .gitignore â€” keep generated scripts out of git
â”‚     â”œâ”€ applypatch-msg â€” hook stub
â”‚     â”œâ”€ commit-msg â€” hook stub
â”‚     â”œâ”€ h â€” Husky helper
â”‚     â”œâ”€ husky.sh â€” Husky bootstrap
â”‚     â”œâ”€ post-applypatch â€” hook stub
â”‚     â”œâ”€ post-checkout â€” hook stub
â”‚     â”œâ”€ post-commit â€” hook stub
â”‚     â”œâ”€ post-merge â€” hook stub
â”‚     â”œâ”€ post-rewrite â€” hook stub
â”‚     â”œâ”€ pre-applypatch â€” hook stub
â”‚     â”œâ”€ pre-auto-gc â€” hook stub
â”‚     â”œâ”€ pre-commit â€” hook stub
â”‚     â”œâ”€ pre-merge-commit â€” hook stub
â”‚     â”œâ”€ pre-push â€” hook stub
â”‚     â”œâ”€ pre-rebase â€” hook stub
â”‚     â””â”€ prepare-commit-msg â€” hook stub
â””â”€ .husky/pre-commit â€” root hook invoking lint-staged (already listed above for clarity)
```

- Added ingest routes/tests:
  - server/src/routes/ingestStart.ts — POST /ingest/start and GET /ingest/status/:runId
  - server/src/routes/ingestDirs.ts — GET /ingest/dirs directory picker listing
  - server/src/ingest/chromaClient.ts — Chroma client helpers and lock metadata
  - server/src/ingest/ingestJob.ts — ingest orchestrator, status tracking, embedding flow
  - server/src/test/features/ingest-start.feature — ingest start/status scenarios
  - server/src/test/steps/ingest-start.steps.ts — step defs for ingest start/status
  - server/src/test/features/ingest-start-body.feature — ingest start accepts JSON body
- server/src/test/features/ingest-roots-metadata.feature — roots endpoint ok without null metadata
- server/src/test/steps/ingest-start-body.steps.ts — step defs for JSON body ingest start
- server/src/test/steps/ingest-roots-metadata.steps.ts — step defs for roots metadata
- server/src/test/compose/docker-compose.chroma.yml — manual Chroma debug compose (port 18000)
- server/src/test/support/chromaContainer.ts — Cucumber hooks starting Chroma via Testcontainers
- server/src/test/support/mongoContainer.ts — Cucumber hooks starting Mongo (tagged `@mongo`) via Testcontainers
- server/src/test/features/ingest-delta-reembed.feature — delta re-embed scenarios (changed/add/delete/no-op/legacy/degraded)
- server/src/test/steps/ingest-delta-reembed.steps.ts — step defs for delta re-embed scenarios
- server/src/test/unit/ingest-roots-dedupe.test.ts — unit coverage for `/ingest/roots` response dedupe
- server/src/test/unit/ingest-dirs-router.test.ts — unit coverage for `/ingest/dirs` response contract and edge cases
- server/src/test/unit/repo-persistence-source.test.ts — defaults source to REST and preserves MCP
- server/src/test/unit/repo-conversations-agent-filter.test.ts — repo query coverage for `agentName=__none__` and exact agent filters
- server/src/test/unit/codexConfig.test.ts — verifies `buildCodexOptions({ codexHome })` resolves and injects `env.CODEX_HOME`
- server/src/test/unit/codexConfig.device-auth.test.ts — unit coverage for device-auth config persistence helper
- server/src/utils/codexDeviceAuth.ts — Codex device-auth CLI runner + stdout parser with sanitized logging
- server/src/utils/truncateText.ts — shared deterministic truncation helper used by retry-context and device-auth sanitization
- server/src/utils/retryContext.ts — shared retry prompt/error sanitizer for Task 0000036-T5 flow and command retries
- server/src/test/unit/codexDeviceAuth.test.ts — unit coverage for device-auth parsing and error handling
- server/src/routes/codexDeviceAuth.ts — `POST /codex/device-auth` device-auth endpoint for chat/agent targets
- server/src/test/unit/chroma-lock.test.ts — unit coverage for canonical/legacy lock resolution, canonical lock writes, and partial canonical lock rejection.
- server/src/test/integration/ingest-lock-lifecycle.test.ts — integration coverage for deterministic `BUSY` lifecycle behavior and lock-clear idempotence guards.
- server/src/test/integration/ingest-reembed.test.ts — integration coverage for re-embed provider/model immutability and invalid-state rejection.
- server/src/test/integration/mcp-vector-search.test.ts — integration coverage for classic MCP vector-search provider/model lock parity with REST.
- server/src/test/integration/codex.device-auth.test.ts — integration coverage for device-auth route validation + responses
- server/src/agents/types.ts — agent DTOs for discovery/service (REST-safe + internal paths)
- server/src/agents/discovery.ts — discovers agents from `CODEINFO_CODEX_AGENT_HOME`
- server/src/agents/authSeed.ts — best-effort copy of primary `auth.json` into agent homes (never overwrite, lock-protected)
- server/src/agents/commandsSchema.ts — strict Zod v1 schema + safe parser for agent command JSON files
- server/src/agents/commandsLoader.ts — reads command files and returns safe `{ name, description, disabled, stepCount }` summaries (`stepCount >= 1`, sentinel `1` for disabled/invalid)
- server/src/agents/commandItemExecutor.ts — shared `message`-item instruction preparation and dispatch for direct commands and flow-owned command steps, including markdown resolution reuse and Task 45 T6 flow-command observability logging
- server/src/agents/commandsRunner.ts — executes parsed agent commands sequentially with abort checks + conversation lock, including runtime `startStep` range validation (`1..N`), zero-based boundary conversion, and deterministic `INVALID_START_STEP` errors
- server/src/agents/retry.ts — AbortSignal-aware retry/backoff helper used by the command runner
- server/src/ingest/providers/openaiConstants.ts — OpenAI embedding adapter constants (allowlist, retry policy, guardrail thresholds, token-limit resolver)
- server/src/ingest/providers/openaiErrors.ts — OpenAI error taxonomy mapper + normalized/secret-safe OpenAI embedding error shape
- server/src/ingest/providers/openaiGuardrails.ts — OpenAI embeddings request guardrail checks (input count, per-input tokens, total tokens)
- server/src/ingest/providers/openaiRetry.ts — OpenAI retry wrapper built on shared `runWithRetry` with wait-hint precedence + bounded exponential fallback
- server/src/ingest/providers/openaiEmbeddingProvider.ts — OpenAI embedding provider implementation for shared ingest/query embedding contract
- server/src/ingest/providers/providerResolver.ts — deterministic model-id -> provider/model resolver used by ingest/query embedding paths
- server/src/agents/transientReconnect.ts — transient reconnect classifier ("Reconnecting... n/m") + safe error message helper
- server/src/config/flowAndCommandRetries.ts — shared retry-budget resolver (`FLOW_AND_COMMAND_RETRIES`, default 5 total attempts)
- server/src/config/openaiIngestRetries.ts — OpenAI ingest retry-budget resolver (`OPENAI_INGEST_MAX_RETRIES`, retries after initial attempt, fallback default 3)
- server/src/agents/runLock.ts — in-memory per-conversation run lock for agent/command execution
- server/src/agents/config.ts — minimal agent `config.toml` parsing helpers (e.g. top-level `model`)
- server/src/agents/service.ts — shared agents service used by REST + Agents MCP (list agents + run agent instruction), including `startStep` defaulting to `1` for command runs and T03 start-step diagnostic logging
- server/src/routes/agents.ts — `GET /agents` agent listing endpoint (REST source of truth)
- server/src/routes/codexDeviceAuth.ts — `POST /codex/device-auth` device-auth endpoint for chat/agent targets
- server/src/routes/agentsRun.ts — `POST /agents/:agentName/run` agent execution endpoint (REST; delegates to shared service)
- server/src/routes/agentsCommands.ts — agent command endpoints: `GET /agents/:agentName/commands` (list) + `POST /agents/:agentName/commands/run` (execute), including optional `startStep` request parsing/type validation and deterministic `INVALID_START_STEP` mapping
- server/src/test/unit/agents-discovery.test.ts — unit coverage for agent discovery rules (config/description/system prompt)
- server/src/test/unit/agents-authSeed.test.ts — unit coverage for agent auth seeding (copy/no-overwrite/concurrency)
- server/src/test/unit/agents-router-list.test.ts — Supertest coverage for `GET /agents` response shape and description handling
- server/src/test/unit/agents-router-run.test.ts — Supertest coverage for `POST /agents/:agentName/run` validation/error mapping/shape
- server/src/test/unit/agents-commands-router-list.test.ts — Supertest coverage for `GET /agents/:agentName/commands` response shape (`stepCount` included on every item) and 404 mapping
- server/src/test/unit/agents-commands-router-run.test.ts — Supertest coverage for `POST /agents/:agentName/commands/run` validation/error mapping/abort wiring, including optional `startStep` and deterministic `INVALID_START_STEP` payloads
- server/src/test/unit/agents-working-folder.test.ts — unit coverage for resolving agent working folder into a Codex workingDirectory override
- server/src/test/unit/agent-commands-schema.test.ts — unit coverage for v1 agent command JSON schema parsing/strictness/trimming
- server/src/test/unit/agent-commands-loader.test.ts — unit coverage for loading command summaries from disk (valid/invalid/missing)
- server/src/test/unit/agent-commands-list.test.ts — unit coverage for listing agent commands from `commands/` (missing folder, filtering, sorting, no-cache, and `stepCount` semantics for valid/invalid entries)
- server/src/test/unit/agent-commands-runner.test.ts — unit coverage for command execution runner (sequential steps, abort stop, lock behavior, `startStep` defaults/boundaries/offsets, and deterministic `INVALID_START_STEP` failures)
- server/src/test/integration/commands.reingest.test.ts — integration coverage for direct-command Story 45 `reingest` bootstrap, structured tool-call persistence, repeated `callId` handling, and mixed re-ingest/message ordering
- server/src/test/unit/agent-commands-runner-retry.test.ts — unit coverage for transient reconnect retry behavior in the command runner
- server/src/test/unit/flow-command-retries-config.test.ts — unit coverage for shared flow/command retry-budget parsing behavior
- server/src/test/unit/agent-commands-runner-abort-retry.test.ts — unit coverage that retries stop immediately when aborted
- server/src/test/unit/openai-provider-retry.test.ts — unit coverage for OpenAI retry defaults, wait-hint precedence/fallback, and retry-exhaustion normalization
- server/src/test/unit/openai-ingest-retries-config.test.ts — unit coverage for OpenAI ingest retry env parsing (unset/invalid fallback and valid override)
- server/src/test/unit/openai-provider.test.ts — unit coverage for OpenAI adapter timeout/maxRetries ownership and embedding response-shape validation
- server/src/test/unit/openai-provider-errors.test.ts — unit coverage for OpenAI taxonomy mapping, retryability matrix, and secret-safe redaction
- server/src/test/unit/openai-provider-guardrails.test.ts — unit coverage for OpenAI embedding guardrail boundaries (input count and token limits)
- server/src/test/unit/flows.break-parser.test.ts — unit coverage for strict/fenced/balanced break-answer parsing order, schema gating, and terminal failure behavior
- server/src/test/unit/mcp-responder-transient-error.test.ts — unit coverage that McpResponder ignores transient reconnect error events
- server/src/test/unit/chat-command-metadata.test.ts — unit coverage that chat persistence attaches `command` metadata to turns created by command runs
- server/src/test/unit/chatModels.codex.test.ts — unit coverage for `/chat/models` resolver-backed Codex defaults/warnings, model capability payloads, and parity fixtures
- server/src/test/unit/chatProviders.test.ts — unit coverage for `/chat/providers` availability ordering plus resolver-backed `codexDefaults`/`codexWarnings` parity
- server/src/test/integration/openai-retry-env-override.test.ts — integration coverage for OpenAI retryable-failure attempt counts honoring `OPENAI_INGEST_MAX_RETRIES`
- server/src/config/chatDefaults.ts — shared Codex chat-default resolver for `sandbox_mode`, `approval_policy`, `model_reasoning_effort`, `model`, and `web_search` with precedence (`override -> config -> env -> hardcoded`) plus field-specific env fallback warnings
- server/src/test/unit/config.chatDefaults.test.ts — unit coverage for shared chat default resolution precedence
- server/src/test/unit/chatValidators.test.ts — unit coverage for resolver-backed Codex validation defaults, warning semantics, and parity fixtures
- server/src/test/unit/chat-codex-workingDirectoryOverride.test.ts — ensures ChatInterfaceCodex honors per-call workingDirectory overrides
- server/src/test/unit/conversations-router-agent-filter.test.ts — Supertest coverage for `/conversations?agentName=...` request forwarding
- server/src/test/integration/conversations.bulk.test.ts — Supertest coverage for bulk conversation endpoints (archive/restore/delete + validation/conflicts)
- server/src/test/integration/conversations.flowname.test.ts — Supertest coverage for flowName field in conversation listings
- server/src/mongo/events.ts — in-process conversation upsert/delete event bus (used for WS sidebar fan-out)
- server/src/ws/types.ts — WebSocket v1 protocol envelope/types + inbound message parser
- server/src/ws/registry.ts — in-memory subscription registry (sidebar + per-conversation)
- server/src/ws/sidebar.ts — sidebar broadcaster (repo events → WS `conversation_upsert`/`conversation_delete`)
- server/src/ws/server.ts — `/ws` upgrade handler + ping/pong heartbeat + message dispatch
- server/src/chat/inflightRegistry.ts — in-memory active-run registry (assistantText/think/toolEvents/seq + AbortController) with replacement-aware final text and idempotent finalization guards
- server/src/chat/chatStreamBridge.ts — shared bridge wiring ChatInterface events to inflight updates + WS transcript publishing with single-shot terminal publish semantics
- server/src/chat/reingestToolResult.ts — shared Story 45 builder that converts terminal re-ingest outcomes into the nested `reingest_step_result` payload inside the existing `ChatToolResultEvent` wrapper
- server/src/chat/reingestStepLifecycle.ts — shared Story 45 non-agent lifecycle that creates inflight state, publishes a synthetic user turn and re-ingest `tool_event`, persists assistant `toolCalls`, and finalizes the outer turn on the existing `ok` path
- server/src/test/unit/ws-server.test.ts — unit coverage for `/ws` connection and protocol gating
- server/src/test/support/wsClient.ts — shared WebSocket test helper (connect/sendJson/waitForEvent/close) used by Cucumber + node:test
- server/src/test/unit/ws-chat-stream.test.ts — unit coverage for WS transcript sequencing, catch-up snapshots, cancellation errors, stale/late delta guards, unsubscribe behavior, and inflight cleanup
- server/src/test/unit/reingest-step-lifecycle.test.ts — unit coverage for the shared re-ingest lifecycle ordering, publication, persistence shape, outer-vs-nested status separation, and caller-supplied metadata passthrough
- server/src/test/integration/mcp-codebase-question-ws-stream.test.ts — integration coverage proving MCP `codebase_question` runs publish WS transcript updates
- server/src/test/integration/mcp-server.test.ts — integration coverage for MCP v1 tools/list + tools/call (vector search + AST tools) and error mappings
- server/src/test/integration/agents-run-ws-stream.test.ts — integration coverage proving agent runs publish WS transcript updates, including absolute `stepIndex`/`totalSteps` metadata for `startStep > 1`
- server/src/test/integration/agents-run-ws-cancel.test.ts — integration coverage proving agent runs can be cancelled via WS `cancel_inflight`
- server/src/test/integration/agents-run-client-conversation-id.test.ts — integration coverage for client-supplied conversation ids plus command-run `startStep` omission defaults and runtime step-drift rejection
- server/src/test/integration/conversations.turns.test.ts — integration coverage for conversation turns API including persisted `command` metadata stability for start-step offset histories
- server/src/test/integration/ws-logs.test.ts — integration coverage proving WS lifecycle logs are queryable via `GET /logs`
- server/src/test/unit/turn-command-metadata.test.ts — unit coverage that turn repo helpers persist and rehydrate optional `command` metadata
- server/src/mcpAgents/server.ts — start/stop Agents MCP JSON-RPC server on `AGENTS_MCP_PORT` (default 5012)
- server/src/mcpAgents/router.ts — Agents MCP JSON-RPC handlers (initialize/tools/resources) with ungated tools/list
- server/src/mcpAgents/tools.ts — Agents MCP tool registry (list_agents/list_commands/run_agent_instruction/run_command) delegating to shared agents service
- server/src/mcpAgents/types.ts — Agents MCP JSON-RPC types and response helpers
- server/src/mcpAgents/errors.ts — Codex unavailable error for Agents MCP tool calls
- server/src/mcpAgents/codexAvailability.ts — Codex CLI availability check used for Agents MCP gating
- server/src/test/unit/mcp-agents-router-list.test.ts — unit coverage that Agents MCP exposes exactly four tools
- server/src/test/unit/mcp-agents-commands-list.test.ts — unit coverage for Agents MCP list_commands output shapes, filtering, and param errors
- server/src/test/unit/mcp-agents-router-run.test.ts — unit coverage that Agents MCP returns JSON text content with segments
- server/src/test/unit/mcp-agents-commands-run.test.ts — unit coverage for Agents MCP run_command tool (success + error mappings) plus regression guard that MCP schema/input still excludes `startStep`
- server/src/test/unit/mcp-agents-tools.test.ts — unit coverage for tools-layer argument forwarding and invalid-params error mapping
- server/src/test/integration/mcp-persistence-source.test.ts — MCP persistence adds source metadata and persists MCP runs
- codex_agents/planning_agent/commands/improve_plan.json — long-form planning macro used to refine story plans
- codex_agents/planning_agent/commands/smoke.json — smoke-test planning macro for validating `run_command` wiring
- client/src/test/useConversations.source.test.ts — hook defaults missing source to REST and preserves MCP
- client/src/test/chatPage.source.test.tsx — conversation list renders source labels for REST and MCP conversations
- client/src/api/agents.ts — Agents REST client wrapper with strict command-list `stepCount` parsing, optional `startStep` run payload serialization, and marker `DEV_0000040_T04_CLIENT_AGENTS_API`
- client/src/test/agentsApi.workingFolder.payload.test.ts — Agents API wrapper includes `working_folder` only when non-empty
- client/src/test/agentsApi.commandsList.test.ts — Agents API wrapper enforces required `stepCount` parsing (`integer >= 1`) and rejects missing/invalid command-list payloads
- client/src/test/agentsApi.commandsRun.test.ts — Agents API wrapper calls `POST /agents/:agentName/commands/run`, includes `startStep` only when provided, and omits optional fields when absent
- client/src/test/agentsApi.errors.test.ts — Agents API wrapper throws structured errors exposing HTTP status + server error codes (e.g., `RUN_IN_PROGRESS`)
- client/src/test/flowsApi.test.ts — Flows API wrapper list/run request shapes, parsed responses, and structured error coverage
- client/src/test/flowsApi.run.payload.test.ts — Flows API wrapper includes optional run payload fields (`working_folder`, `resumeStepPath`) when set
- client/src/pages/AgentsPage.tsx — Agents command row includes `Start step` (`Step 1..N`) state machine and execute marker `DEV_0000040_T05_AGENTS_UI_EXECUTE`
- client/src/test/agentsPage.commandsList.test.tsx — Agents page command dropdown plus `Start step` ordering/state/reset/single-step/disabled-command coverage
- client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx — Agents page command execution refreshes conversation turns for rendering
- client/src/test/agentsPage.commandsRun.conflict.test.tsx — Agents page surfaces RUN_IN_PROGRESS conflicts for both command execute and normal send
- client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx — Agents page persistence-disable behavior and execute payload `startStep` assertions
- client/src/test/agentsPage.run.commandError.test.tsx — Agents page command run errors include unchanged backend `INVALID_START_STEP` range messages
- client/src/test/agentsPage.commandsRun.abort.test.tsx — Agents page Stop sends WS cancel_inflight (does not abort async start request)
- client/src/test/agentsPage.streaming.test.tsx — Agents page renders live WS transcript updates and unsubscribes on conversation switch
- client/src/test/agentsPage.sidebarWs.test.tsx — Agents page sidebar applies subscribe_sidebar conversation_upsert/delete with agentName filtering + ordering
- client/src/test/agentsPage.sidebarActions.test.tsx — Agents sidebar filter/bulk/action parity tests for Conversations list
- client/src/test/agentsPage.layoutWrap.test.tsx — Agents sidebar layout coverage for list panel scroll and Load more placement
- client/src/test/agentsPage.workingFolderPicker.test.tsx — Agents working-folder picker dialog open/pick/cancel/error coverage
- client/src/test/agentsPage.citations.test.tsx — Agents transcript renders default-collapsed citations accordion under assistant bubbles
- client/src/test/agentsPage.reasoning.test.tsx — Agents transcript thought process toggle matches Chat collapse behavior
- client/src/test/agentsPage.toolsUi.test.tsx — Agents transcript renders Parameters/Result accordions for tool events
- client/src/test/agentsPage.statusChip.test.tsx — Agents transcript status chip shows Failed when turn_final status is failed
- client/src/test/chatSidebar.test.tsx — Chat sidebar bulk-selection coverage (filter reset, reorder stability, delete confirm, persistence gating) + ChatPage agent upsert ignore
- client/src/test/useChatStream.inflightMismatch.test.tsx — hook-level coverage for stale older-inflight transcript events versus active inflight ownership across Chat/Agents/Flows consumers
- client/src/test/useChatWs.test.ts — hook-level coverage for chat WebSocket connect/reconnect, per-inflight seq gating, new-inflight seq resets, and disabled realtime mode
- client/src/test/support/mockChatWs.ts — shared websocket harness for Chat/Agents/Flows page tests with inflight emit helpers used by stream-retention regressions
- client/src/test/support/mockWebSocket.ts — shared deterministic JSDOM WebSocket mock used by WS-driven client tests
- client/src/test/useConversationTurns.refresh.test.ts — unit coverage for `useConversationTurns.refresh()` replace-only snapshots + error case retains prior turns
- client/src/test/useConversationTurns.commandMetadata.test.ts — unit coverage that turns preserve optional `command` metadata for UI rendering
- client/src/test/chatPage.inflightNavigate.test.tsx — RTL coverage that navigating away/back during inflight keeps full history + inflight text
- e2e/support/mockChatWs.ts — Playwright `routeWebSocket` helper for mocking chat WS protocol in end-to-end tests

- Task 0000037-T3 file add/remove ledger:
  - Added: `server/src/config/runtimeConfig.ts` — centralized runtime TOML loader/normalizer/bootstrap resolver for base/chat/agent config.
  - Added: `server/src/test/unit/runtimeConfig.test.ts` — unit coverage for alias normalization, bootstrap copy/no-overwrite/no-base behavior, and deterministic T03 logs.
  - Removed: none.
- Task 0000037-T4 file add/remove ledger:
  - Added: none.
  - Removed: none.
  - Updated in place: `server/src/config/runtimeConfig.ts`, `server/src/agents/config.ts`, and `server/src/test/unit/runtimeConfig.test.ts` for deterministic projects merge precedence, shared validation policy, deterministic runtime-config failure semantics, and T04 log assertions.
- e2e/agents.spec.ts — e2e coverage for Agents raw outbound payload preservation, whitespace-only submit blocking, and hydrated markdown parity/fallback behavior
- e2e/chat-ws-logs.spec.ts — e2e asserting Logs UI shows client-forwarded chat WS log lines after mocked transcript events
- Task 0000036-T8 file-map update — no file paths were added/removed; existing files updated in place: `server/src/routes/ingestModels.ts`, `server/src/test/unit/ingest-models.test.ts`, `server/src/test/features/ingest-models.feature`, `server/src/test/steps/ingest-models.steps.ts`, `server/src/ingest/providers/index.ts`, and `design.md`.
- Task 0000036-T9 file-map update — added files: `server/src/ingest/providers/openaiErrorContract.ts`, `server/src/ingest/requestContracts.ts`, `server/src/test/unit/ingest-start.test.ts`, `server/src/test/integration/openai-error-parity.test.ts`, `server/src/test/integration/ingest-progress-accounting.test.ts`, `server/src/test/integration/ingest-reembed-invalid-state.test.ts`, and `server/src/test/integration/openai-model-unavailable-contract.test.ts`; removed files: `None`.
- Task 0000036-T10 file-map update — added files: `server/src/test/integration/mcp-ingested-repositories.test.ts` and `server/src/test/unit/openapi.contract.test.ts`; removed files: `None`. Existing files updated in place include `server/src/routes/ingestRoots.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`, `server/src/test/features/ingest-roots.feature`, `server/src/test/features/ingest-remove.feature`, `server/src/test/steps/ingest-manage.steps.ts`, `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/tools-ingested-repos.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`, `openapi.json`, and `design.md`.
- Task 0000036-T11 file-map update — added files: `None`; removed files: `None`. Existing files updated in place include `server/src/lmstudio/toolService.ts`, `server/src/ast/toolService.ts`, `server/src/flows/types.ts`, `server/src/flows/discovery.ts`, `server/src/flows/service.ts`, `server/src/agents/service.ts`, `server/src/chat/responders/McpResponder.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/test/integration/flows.list.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/unit/agent-commands-list.test.ts`, `server/src/test/integration/tools-ast.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, `server/src/test/unit/ast-tool-service.test.ts`, and `design.md`.
- Task 0000036-T12 file-map update — added files: `client/src/test/useIngestModels.test.tsx` and `client/src/test/useIngestRoots.test.tsx`; removed files: `None`. Existing files updated in place include `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts`, `client/src/components/ingest/IngestForm.tsx`, and `planning/0000036-openai-embeddings-provider-locking.md`.
- Task 0000036-T13 file-map update — added files: `None`; removed files: `None`. Existing files updated in place include `client/src/components/ingest/IngestForm.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/RootDetailsDrawer.tsx`, `client/src/pages/IngestPage.tsx`, `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/test/ingestForm.test.tsx`, `client/src/test/ingestStatus.test.tsx`, `client/src/test/ingestRoots.test.tsx`, `client/src/test/chatPage.toolDetails.test.tsx`, `client/src/test/agentsPage.toolsUi.test.tsx`, `e2e/ingest.spec.ts`, and `planning/0000036-openai-embeddings-provider-locking.md`.
- Story 0000036 final file-map summary — added files: `planning/0000036-openai-embeddings-provider-locking.md`, `server/src/config/startupEnv.ts`, `server/src/config/flowAndCommandRetries.ts`, `server/src/ingest/providers/types.ts`, `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`, `server/src/ingest/providers/index.ts`, `server/src/ingest/providers/openaiConstants.ts`, `server/src/ingest/providers/openaiEmbeddingProvider.ts`, `server/src/ingest/providers/openaiErrors.ts`, `server/src/ingest/providers/openaiGuardrails.ts`, `server/src/ingest/providers/openaiRetry.ts`, `server/src/ingest/providers/providerResolver.ts`, `server/src/ingest/providers/openaiErrorContract.ts`, `server/src/ingest/requestContracts.ts`, `server/src/test/unit/ingest-models.test.ts`, `server/src/test/unit/mcp-ingested-repositories.test.ts`, `server/src/test/unit/mcp-vector-search.test.ts`, `server/src/test/unit/env-loading.test.ts`, `server/src/test/unit/env-logging.test.ts`, `server/src/test/unit/flows.break-parser.test.ts`, `server/src/test/unit/flow-command-retries-config.test.ts`, `server/src/test/unit/openai-provider-errors.test.ts`, `server/src/test/unit/openai-provider-guardrails.test.ts`, `server/src/test/unit/openai-provider-retry.test.ts`, `server/src/test/unit/openai-provider.test.ts`, `server/src/test/unit/chroma-lock.test.ts`, `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/openapi.contract.test.ts`, `server/src/test/integration/ingest-lock-lifecycle.test.ts`, `server/src/test/integration/ingest-reembed.test.ts`, `server/src/test/integration/mcp-vector-search.test.ts`, `server/src/test/integration/openai-error-parity.test.ts`, `server/src/test/integration/ingest-progress-accounting.test.ts`, `server/src/test/integration/ingest-reembed-invalid-state.test.ts`, `server/src/test/integration/openai-model-unavailable-contract.test.ts`, `server/src/test/integration/mcp-ingested-repositories.test.ts`, `server/src/utils/retryContext.ts`, `server/src/utils/truncateText.ts`, `client/src/test/useIngestModels.test.tsx`, `client/src/test/useIngestRoots.test.tsx`, and `scripts/emit-0000036-t14-verification-logs.sh`; removed files: `server/src/ingest/modelLock.ts`.
- Task 0000036-T17 file-map update — added files: `server/src/ingest/providers/ingestFailureLogging.ts`, `server/src/test/unit/ingest-openai-logging.test.ts`, `server/src/test/unit/ingest-lmstudio-logging.test.ts`, and `server/src/test/integration/ingest-logging-visibility.test.ts`; updated files: `server/src/ingest/providers/openaiRetry.ts`, `server/src/ingest/providers/openaiEmbeddingProvider.ts`, `server/src/ingest/ingestJob.ts`, and `client/src/test/logsPage.test.tsx`; removed files: `None`.
- Task 0000036-T18 file-map update — added files: `server/src/config/openaiIngestRetries.ts`, `server/src/test/unit/openai-ingest-retries-config.test.ts`, and `server/src/test/integration/openai-retry-env-override.test.ts`; updated files: `server/src/ingest/providers/openaiRetry.ts`, `server/src/ingest/providers/openaiConstants.ts`, `server/src/ingest/providers/index.ts`, `server/src/test/unit/openai-provider-retry.test.ts`, and `server/.env`; removed files: `None`.
- Task 0000036-T19 file-map update — added files: `server/src/ingest/providers/ingestFailureClassifier.ts`, `server/src/test/unit/ingest-cancel.test.ts`, `server/src/test/unit/ingest-reembed.test.ts`, `server/src/test/unit/lmstudio-provider-retry-logging.test.ts`, and `server/src/test/integration/ingest-failure-logging-coverage.test.ts`; updated files: `server/src/ingest/providers/ingestFailureLogging.ts`, `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`, `server/src/ingest/providers/index.ts`, `server/src/ingest/providers/types.ts`, `server/src/ingest/chunker.ts`, `server/src/ingest/discovery.ts`, `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestCancel.ts`, `server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, `server/src/routes/ingestRoots.ts`, `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/openai-provider-retry.test.ts`, `client/src/test/logsPage.test.tsx`, `README.md`, `design.md`, and `planning/0000036-openai-embeddings-provider-locking.md`; removed files: `None`.
- Task 0000036-T20 file-map update — added files: `None`; updated files: `server/src/config/openaiIngestRetries.ts`, `server/src/routes/ingestReembed.ts`, `server/src/test/unit/openai-ingest-retries-config.test.ts`, `server/src/test/unit/openai-provider-retry.test.ts`, `server/src/test/unit/ingest-reembed.test.ts`, `server/src/test/integration/ingest-failure-logging-coverage.test.ts`, `README.md`, `design.md`, and `planning/0000036-openai-embeddings-provider-locking.md`; removed files: `None`.
- Task 0000037-T11 file-map update — added files: `server/src/utils/singleFlight.ts`; removed files: `None`. Existing files updated in place include `server/src/routes/codexDeviceAuth.ts`, `server/src/test/integration/codex.device-auth.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/agents-run-client-conversation-id.test.ts`, `design.md`, and `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.
- Task 0000037-T13 file-map update — added files: `server/src/codex/capabilityResolver.ts`; removed files: `None`. Existing files updated in place include `server/src/config/codexEnvDefaults.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chatValidators.ts`, `server/src/routes/chat.ts`, `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/chat-codex-reasoning-delta.test.ts`, `server/src/test/integration/chat-codex.test.ts`, `design.md`, and `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`.

## Story 0000037 final file-map rollup (Task 21)

- Source of truth: aggregated from `git log --grep '^DEV-0000037 -' --name-status`.
- Deterministic Task 21 documentation-sync log markers:
  - success: `[DEV-0000037][T21] event=project_structure_documentation_synced result=success`
  - error: `[DEV-0000037][T21] event=project_structure_documentation_synced result=error`

### Added files (story-wide)

- `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`
- `server/src/codex/capabilityResolver.ts`
- `server/src/config/codexSdkUpgrade.ts`
- `server/src/config/runtimeConfig.ts`
- `server/src/test/unit/codexSdkUpgrade.test.ts`
- `server/src/test/unit/design-docs.task20.test.ts`
- `server/src/test/unit/runtimeConfig.test.ts`
- `server/src/utils/singleFlight.ts`

### Removed files (story-wide)

- `None`

### Modified files (story-wide)

- `.gitignore`
- `client/src/api/codex.ts`
- `client/src/components/chat/CodexFlagsPanel.tsx`
- `client/src/components/codex/CodexDeviceAuthDialog.tsx`
- `client/src/hooks/useChatModel.ts`
- `client/src/hooks/useChatStream.ts`
- `client/src/pages/AgentsPage.tsx`
- `client/src/pages/ChatPage.tsx`
- `client/src/test/agentsPage.agentChange.test.tsx`
- `client/src/test/chatPage.codexDefaults.test.tsx`
- `client/src/test/chatPage.flags.reasoning.payload.test.tsx`
- `client/src/test/chatPage.flags.sandbox.payload.test.tsx`
- `client/src/test/chatPage.models.test.tsx`
- `client/src/test/chatPage.provider.test.tsx`
- `client/src/test/chatPage.reasoning.test.tsx`
- `client/src/test/codexDeviceAuthApi.test.ts`
- `client/src/test/codexDeviceAuthDialog.test.tsx`
- `common/src/api.ts`
- `common/src/fixtures/mockModels.ts`
- `common/src/lmstudio.ts`
- `design.md`
- `openapi.json`
- `package-lock.json`
- `planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md`
- `projectStructure.md`
- `server/package.json`
- `server/src/agents/authSeed.ts`
- `server/src/agents/config.ts`
- `server/src/agents/service.ts`
- `server/src/chat/factory.ts`
- `server/src/chat/reingestToolResult.ts`
- `server/src/chat/interfaces/ChatInterfaceCodex.ts`
- `server/src/config/codexConfig.ts`
- `server/src/config/codexEnvDefaults.ts`
- `server/src/config/runtimeConfig.ts`
- `server/src/flows/service.ts`
- `server/src/index.ts`
- `server/src/providers/codexDetection.ts`
- `server/src/routes/chat.ts`
- `server/src/routes/chatModels.ts`
- `server/src/routes/chatValidators.ts`
- `server/src/routes/codexDeviceAuth.ts`
- `server/src/test/integration/agents-run-client-conversation-id.test.ts`
- `server/src/test/integration/chat-codex-mcp.test.ts`
- `server/src/test/integration/chat-codex.test.ts`
- `server/src/test/integration/codex.device-auth.test.ts`
- `server/src/test/integration/codexAuthCopy.integration.test.ts`
- `server/src/test/integration/flows.run.basic.test.ts`
- `server/src/test/steps/chat-tools-visibility.steps.ts`
- `server/src/test/steps/chat_cancellation.steps.ts`
- `server/src/test/steps/chat_stream.steps.ts`
- `server/src/test/unit/agents-authSeed.test.ts`
- `server/src/test/unit/reingest-tool-result.test.ts`
- `server/src/test/unit/agents-config-defaults.test.ts`
- `server/src/test/unit/chat-codex-reasoning-delta.test.ts`
- `server/src/test/unit/chatModels.codex.test.ts`
- `server/src/test/unit/chatValidators.test.ts`
- `server/src/test/unit/codexConfig.device-auth.test.ts`
- `server/src/test/unit/codexConfig.test.ts`
- `server/src/test/unit/codexDeviceAuth.test.ts`
- `server/src/test/unit/openapi.contract.test.ts`
- `server/src/test/unit/runtimeConfig.test.ts`

## Story 0000037 compatibility aliases (input accepted, canonical output only)

Before (legacy aliases accepted as input):

```toml
[features]
view_image_tool = true
web_search_request = true
```

After (canonical runtime/output shape only):

```toml
[tools]
view_image = true
web_search = "live"
```

- Read-time compatibility behavior:
  - `features.view_image_tool` -> `tools.view_image`
  - `features.web_search_request` and top-level `web_search_request` -> top-level `web_search`
- Canonical key precedence:
  - if canonical and alias keys both exist, canonical value wins
- Emission/storage rule:
  - aliases are accepted for compatibility input only and are not emitted as canonical output

## Story 0000037 Task 23 codex_agents parity corrections

- Restored to match `main` (file-set parity fix):
  - `codex_agents/planning_agent/commands/kadshow_improve_plan.json`
  - `codex_agents/tasking_agent/commands/kadshow_task_up.json`
- Task 23 verification target:
  - `git diff --name-status main...HEAD -- codex_agents` must contain no `D`/`R` entries after the parity-fix commit.

## Story 0000039 Task 5 structural change ledger

- Modified files:
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/test/agentsPage.commandsList.test.tsx`
  - `design.md`
  - `planning/0000039-agents-command-info-and-working-folder-prompts.md`

## Story 0000039 Task 6 structural change ledger

- Added files:
  - `client/src/test/agentsPage.promptsDiscovery.test.tsx`
- Modified files:
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
  - `design.md`
  - `planning/0000039-agents-command-info-and-working-folder-prompts.md`

## Story 0000039 Task 7 structural change ledger

- Added files:
  - `None`
- Modified files:
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/test/agentsPage.promptsDiscovery.test.tsx`
  - `design.md`
  - `projectStructure.md`
  - `planning/0000039-agents-command-info-and-working-folder-prompts.md`

## Story 0000039 Task 8 structural change ledger

- Added files:
  - `client/src/test/agentsPage.executePrompt.test.tsx`
- Modified files:
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/test/agentsPage.commandsList.test.tsx`
  - `client/src/test/agentsPage.run.test.tsx`
  - `design.md`
  - `projectStructure.md`
  - `planning/0000039-agents-command-info-and-working-folder-prompts.md`

## Story 0000039 Tasks 1-8 cumulative file map (final cross-check)

- Required added files confirmed:
  - `server/src/test/unit/openapi.prompts-route.test.ts`
  - `server/src/test/unit/agent-prompts-list.test.ts`
  - `client/src/test/agentsApi.promptsList.test.ts`
  - `client/src/test/agentsPage.promptsDiscovery.test.tsx`
  - `client/src/test/agentsPage.executePrompt.test.tsx`
- Core implementation files touched across Tasks 1-8:
  - `server/src/routes/agentsCommands.ts`
  - `server/src/agents/service.ts`
  - `client/src/api/agents.ts`
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/test/agentsPage.workingFolderPicker.test.tsx`
  - `client/src/test/agentsPage.descriptionPopover.test.tsx`
  - `client/src/test/agentsPage.run.test.tsx`
  - `client/src/test/agentsPage.commandsList.test.tsx`
  - `client/src/test/agentsPage.run.instructionError.test.tsx`
  - `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
  - `client/src/test/agentsPage.streaming.test.tsx`
  - `openapi.json`
  - `design.md`
  - `README.md`
  - `planning/0000039-agents-command-info-and-working-folder-prompts.md`
- Prompt-discovery fixtures from Task 2:
  - No new persistent fixture files were introduced by Task 2 (behavior coverage implemented via service/unit tests and runtime path handling).

## Story 0000041 Task 1 structural change ledger

Added files:

- `certs/empty-corp-ca/.gitkeep`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `projectStructure.md`

Task notes:

- Complete Task 1 add/remove list: added `certs/empty-corp-ca/.gitkeep`, removed `none`.
- There are no other add/remove subtasks in Task 1.

## Story 0000041 Task 2 structural change ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `.env.e2e`
- `projectStructure.md`

Task notes:

- Tracked-file outcome for Task 2 structure step: added files `none`, removed files `none`.
- Local helper input `server/.env.local` is untracked and excluded from tracked structure changes.

## Story 0000041 Task 10 structural verification ledger

Added files:

- `certs/empty-corp-ca/.gitkeep` — tracked placeholder for deterministic compose fallback mount source when `CODEINFO_CORP_CERTS_DIR` is unset.

Removed files:

- None.

Renamed files:

- None.

Modified files (story-wide traceability):

- `.env.e2e` — e2e interpolation defaults/placeholders for canonical `CODEINFO_*` corporate override variables.
- `README.md` — restricted-network setup section with canonical variable semantics, workflow split, and refresh/fail-fast guidance.
- `client/Dockerfile` — conditional npm registry override wiring in client build stage.
- `client/entrypoint.sh` — client build override observability token emission (`T04`).
- `design.md` — implementation flow/prose/diagrams for compose wiring and runtime refresh behavior.
- `docker-compose.yml` — canonical compose wiring for server/client build args, runtime env, and cert mount fallback.
- `docker-compose.local.yml` — local compose variant wiring for build args/runtime env/cert mount fallback.
- `docker-compose.e2e.yml` — e2e compose variant wiring for build args/runtime env/cert mount fallback.
- `scripts/docker-compose-with-env.sh` — wrapper env-source observability emission for workflow interpolation provenance.
- `server/Dockerfile` — conditional npm/pip override wiring across dependency-install stages.
- `server/entrypoint.sh` — runtime CA defaults/refresh gate/fail-fast flow and Task 1..10 observability tokens.
- `start-gcf-server.sh` — optional npm registry override for host helper global install path.
- `projectStructure.md` — structure and story ledgers synchronized with story file changes.
- `planning/0000041-corporate-registry-and-certificate-overrides-via-codeinfo-env.md` — task-by-task implementation and verification evidence.

Task notes:

- Task 10 closeout check confirmed every story-touched tracked file from `git diff --name-only 3401898d..HEAD` has a matching purpose entry in this document.

## Story 0000043 Task 10 structural verification ledger

Added files:

- None (tracked source tree).

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/pages/ChatPage.tsx` — Chat page stop dispatch now uses server-visible inflight identity, renders `stopping` and `stopped`, and emits the Task 10 browser debug markers.
- `client/src/test/chatPage.stop.test.tsx` — Chat stop page coverage now exercises stopping UX, no-op recovery, startup-race conversation-only cancel, stopped finalization, stopped hydration, and conversation-switch recovery.
- `client/src/test/chatPage.stream.test.tsx` — older stopped-final transcript expectation updated to the final visible `Stopped` chip contract.
- `client/src/test/chatPage.newConversation.test.tsx` — new-conversation cancellation coverage now accepts the documented conversation-only cancel path when no server-visible inflight id exists yet.
- `client/src/test/support/mockChatWs.ts` — shared websocket harness allows delayed `/chat` start responses for startup-race stop coverage.
- `design.md` — Story 43 Task 10 Chat stop UX flow and browser-visible marker expectations documented.
- `planning/0000043-stop-any-point-cancellation.md` — Task 10 implementation and verification status updated in sequence.
- `projectStructure.md` — screenshot artifact index and Task 10 structural ledger synchronized with the Chat stop UX work.

Task notes:

- Task 10 updates existing Chat page, test, and story documentation files in place and refreshes the ignored `playwright-output-local/` artifact index with the reviewed Chat stop screenshot.

## Story 0000043 Task 11 structural verification ledger

Added files:

- None (tracked source tree).

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/pages/AgentsPage.tsx` — Agents stop UX now follows the shared stop contract for both instruction and command runs, preserves visible `Stopped` transcript state, and emits the Task 11 browser debug markers.
- `client/src/pages/ChatPage.tsx` — minor type narrowing cleanup landed during client validation without changing the Chat stop contract.
- `client/src/test/agentsPage.commandsRun.abort.test.tsx` — command-run stop coverage now validates startup-race conversation-only cancel, visible stopping, visible stopped, and same-conversation reuse.
- `client/src/test/agentsPage.statusChip.test.tsx` — persisted stopped transcript mapping now stays visibly `Stopped` after reload and reconciliation.
- `design.md` — final Agents stop UX contract and browser-visible marker expectations documented.
- `planning/0000043-stop-any-point-cancellation.md` — Task 11 implementation and verification evidence recorded in sequence.

Task notes:

- Task 11 updated existing Agents page and test files in place and added repo-local screenshot artifacts for both instruction and command stop verification.

## Story 0000043 Task 12 structural verification ledger

Added files:

- None (tracked source tree).

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/pages/FlowsPage.tsx` — Flows stop UX now uses server-visible inflight targeting, preserves hidden active conversations during stop reconciliation, and renders visible `Stopped` transcript state.
- `client/src/test/flowsPage.stop.test.tsx` — Flow stop coverage now exercises startup-race conversation-only cancel, no-op recovery, stopped hydration, remount recovery, and same-conversation reuse.
- `design.md` — final Flows stop UX contract and browser-visible marker expectations documented.
- `planning/0000043-stop-any-point-cancellation.md` — Task 12 implementation and verification evidence recorded in sequence.

Task notes:

- Task 12 updates existing Flows page and test files in place and refreshes the repo-local screenshot artifact index with the reviewed Flow stop screenshot.

## Story 0000043 Task 13 structural verification ledger

Added files:

- `test-results/pr-comments/0000043-summary.md`

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `README.md` — top-level product docs now describe the shipped shared stop contract, including startup-race conversation-only stop, `cancel_ack.result === 'noop'`, and real-stop confirmation via `turn_final.status === 'stopped'`.
- `design.md` — Story 0000043 stop lifecycle documentation consolidated with the missing Chat and Agents page sections plus one final end-to-end summary diagram.
- `projectStructure.md` — Story 0000043 screenshot index, late-task ledgers, and PR-summary artifact map synchronized with the final documentation state.
- `planning/0000043-stop-any-point-cancellation.md` — Task 13 progress, implementation notes, and testing evidence recorded in sequence.

Task notes:

- Task 13 adds the story PR summary artifact under `test-results/pr-comments/` and keeps the rest of the documentation updates in place within the existing repo docs.

## Story 0000043 Task 14 structural verification ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/pages/AgentsPage.tsx` — command-run stop reconciliation now treats a live stopped marker as terminal for the page controls so the same conversation can be started again immediately after a confirmed stopped command run.
- `e2e/chat-multiwindow.spec.ts` — final acceptance coverage now includes a stale-stop multi-window regression proving a replacement run in another context is not cancelled by the older stop target.
- `projectStructure.md` — Task 14 screenshot index and final acceptance ledger synchronized with the multi-surface manual evidence.
- `planning/0000043-stop-any-point-cancellation.md` — Task 14 acceptance status, implementation notes, and final wrapper/manual evidence recorded in sequence.

Task notes:

- Task 14 adds no tracked files, but it refreshes the final acceptance evidence by saving and reviewing the Story 0000043 Task 14 screenshots under `playwright-output-local/` and tightening the final Agents command-stop reuse behavior to match the acceptance contract.

## Story 0000042 Task 8 structural verification ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `README.md` — top-level Flow feature note now states the live transcript bug fix at a user-visible level.
- `design.md` — documents the final shared stream-ownership rules, non-destructive late-final behavior, Flow transcript retention rule, and Story 42 manual verification log matrix.
- `projectStructure.md` — synchronized client hook/page/test descriptions with the final Story 42 regression surface.
- `planning/0000042-flow-streaming-transcript-bubble-text-loss.md` — task-by-task implementation and verification evidence for the streaming transcript retention fix.

Task notes:

- Story 0000042 added no new tracked files through Tasks 1-7; Task 8 updates the structure map to reflect the final behavior of existing hooks, pages, and regression files instead of recording path additions or renames.

## Story 0000042 Task 14 structural verification ledger

Added files:

- None.

Removed files:

- None.

Renamed files:

- None.

Modified files (implementation traceability):

- `client/src/components/Markdown.tsx` — shared markdown renderer now follows the current `react-markdown` and `rehype-sanitize` typing model while preserving mermaid fences and external-link behavior.
- `client/src/components/chat/CodexFlagsPanel.tsx` — Codex flag switches now use typed helper wrappers for MUI input slot test ids.
- `client/src/components/chat/ConversationList.tsx` — shared sidebar list now uses typed checkbox input helpers and removes always-true optional-handler guards.
- `client/src/components/codex/CodexDeviceAuthDialog.tsx` — shared device-auth dialog now matches the current API call signature.
- `client/src/components/ingest/DirectoryPickerDialog.tsx` — ingest directory picker now narrows the success/error response union before storing payload state.
- `client/src/hooks/useChatStream.ts` — assistant-bubble creation now stabilizes the generated assistant id before it is reused across inflight maps and message state.
- `client/src/hooks/useConversationTurns.ts` — hydrated REST inflight snapshots are explicitly typed before overlay decisions are logged/applied.
- `client/src/hooks/useConversations.ts` — bulk-action error handling now narrows the response union safely and preserves fallback error codes/messages.
- `client/src/hooks/useIngestStatus.ts` — ingest snapshot logging now emits an object payload even when realtime status is absent.
- `client/src/pages/AgentsPage.tsx` — runtime page typing now guards inflight cancellation, narrows tool payload/error rendering, and keeps shared sidebar wiring explicit.
- `client/src/pages/ChatPage.tsx` — runtime page typing now uses explicit reducer generics, typed MUI select-display helpers, safer payload/error booleans, and slot-prop based input metadata.
- `client/src/pages/IngestPage.tsx` — ingest page now normalizes embedding-provider values before passing locked-model props into shared ingest components.
- `planning/0000042-flow-streaming-transcript-bubble-text-loss.md` — Task 14 implementation and validation trail updated in place as each runtime subtask and testing step completed.

Task notes:

- Task 14 changed existing runtime files only; the documentation update is limited to structure/traceability because no user-visible flow behavior or design contract changed beyond the runtime typing cleanup itself.
