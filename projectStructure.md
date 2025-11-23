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
â”œâ”€ docker-compose.yml â€” compose stack for client/server
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
â”‚     â”‚  â””â”€ NavBar.tsx â€” top navigation AppBar/Tabs
â”‚     â”œâ”€ logging/
â”‚     â”‚  â”œâ”€ index.ts â€” logging exports
|     |  |- logger.ts ? client logger factory (console tee + queue)
|     |  - transport.ts ? forwarding queue placeholder
|     |- hooks/
|     |  |- useChatModel.ts ? fetches /chat/models, tracks selected model state
|     |  |- useChatStream.ts ? streaming chat hook (POST /chat, SSE parsing, logging tool events)
|     |  |- useLmStudioStatus.ts ? LM Studio status/models data hook
|     |  - useLogs.ts ? log history + SSE hook with filters
|     |- index.css ? minimal global styles (font smoothing, margin reset)
|     |- main.tsx ? app entry with RouterProvider
|     |- pages/
|     |  |- ChatPage.tsx ? chat shell with model select and placeholder transcript
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
|     |     |- chatPage.stop.test.tsx ? chat stop control aborts streams and shows status bubble
|     |     |- logsPage.test.tsx ? Logs page renders data, live toggle behaviour
|     |     |- lmstudio.test.tsx ? LM Studio page tests
|     |     |- router.test.tsx ? nav/router tests
|     |     |- setupTests.ts ? Jest/test setup
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
â”‚  â”œâ”€ chat.spec.ts - chat page end-to-end (model select + two-turn stream; skips if models unavailable)
â”‚  â”œâ”€ lmstudio.spec.ts â€” LM Studio UI/proxy e2e
â”‚  â”œâ”€ logs.spec.ts â€” Logs UI end-to-end sample emission
â”‚  â””â”€ version.spec.ts â€” version display e2e
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
â”‚     â”‚  â””â”€ lmstudio.ts â€” LM Studio proxy route
â”‚     â”œâ”€ ingest/ â€” ingest helpers (discovery, chunking, hashing, config)
â”‚     â”‚  â”œâ”€ __fixtures__/sample.ts â€” sample text blocks for chunking tests
â”‚     â”‚  â”œâ”€ __tests__/chunker.test.ts â€” chunking behaviour and slicing coverage
â”‚     â”‚  â”œâ”€ __tests__/discovery.test.ts â€” discovery include/exclude and git-tracked coverage
â”‚     â”‚  â”œâ”€ __tests__/hashing.test.ts â€” deterministic hashing coverage
â”‚     â”‚  â”œâ”€ modelLock.ts — placeholder for ingest model lock retrieval
â”‚     â”‚  â”œâ”€ lock.ts — single-flight ingest lock with TTL
â”‚     â”‚  â”œâ”€ chunker.ts â€” boundary-aware chunking with token limits
â”‚     â”‚  â”œâ”€ config.ts â€” ingest config resolver for include/exclude and token safety
â”‚     â”‚  â”œâ”€ discovery.ts â€” git-aware file discovery with exclude/include and text check
â”‚     â”‚  â”œâ”€ hashing.ts â€” sha256 hashing for files/chunks
â”‚     â”‚  â”œâ”€ index.ts â€” barrel export for ingest helpers
â”‚     â”‚  â””â”€ types.ts â€” ingest types (DiscoveredFile, Chunk, IngestConfig)
â”‚     â”œâ”€ types/
â”‚     â”‚  â””â”€ pino-roll.d.ts â€” module shim for pino-roll until official types
â”‚     â””â”€ test/
â”‚        â”œâ”€ features/
        - chat_stream.feature - streaming /chat SSE Cucumber coverage
        - chat_cancellation.feature - Cucumber coverage for aborting chat streams
        - chat_models.feature - Cucumber coverage for chat model list endpoint
        - example.feature - sample feature
        - lmstudio.feature - LM Studio proxy scenarios
        - ingest-models.feature - embedding models endpoint scenarios
        - ingest-roots.feature - ingest roots listing endpoint scenarios
        - ingest-cancel.feature - cancel active ingest scenarios
        - ingest-reembed.feature - re-embed scenarios
        - ingest-remove.feature - remove root scenarios
steps/
        - chat_stream.steps.ts - step defs for chat_stream.feature
        - chat_cancellation.steps.ts - step defs for chat_cancellation.feature
        - chat_models.steps.ts - step defs for chat_models.feature
        - example.steps.ts - step defs for example.feature
        - lmstudio.steps.ts - step defs for LM Studio feature
        - ingest-models.steps.ts - step defs for ingest models endpoint
        - ingest-roots.steps.ts - step defs for ingest roots endpoint
        - ingest-manage.steps.ts - step defs for cancel/re-embed/remove endpoints
support/
â”‚           â””â”€ mockLmStudioSdk.ts â€” controllable LM Studio SDK mock
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
