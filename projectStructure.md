# Project Structure (full tree)

Tree covers all tracked files (excluding `.git`, `node_modules`, `dist`, `test-results`). Keep this in sync whenever files are added/removed/renamed; each line has a brief comment.

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
â”œâ”€ README.md â€” repo overview and commands
â”œâ”€ logs/ â€” runtime server log output (gitignored, host-mounted)
â”œâ”€ design.md â€” design notes and diagrams
â”œâ”€ observability/ â€” shared OpenTelemetry collector config for Chroma traces
â”‚  â””â”€ otel-collector-config.yaml â€” OTLP->Zipkin/logging pipeline used by all compose stacks
â”œâ”€ docker-compose.yml â€” compose stack for client/server
â”œâ”€ docker-compose.e2e.yml — isolated e2e stack (client 6001, server 6010, chroma 8800, fixtures mount)
â”œâ”€ eslint.config.js â€” root ESLint flat config
â”œâ”€ package-lock.json â€” workspace lockfile
â”œâ”€ package.json â€” root package/workspaces/scripts
â”œâ”€ tsconfig.base.json â€” shared TS config
â”œâ”€ tsconfig.json â€” project references entry
â”œâ”€ client/ â€” React 19 Vite app
â”‚  â”œâ”€ .dockerignore â€” client docker build ignores
â”‚  â”œâ”€ .env â€” client default env (VITE_API_URL, VITE_LMSTUDIO_URL)
â”‚  â”œâ”€ .env.local â€” client local overrides (ignored by git consumers)
â”‚  â”œâ”€ .gitignore â€” client-specific ignores
â”‚  â”œâ”€ Dockerfile â€” client image build
â”‚  â”œâ”€ entrypoint.sh â€” client runtime config writer + preview runner
â”‚  â”œâ”€ README.md â€” client-specific notes
â”‚  â”œâ”€ eslint.config.js â€” client ESLint entry
â”‚  â”œâ”€ index.html â€” Vite HTML shell
â”‚  â”œâ”€ jest.config.ts â€” Jest config
â”‚  â”œâ”€ package.json â€” client workspace manifest
â”‚  â”œâ”€ tsconfig.app.json â€” TS config for app build
â”‚  â”œâ”€ tsconfig.json â€” TS references
â”‚  â”œâ”€ tsconfig.node.json â€” TS config for tools
â”‚  â”œâ”€ vite.config.ts â€” Vite config
â”‚  â”œâ”€ public/
â”‚  â”‚  â”œâ”€ config.js â€” runtime client config (API base/port)
â”‚  â”‚  â””â”€ vite.svg â€” Vite logo asset
â”‚  â””â”€ src/
â”‚     â”œâ”€ App.tsx â€” app shell with CssBaseline/NavBar/Container
â”‚     â”œâ”€ assets/react.svg â€” React logo asset
â”‚     â”œâ”€ components/
â”‚     â”‚  â”œâ”€ NavBar.tsx â€” top navigation AppBar/Tabs
|     |  |  |- chat/
|     |  |  |  â”œâ”€ CodexFlagsPanel.tsx â€” Codex-only flags accordion with sandbox select
|     |  |  |  â””â”€ ConversationList.tsx â€” conversation sidebar with infinite scroll + archive/restore
|     |  |- Markdown.tsx ? sanitized GFM renderer for assistant/think text with code block styling
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
|     |  |- useChatWs.ts — WebSocket client hook (connect/reconnect, subscribe/unsubscribe, JSON codec, client log forwarding)
|     |  |- useChatStream.ts — chat run hook (POST /chat start-run 202 + merges WS transcript events into ChatMessage state)
|     |  |- useLmStudioStatus.ts ? LM Studio status/models data hook
|     |  |- useConversations.ts ? conversation list infinite scroll + archive/restore helpers
|     |  |- useConversationTurns.ts ? lazy turn loading with load-older cursor handling
|     |  |- usePersistenceStatus.ts ? fetches /health for mongoConnected banner flag
|     |  |- useIngestStatus.ts ? polls /ingest/status/:runId and supports cancelling
|     |  |- useIngestRoots.ts ? fetches /ingest/roots with lock info and refetch helper
|     |  |- useIngestModels.ts ? fetches /ingest/models with lock + default selection
|     |  - useLogs.ts ? log history + SSE hook with filters
|     |- utils/
|     |  - isDevEnv.ts ? shared dev/test environment detection helper
|     |- api/
|     |  - agents.ts ? client wrapper for GET /agents and POST /agents/:agentName/run (AbortSignal supported)
|     |  - baseUrl.ts ? runtime API base resolver (config/env/location)
|     |- index.css ? minimal global styles (font smoothing, margin reset)
|     |- main.tsx ? app entry with RouterProvider
|     |- pages/
|     |  |- ChatPage.tsx ? chat shell with model select, streaming transcript, rounded 14px bubbles, tool blocks, citations accordion (closed by default), and stream status/thinking UI (1s idle guard, ignores tool-only waits)
|     |  |- AgentsPage.tsx ? agents UI with selector/stop/new-conversation controls, description markdown, and persisted conversation continuation
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
|     |     |- chatPage.stream.test.tsx ? chat streaming hook + UI coverage (status chip/thinking gating incl. pre-token + mid-turn idle waits)
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
|     |     |- chatPage.markdown.test.tsx ? assistant markdown rendering for lists and code fences
|     |     |- chatPage.mermaid.test.tsx ? mermaid code fence rendering and script stripping
|     |     |- agentsPage.list.test.tsx ? Agents page loads agent list and populates dropdown
|     |     |- agentsPage.description.test.tsx ? Agents page renders selected agent description markdown
|     |     |- agentsPage.agentChange.test.tsx ? switching agent aborts run and resets conversation state
|     |     |- agentsPage.conversationSelection.test.tsx ? selecting a conversation continues via conversationId
|     |     |- agentsPage.turnHydration.test.tsx ? selecting a conversation hydrates and renders stored turns
|     |     |- agentsPage.run.test.tsx ? agent run (realtime) renders transcript from WS and ignores REST segments
|     |     |- agentsPage.run.instructionError.test.tsx ? Agents page shows error banner when instruction start fails
|     |     |- agentsPage.run.commandError.test.tsx ? Agents page shows error banner when command start fails
|     |     |- agentsPage.navigateAway.keepsRun.test.tsx ? navigating away does not cancel run; transcript resumes via WS
|     |     |- agentsPage.persistenceFallbackSegments.test.tsx ? Agents page shows realtime banner + disables Send when WS is unavailable
|     |     |- agentsPage.commandsList.test.tsx ? Agents page command dropdown refresh, disabled entries, labels, and description display
|     |     |- agentsPage.commandsRun.refreshTurns.test.tsx ? Agents page command execute triggers run, then refreshes conversations and hydrates turns
|     |     |- agentsPage.commandsRun.conflict.test.tsx ? Agents page surfaces RUN_IN_PROGRESS conflicts for command execute and normal send
|     |     |- agentsPage.commandsRun.persistenceDisabled.test.tsx ? Agents page disables command execute when mongoConnected is false
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
|     |     |- setupTests.ts ? Jest/test setup
|     |     |- useChatStream.reasoning.test.tsx ? chat hook reasoning parser coverage
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
â”‚  â”œâ”€ chat.spec.ts - chat page end-to-end (model select + two-turn stream; skips if models unavailable)
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
â”‚  â”œâ”€ 0000020-ingest-delta-reembed-and-ingest-page-ux.md â€” plan for story 0000020
â”‚  â””â”€ plan_format.md â€” planning template/instructions
â”œâ”€ server/ â€” Express API
â”‚  â”œâ”€ .dockerignore â€” server docker build ignores
â”‚  â”œâ”€ .env â€” server default env (PORT, LMSTUDIO_BASE_URL)
â”‚  â”œâ”€ .env.local â€” server local overrides (ignored by git consumers)
â”‚  â”œâ”€ .prettierignore â€” server-specific Prettier ignore
â”‚  â”œâ”€ Dockerfile â€” server image build
â”‚  â”œâ”€ cucumber.js â€” Cucumber config
â”‚  â”œâ”€ package.json â€” server workspace manifest
â”‚  â”œâ”€ tsconfig.json â€” TS config for server
â”‚  â”œâ”€ tsconfig.tsbuildinfo â€” TS build info cache
â”‚  â””â”€ src/
â”‚     â”œâ”€ index.ts â€” Express app entry
â”‚     â”œâ”€ logger.ts â€” pino/pino-http setup with rotation and env config helper
â”‚     â”œâ”€ logStore.ts â€” in-memory log buffer with sequence numbers and filters
â”‚     â”œâ”€ config/
â”‚     â”‚  â”œâ”€ codexConfig.ts â€” Codex home/env config builder
â”‚     â”‚  â””â”€ codexEnvDefaults.ts â€” Codex env defaults parser + warnings helper
â”‚     â”œâ”€ chatStream.ts — SSE helper for streaming endpoints (e.g., `/logs/stream`); chat runs stream over `/ws`
â”‚     â”œâ”€ chat/
â”‚     â”‚  â”œâ”€ factory.ts — provider map returning ChatInterface instances or throws UnsupportedProviderError
â”‚     â”‚  â”œâ”€ memoryPersistence.ts — shared in-memory conversation/turn store for Mongo-down/test fallback
â”‚     â”‚  â”œâ”€ interfaces/ChatInterface.ts — base chat abstraction with normalized events and persistence helpers
â”‚     â”‚  â”œâ”€ interfaces/ChatInterfaceCodex.ts — Codex provider implementation emitting normalized chat events
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
â”‚     â”‚  â”œâ”€ toolsIngestedRepos.ts â€” GET /tools/ingested-repos repo list for agent tools
â”‚     â”‚  â”œâ”€ toolsVectorSearch.ts â€” POST /tools/vector-search chunk search with optional repo filter
â”‚     â”‚  â””â”€ lmstudio.ts â€” LM Studio proxy route
â”‚     â”œâ”€ mongo/
â”‚     â”‚  â”œâ”€ connection.ts — Mongoose connect/disconnect helpers with strictQuery + logging
â”‚     â”‚  â”œâ”€ conversation.ts — conversation schema/model (provider, agentName?, flags, lastMessageAt, archivedAt)
â”‚     â”‚  â”œâ”€ turn.ts — turn schema/model (role/content/provider/model/toolCalls/status)
â”‚     â”‚  â”œâ”€ ingestFile.ts — per-file hash index schema/model for delta ingest decisions
â”‚     â”‚  â””â”€ repo.ts — persistence helpers for create/update/archive/restore/list + turn append
â”‚     â”œâ”€ mcp/ — Express MCP v1 endpoint (POST /mcp) exposing ingest tools to agent clients
â”‚     â”‚  â””â”€ server.ts — Express MCP v1 router (initialize/tools/resources); uses mcpCommon helpers while preserving wire formats, tool schemas, and domain error mapping
â”‚     â”œâ”€ mcpCommon/ — shared MCP/JSON-RPC infrastructure used by both MCP servers (helpers/dispatch only; must not change wire formats)
â”‚     â”‚  â”œâ”€ guards.ts — tiny shared type guards for MCP request validation
â”‚     â”‚  â”œâ”€ jsonRpc.ts — shared JSON-RPC response helpers (result/error envelopes)
â”‚     â”‚  â””â”€ dispatch.ts — shared method dispatch skeleton (routes to handler callbacks, returns verbatim payloads)
â”‚     â”œâ”€ mcp2/ — Codex-gated MCP v2 server on port 5011
â”‚     â”‚  â”œâ”€ server.ts — start/stop JSON-RPC server
â”‚     â”‚  â”œâ”€ router.ts — JSON-RPC handlers (initialize/tools/resources); uses mcpCommon dispatch/guards while keeping body parsing, parse errors, response writing, and Codex gating local
â”‚     â”‚  â”œâ”€ types.ts — JSON-RPC envelope helpers
â”‚     â”‚  â”œâ”€ errors.ts — shared MCP error helpers
â”‚     â”‚  â”œâ”€ codexAvailability.ts — detects Codex readiness for tools/list/call gating
â”‚     â”‚  â”œâ”€ tools.ts — MCP tool registry wiring
â”‚     â”‚  â””â”€ tools/codebaseQuestion.ts — `codebase_question` tool bridging chat (Codex default, LM Studio optional) + vector search
â”‚     â”œâ”€ mcpAgents/ — Agents MCP v2 server on port 5012
â”‚     â”‚  â”œâ”€ server.ts — start/stop Agents JSON-RPC server
â”‚     â”‚  â”œâ”€ router.ts — JSON-RPC handlers (initialize/tools/resources); tools/list ungated; tools/call gated for run_agent_instruction
â”‚     â”‚  â”œâ”€ types.ts — JSON-RPC envelope helpers
â”‚     â”‚  â”œâ”€ errors.ts — Agents MCP domain errors (Codex unavailable)
â”‚     â”‚  â”œâ”€ codexAvailability.ts — Codex CLI availability check for tool call gating
â”‚     â”‚  â””â”€ tools.ts — Agents tool registry wiring
â”‚     â”œâ”€ flows/
â”‚     â”‚  â””â”€ flowSchema.ts — strict Zod schema for flow JSON validation
â”‚     â”‚  â””â”€ discovery.ts — flow discovery and summary listing (hot reload)
â”‚     â”œâ”€ test/unit/chat-assistant-suppress.test.ts â€” unit coverage for assistant-role tool payload suppression helpers
â”‚     â”œâ”€ test/unit/codexEnvDefaults.test.ts â€” unit coverage for Codex env defaults parsing/warnings
â”‚     â”œâ”€ ingest/ â€” ingest helpers (discovery, chunking, hashing, config)
â”‚     â”‚  â”œâ”€ __fixtures__/sample.ts â€” sample text blocks for chunking tests
â”‚     â”‚  â”œâ”€ modelLock.ts — placeholder for ingest model lock retrieval
â”‚     â”‚  â”œâ”€ lock.ts — single-flight ingest lock with TTL
â”‚     â”‚  â”œâ”€ chunker.ts â€” boundary-aware chunking with token limits
â”‚     â”‚  â”œâ”€ config.ts â€” ingest config resolver for include/exclude and token safety
â”‚     â”‚  â”œâ”€ discovery.ts â€” git-aware file discovery with exclude/include and text check
â”‚     â”‚  â”œâ”€ hashing.ts â€” sha256 hashing for files/chunks
â”‚     â”‚  â”œâ”€ deltaPlan.ts â€” pure delta planner for added/changed/deleted files (no IO)
â”‚     â”‚  â”œâ”€ pathMap.ts — maps container ingest paths to host paths for tooling responses
â”‚     â”‚  â”œâ”€ index.ts â€” barrel export for ingest helpers
â”‚     â”‚  â””â”€ types.ts â€” ingest types (DiscoveredFile, Chunk, IngestConfig)
â”‚     â”œâ”€ lmstudio/
â”‚     â”‚  â”œâ”€ clientPool.ts â€” pooled LM Studio clients with closeAll/reset helpers
â”‚     â”‚  â”œâ”€ toolService.ts â€” shared helpers for LM Studio tools + tooling routes (list/search)
â”‚     â”‚  â””â”€ tools.ts â€” LM Studio tool schemas for list/vector search used by chat
â”‚     â”œâ”€ types/
â”‚     â”‚  â””â”€ pino-roll.d.ts â€” module shim for pino-roll until official types
â”‚     â””â”€ test/
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
â”‚           â”œâ”€ turn-command-metadata.test.ts — Turn persistence plumbs optional command metadata through append/list helpers
â”‚           â”œâ”€ toolService.synthetic.test.ts — unit coverage for onToolResult callback emission
â”‚           â”œâ”€ chroma-embedding-selection.test.ts â€” locked-model embedding function selection + error paths
â”‚           â”œâ”€ ingest-status.test.ts â€” ingest status progress fields round-trip helper coverage
â”‚           â”œâ”€ ingest-files-schema.test.ts â€” unit coverage for `ingest_files` Mongoose schema fields + indexes
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
â”‚           â”œâ”€ mcp-unsupported-provider.test.ts — MCP tools/call unsupported provider error path
â”‚           â””â”€ tools-vector-search.test.ts â€” supertest coverage for /tools/vector-search
â”‚        â”œâ”€ integration/
â”‚        |  â””â”€ flows.list.test.ts â€” integration coverage for GET /flows listing
â”‚        |  â”œâ”€ chat-tools-wire.test.ts â€” chat route wiring (POST /chat 202 + WS bridge) with mocked LM Studio tools
â”‚        |  â”œâ”€ chat-vectorsearch-locked-model.test.ts â€” chat run error/success flows when vector search lock/embedding availability changes
â”‚        |  â”œâ”€ chat-codex.test.ts — Codex chat run flow, thread reuse, and availability gating
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
- server/src/agents/types.ts — agent DTOs for discovery/service (REST-safe + internal paths)
- server/src/agents/discovery.ts — discovers agents from `CODEINFO_CODEX_AGENT_HOME`
- server/src/agents/authSeed.ts — best-effort copy of primary `auth.json` into agent homes (never overwrite, lock-protected)
- server/src/agents/commandsSchema.ts — strict Zod v1 schema + safe parser for agent command JSON files
- server/src/agents/commandsLoader.ts — reads command files and returns safe `{ name, description, disabled }` summaries
- server/src/agents/commandsRunner.ts — executes parsed agent commands sequentially with abort checks + conversation lock
- server/src/agents/retry.ts — AbortSignal-aware retry/backoff helper used by the command runner
- server/src/agents/transientReconnect.ts — transient reconnect classifier ("Reconnecting... n/m") + safe error message helper
- server/src/agents/runLock.ts — in-memory per-conversation run lock for agent/command execution
- server/src/agents/config.ts — minimal agent `config.toml` parsing helpers (e.g. top-level `model`)
- server/src/agents/service.ts — shared agents service used by REST + Agents MCP (list agents + run agent instruction)
- server/src/routes/agents.ts — `GET /agents` agent listing endpoint (REST source of truth)
- server/src/routes/agentsRun.ts — `POST /agents/:agentName/run` agent execution endpoint (REST; delegates to shared service)
- server/src/routes/agentsCommands.ts — agent command endpoints: `GET /agents/:agentName/commands` (list) + `POST /agents/:agentName/commands/run` (execute)
- server/src/test/unit/agents-discovery.test.ts — unit coverage for agent discovery rules (config/description/system prompt)
- server/src/test/unit/agents-authSeed.test.ts — unit coverage for agent auth seeding (copy/no-overwrite/concurrency)
- server/src/test/unit/agents-router-list.test.ts — Supertest coverage for `GET /agents` response shape and description handling
- server/src/test/unit/agents-router-run.test.ts — Supertest coverage for `POST /agents/:agentName/run` validation/error mapping/shape
- server/src/test/unit/agents-commands-router-list.test.ts — Supertest coverage for `GET /agents/:agentName/commands` response shape and 404 mapping
- server/src/test/unit/agents-commands-router-run.test.ts — Supertest coverage for `POST /agents/:agentName/commands/run` validation/error mapping/abort wiring
- server/src/test/unit/agents-working-folder.test.ts — unit coverage for resolving agent working folder into a Codex workingDirectory override
- server/src/test/unit/agent-commands-schema.test.ts — unit coverage for v1 agent command JSON schema parsing/strictness/trimming
- server/src/test/unit/agent-commands-loader.test.ts — unit coverage for loading command summaries from disk (valid/invalid/missing)
- server/src/test/unit/agent-commands-list.test.ts — unit coverage for listing agent commands from `commands/` (missing folder, filtering, sorting, no-cache)
- server/src/test/unit/agent-commands-runner.test.ts — unit coverage for command execution runner (sequential steps, abort stop, lock behavior)
- server/src/test/unit/agent-commands-runner-retry.test.ts — unit coverage for transient reconnect retry behavior in the command runner
- server/src/test/unit/agent-commands-runner-abort-retry.test.ts — unit coverage that retries stop immediately when aborted
- server/src/test/unit/mcp-responder-transient-error.test.ts — unit coverage that McpResponder ignores transient reconnect error events
- server/src/test/unit/chat-command-metadata.test.ts — unit coverage that chat persistence attaches `command` metadata to turns created by command runs
- server/src/test/unit/chatModels.codex.test.ts — unit coverage for `/chat/models` Codex defaults, warnings, and env model lists
- server/src/test/unit/chatValidators.test.ts — unit coverage for Codex env defaults + warnings in chat validation
- server/src/test/unit/chat-codex-workingDirectoryOverride.test.ts — ensures ChatInterfaceCodex honors per-call workingDirectory overrides
- server/src/test/unit/conversations-router-agent-filter.test.ts — Supertest coverage for `/conversations?agentName=...` request forwarding
- server/src/test/integration/conversations.bulk.test.ts — Supertest coverage for bulk conversation endpoints (archive/restore/delete + validation/conflicts)
- server/src/test/integration/conversations.flowname.test.ts — Supertest coverage for flowName field in conversation listings
- server/src/mongo/events.ts — in-process conversation upsert/delete event bus (used for WS sidebar fan-out)
- server/src/ws/types.ts — WebSocket v1 protocol envelope/types + inbound message parser
- server/src/ws/registry.ts — in-memory subscription registry (sidebar + per-conversation)
- server/src/ws/sidebar.ts — sidebar broadcaster (repo events → WS `conversation_upsert`/`conversation_delete`)
- server/src/ws/server.ts — `/ws` upgrade handler + ping/pong heartbeat + message dispatch
- server/src/chat/inflightRegistry.ts — in-memory active-run registry (assistantText/think/toolEvents/seq + AbortController) for WS transcript catch-up/cancellation
- server/src/chat/chatStreamBridge.ts — shared bridge wiring ChatInterface events to inflight updates + WS transcript publishing
- server/src/test/unit/ws-server.test.ts — unit coverage for `/ws` connection and protocol gating
- server/src/test/support/wsClient.ts — shared WebSocket test helper (connect/sendJson/waitForEvent/close) used by Cucumber + node:test
- server/src/test/unit/ws-chat-stream.test.ts — unit coverage for WS transcript sequencing, catch-up snapshots, cancellation errors, unsubscribe behavior, and inflight cleanup
- server/src/test/integration/mcp-codebase-question-ws-stream.test.ts — integration coverage proving MCP `codebase_question` runs publish WS transcript updates
- server/src/test/integration/agents-run-ws-stream.test.ts — integration coverage proving agent runs publish WS transcript updates
- server/src/test/integration/agents-run-ws-cancel.test.ts — integration coverage proving agent runs can be cancelled via WS `cancel_inflight`
- server/src/test/integration/agents-run-client-conversation-id.test.ts — integration coverage proving client-supplied conversation ids can be new on first Agents run
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
- server/src/test/unit/mcp-agents-commands-run.test.ts — unit coverage for Agents MCP run_command tool (success + error mappings)
- server/src/test/unit/mcp-agents-tools.test.ts — unit coverage for tools-layer argument forwarding and invalid-params error mapping
- server/src/test/integration/mcp-persistence-source.test.ts — MCP persistence adds source metadata and persists MCP runs
- codex_agents/planning_agent/commands/improve_plan.json — long-form planning macro used to refine story plans
- codex_agents/planning_agent/commands/smoke.json — smoke-test planning macro for validating `run_command` wiring
- client/src/test/useConversations.source.test.ts — hook defaults missing source to REST and preserves MCP
- client/src/test/chatPage.source.test.tsx — conversation list renders source labels for REST and MCP conversations
- client/src/test/agentsApi.workingFolder.payload.test.ts — Agents API wrapper includes `working_folder` only when non-empty
- client/src/test/agentsApi.commandsList.test.ts — Agents API wrapper calls `GET /agents/:agentName/commands` and preserves disabled command entries
- client/src/test/agentsApi.commandsRun.test.ts — Agents API wrapper calls `POST /agents/:agentName/commands/run` and omits optional fields when absent
- client/src/test/agentsApi.errors.test.ts — Agents API wrapper throws structured errors exposing HTTP status + server error codes (e.g., `RUN_IN_PROGRESS`)
- client/src/test/agentsPage.commandsList.test.tsx — Agents page command dropdown refresh, disabled entries, labels, and description display
- client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx — Agents page command execution refreshes conversation turns for rendering
- client/src/test/agentsPage.commandsRun.conflict.test.tsx — Agents page surfaces RUN_IN_PROGRESS conflicts for both command execute and normal send
- client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx — Agents page disables command execution when persistence is unavailable (mongoConnected=false)
- client/src/test/agentsPage.commandsRun.abort.test.tsx — Agents page Stop sends WS cancel_inflight (does not abort async start request)
- client/src/test/agentsPage.streaming.test.tsx — Agents page renders live WS transcript updates and unsubscribes on conversation switch
- client/src/test/agentsPage.sidebarWs.test.tsx — Agents page sidebar applies subscribe_sidebar conversation_upsert/delete with agentName filtering + ordering
- client/src/test/agentsPage.sidebarActions.test.tsx — Agents sidebar filter/bulk/action parity tests for Conversations list
- client/src/test/agentsPage.layoutWrap.test.tsx — Agents sidebar layout coverage for list panel scroll and Load more placement
- client/src/test/agentsPage.citations.test.tsx — Agents transcript renders default-collapsed citations accordion under assistant bubbles
- client/src/test/agentsPage.reasoning.test.tsx — Agents transcript thought process toggle matches Chat collapse behavior
- client/src/test/agentsPage.toolsUi.test.tsx — Agents transcript renders Parameters/Result accordions for tool events
- client/src/test/agentsPage.statusChip.test.tsx — Agents transcript status chip shows Failed when turn_final status is failed
- client/src/test/chatSidebar.test.tsx — Chat sidebar bulk-selection coverage (filter reset, reorder stability, delete confirm, persistence gating) + ChatPage agent upsert ignore
- client/src/test/useChatWs.test.ts — hook-level coverage for chat WebSocket connect/reconnect/seq gating and disabled realtime mode
- client/src/test/support/mockWebSocket.ts — shared deterministic JSDOM WebSocket mock used by WS-driven client tests
- client/src/test/useConversationTurns.refresh.test.ts — unit coverage for `useConversationTurns.refresh()` replace-only snapshots + error case retains prior turns
- client/src/test/useConversationTurns.commandMetadata.test.ts — unit coverage that turns preserve optional `command` metadata for UI rendering
- client/src/test/chatPage.inflightNavigate.test.tsx — RTL coverage that navigating away/back during inflight keeps full history + inflight text
- e2e/support/mockChatWs.ts — Playwright `routeWebSocket` helper for mocking chat WS protocol in end-to-end tests
- e2e/chat-ws-logs.spec.ts — e2e asserting Logs UI shows client-forwarded chat WS log lines after mocked transcript events
