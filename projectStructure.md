# Project Structure (full tree)

Tree covers all tracked files (excluding `.git`, `node_modules`, `dist`, `test-results`). Keep this in sync whenever files are added/removed/renamed; each line has a brief comment.

```
.
â”œâ”€ .DS_Store â€” macOS metadata (safe to delete)
â”œâ”€ .editorconfig â€” shared editor defaults
â”œâ”€ .gitattributes â€” git attributes (line endings, linguist)
â”œâ”€ .gitignore â€” ignore rules (node_modules, dist, env.local, etc.)
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
â”‚  â”‚  â””â”€ vite.svg â€” Vite logo asset
â”‚  â””â”€ src/
â”‚     â”œâ”€ App.tsx â€” app shell with CssBaseline/NavBar/Container
â”‚     â”œâ”€ assets/react.svg â€” React logo asset
â”‚     â”œâ”€ components/
â”‚     â”‚  â”œâ”€ NavBar.tsx â€” top navigation AppBar/Tabs
|     |  |- Markdown.tsx ? sanitized GFM renderer for assistant/think text with code block styling
â”‚     â”‚  â””â”€ ingest/
â”‚     â”‚     â”œâ”€ ActiveRunCard.tsx — shows active ingest status, counts, cancel + logs link
â”‚     â”‚     â””â”€ IngestForm.tsx — ingest form with validation, lock banner, submit handler
â”‚     â”‚     â”œâ”€ RootsTable.tsx — embedded roots table with bulk/row actions and lock chip
â”‚     â”‚     â””â”€ RootDetailsDrawer.tsx — drawer showing root metadata, counts, include/exclude lists
â”‚     â”œâ”€ logging/
â”‚     â”‚  â”œâ”€ index.ts â€” logging exports
|     |  |- logger.ts ? client logger factory (console tee + queue)
|     |  - transport.ts ? forwarding queue placeholder
|     |- hooks/
|     |  |- useChatModel.ts ? fetches /chat/models, tracks selected model state
|     |  |- useChatStream.ts ? streaming chat hook (POST /chat, SSE parsing, logging tool events)
|     |  |- useLmStudioStatus.ts ? LM Studio status/models data hook
|     |  |- useIngestStatus.ts ? polls /ingest/status/:runId and supports cancelling
|     |  |- useIngestRoots.ts ? fetches /ingest/roots with lock info and refetch helper
|     |  |- useIngestModels.ts ? fetches /ingest/models with lock + default selection
|     |  - useLogs.ts ? log history + SSE hook with filters
|     |- index.css ? minimal global styles (font smoothing, margin reset)
|     |- main.tsx ? app entry with RouterProvider
|     |- pages/
|     |  |- ChatPage.tsx ? chat shell with model select and placeholder transcript
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
|     |     |- chatPage.stream.test.tsx ? chat streaming hook + UI coverage
|     |     |- chatPage.citations.test.tsx ? chat citations render with host paths
|     |     |- chatPage.noPaths.test.tsx ? chat citations render when host path missing
|     |     |- chatPage.stop.test.tsx ? chat stop control aborts streams and shows status bubble
|     |     |- chatPage.toolVisibility.test.tsx ? tool-call spinner + collapsible results
|     |     |- chatPage.reasoning.test.tsx ? Harmony/think reasoning collapse spinner + toggle
|     |     |- chatPage.markdown.test.tsx ? assistant markdown rendering for lists and code fences
|     |     |- ingestForm.test.tsx ? ingest form validation, lock banner, submit payloads
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
â”‚     â”‚  â””â”€ chatStream.ts — canonical chat request/SSE fixtures
â”‚     â”œâ”€ api.ts â€” fetch helpers (server version, LM Studio)
â”‚     â”œâ”€ index.ts â€” barrel exports
â”‚     â”œâ”€ lmstudio.ts â€” LM Studio DTOs/types
â”‚     â”œâ”€ logging.ts â€” LogEntry/LogLevel DTO + isLogEntry guard
â”‚     â””â”€ versionInfo.ts â€” VersionInfo DTO
â”œâ”€ e2e/ â€” Playwright specs
â”‚  â”œâ”€ fixtures/
â”‚  â”‚  â”œâ”€ repo/README.md — ingest e2e sample repo description
â”‚  â”‚  â””â”€ repo/main.txt — ingest e2e sample source file with deterministic Q&A text
â”‚  â”œâ”€ chat.spec.ts - chat page end-to-end (model select + two-turn stream; skips if models unavailable)
â”‚  â”œâ”€ chat-tools.spec.ts — chat citations e2e: ingest fixture, vector search, mock chat SSE, assert repo/host path citations
â”‚  â”œâ”€ chat-reasoning.spec.ts — Harmony/think reasoning collapse e2e (mock SSE)
â”‚  â”œâ”€ lmstudio.spec.ts â€” LM Studio UI/proxy e2e
â”‚  â”œâ”€ logs.spec.ts â€” Logs UI end-to-end sample emission
â”‚  â””â”€ version.spec.ts â€” version display e2e
â”‚  â””â”€ ingest.spec.ts — ingest flows (happy path, cancel, re-embed, remove) with skip when models unavailable
â”œâ”€ planning/ â€” story plans and template
â”‚  â”œâ”€ 0000001-initial-skeleton-setup.md â€” plan for story 0000001
â”‚  â”œâ”€ 0000002-lmstudio-config.md â€” plan for story 0000002
â”‚  â”œâ”€ 0000003-logging-and-log-viewer.md â€” plan for story 0000003 (current)
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
â”‚     â”œâ”€ chatStream.ts — SSE helper for chat streaming
â”‚     â”œâ”€ routes/
â”‚     â”‚  â”œâ”€ chat.ts — POST /chat streaming SSE via LM Studio act()
â”‚     â”‚  â”œâ”€ chatModels.ts â€” LM Studio chat models list endpoint
â”‚     â”‚  â”œâ”€ ingestModels.ts — GET /ingest/models embedding models list + lock info
â”‚     â”‚  â”œâ”€ ingestRoots.ts — GET /ingest/roots listing embedded roots and lock state
â”‚     â”‚  â”œâ”€ ingestCancel.ts — POST /ingest/cancel/:runId cancels active ingest and cleans vectors
â”‚     â”‚  â”œâ”€ ingestReembed.ts — POST /ingest/reembed/:root re-runs ingest for a stored root
â”‚     â”‚  â”œâ”€ ingestRemove.ts — POST /ingest/remove/:root purge vectors/metadata and unlock if empty
â”‚     â”‚  â”œâ”€ logs.ts â€” log ingestion, history, and SSE streaming routes
â”‚     â”‚  â”œâ”€ toolsIngestedRepos.ts â€” GET /tools/ingested-repos repo list for agent tools
â”‚     â”‚  â”œâ”€ toolsVectorSearch.ts â€” POST /tools/vector-search chunk search with optional repo filter
â”‚     â”‚  â””â”€ lmstudio.ts â€” LM Studio proxy route
â”‚     â”œâ”€ ingest/ â€” ingest helpers (discovery, chunking, hashing, config)
â”‚     â”‚  â”œâ”€ __fixtures__/sample.ts â€” sample text blocks for chunking tests
â”‚     â”‚  â”œâ”€ modelLock.ts — placeholder for ingest model lock retrieval
â”‚     â”‚  â”œâ”€ lock.ts — single-flight ingest lock with TTL
â”‚     â”‚  â”œâ”€ chunker.ts â€” boundary-aware chunking with token limits
â”‚     â”‚  â”œâ”€ config.ts â€” ingest config resolver for include/exclude and token safety
â”‚     â”‚  â”œâ”€ discovery.ts â€” git-aware file discovery with exclude/include and text check
â”‚     â”‚  â”œâ”€ hashing.ts â€” sha256 hashing for files/chunks
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
        - chat_stream.feature - streaming /chat SSE Cucumber coverage
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
â”‚           â”œâ”€ chroma-embedding-selection.test.ts â€” locked-model embedding function selection + error paths
â”‚           â”œâ”€ ingest-status.test.ts â€” ingest status progress fields round-trip helper coverage
â”‚           â”œâ”€ tools-ingested-repos.test.ts â€” supertest coverage for /tools/ingested-repos
â”‚           â””â”€ tools-vector-search.test.ts â€” supertest coverage for /tools/vector-search
â”‚        â”œâ”€ integration/
â”‚        |  â”œâ”€ chat-tools-wire.test.ts â€” chat route SSE wiring with mocked LM Studio tools
â”‚        |  â””â”€ chat-vectorsearch-locked-model.test.ts â€” chat SSE error/success flows when vector search lock/enbedding availability changes
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
