# Project Structure (full tree)

Tree covers all tracked files (excluding `.git`, `node_modules`, `dist`, `test-results`). Keep this in sync whenever files are added/removed/renamed; each line has a brief comment.

```
.
├─ .DS_Store — macOS metadata (safe to delete)
├─ .editorconfig — shared editor defaults
├─ .gitattributes — git attributes (line endings, linguist)
├─ .gitignore — ignore rules (node_modules, dist, env.local, etc.)
├─ .npmrc — npm config (save-exact)
├─ .prettierignore — files skipped by Prettier
├─ .prettierrc — Prettier settings
├─ AGENTS.md — agent workflow rules
├─ README.md — repo overview and commands
├─ logs/ — runtime server log output (gitignored, host-mounted)
├─ design.md — design notes and diagrams
├─ docker-compose.yml — compose stack for client/server
├─ eslint.config.js — root ESLint flat config
├─ package-lock.json — workspace lockfile
├─ package.json — root package/workspaces/scripts
├─ tsconfig.base.json — shared TS config
├─ tsconfig.json — project references entry
├─ client/ — React 19 Vite app
│  ├─ .dockerignore — client docker build ignores
│  ├─ .env — client default env (VITE_API_URL, VITE_LMSTUDIO_URL)
│  ├─ .env.local — client local overrides (ignored by git consumers)
│  ├─ .gitignore — client-specific ignores
│  ├─ Dockerfile — client image build
│  ├─ README.md — client-specific notes
│  ├─ eslint.config.js — client ESLint entry
│  ├─ index.html — Vite HTML shell
│  ├─ jest.config.ts — Jest config
│  ├─ package.json — client workspace manifest
│  ├─ tsconfig.app.json — TS config for app build
│  ├─ tsconfig.json — TS references
│  ├─ tsconfig.node.json — TS config for tools
│  ├─ vite.config.ts — Vite config
│  ├─ public/
│  │  └─ vite.svg — Vite logo asset
│  └─ src/
│     ├─ App.tsx — app shell with CssBaseline/NavBar/Container
│     ├─ assets/react.svg — React logo asset
│     ├─ components/
│     │  └─ NavBar.tsx — top navigation AppBar/Tabs
│     ├─ logging/
│     │  ├─ index.ts — logging exports
│     │  ├─ logger.ts — client logger factory (console tee + queue)
│     │  └─ transport.ts — forwarding queue placeholder
│     ├─ hooks/
│     │  ├─ useLmStudioStatus.ts — LM Studio status/models data hook
│     │  └─ useLogs.ts — log history + SSE hook with filters
│     ├─ index.css — minimal global styles (font smoothing, margin reset)
│     ├─ main.tsx — app entry with RouterProvider
│     ├─ pages/
│     │  ├─ HomePage.tsx — version card page
│     │  ├─ LmStudioPage.tsx — LM Studio config/status/models UI
│     │  └─ LogsPage.tsx — log viewer with filters, live toggle, sample emitter
│     ├─ routes/
│     │  ├─ RouterErrorBoundary.tsx — route-level error boundary logger
│     │  └─ router.tsx — React Router setup
│     └─ test/
│        ├─ logging/
│        │  ├─ logger.test.ts — logger creation/global hooks coverage
│        │  └─ transport.test.ts — client log transport queue/backoff tests
│        ├─ logsPage.test.tsx — Logs page renders data, live toggle behaviour
│        ├─ lmstudio.test.tsx — LM Studio page tests
│        ├─ router.test.tsx — nav/router tests
│        ├─ setupTests.ts — Jest/test setup
│        ├─ useLmStudioStatus.test.ts — hook tests
│        ├─ useLogs.test.ts — log fetch + SSE hook tests
│        └─ version.test.tsx — version card test
├─ common/ — shared TypeScript package
│  ├─ package.json — common workspace manifest
│  ├─ tsconfig.json — TS config for common
│  ├─ tsconfig.tsbuildinfo — TS build info cache
│  └─ src/
│     ├─ fixtures/ — shared LM Studio model fixtures
│     │  └─ mockModels.ts — shared fixture for LM Studio models list
│     │  └─ chatStream.ts � canonical chat request/SSE fixtures
│     ├─ api.ts — fetch helpers (server version, LM Studio)
│     ├─ index.ts — barrel exports
│     ├─ lmstudio.ts — LM Studio DTOs/types
│     ├─ logging.ts — LogEntry/LogLevel DTO + isLogEntry guard
│     └─ versionInfo.ts — VersionInfo DTO
├─ e2e/ — Playwright specs
│  ├─ lmstudio.spec.ts — LM Studio UI/proxy e2e
│  ├─ logs.spec.ts — Logs UI end-to-end sample emission
│  └─ version.spec.ts — version display e2e
├─ planning/ — story plans and template
│  ├─ 0000001-initial-skeleton-setup.md — plan for story 0000001
│  ├─ 0000002-lmstudio-config.md — plan for story 0000002
│  ├─ 0000003-logging-and-log-viewer.md — plan for story 0000003 (current)
│  └─ plan_format.md — planning template/instructions
├─ server/ — Express API
│  ├─ .dockerignore — server docker build ignores
│  ├─ .env — server default env (PORT, LMSTUDIO_BASE_URL)
│  ├─ .env.local — server local overrides (ignored by git consumers)
│  ├─ .prettierignore — server-specific Prettier ignore
│  ├─ Dockerfile — server image build
│  ├─ cucumber.js — Cucumber config
│  ├─ package.json — server workspace manifest
│  ├─ tsconfig.json — TS config for server
│  ├─ tsconfig.tsbuildinfo — TS build info cache
│  └─ src/
│     ├─ index.ts — Express app entry
│     ├─ logger.ts — pino/pino-http setup with rotation and env config helper
│     ├─ logStore.ts — in-memory log buffer with sequence numbers and filters
│     ├─ chatStream.ts � SSE helper for chat streaming
│     ├─ routes/
│     │  ├─ chat.ts � POST /chat streaming SSE via LM Studio act()
│     │  ├─ chatModels.ts — LM Studio chat models list endpoint
│     │  ├─ logs.ts — log ingestion, history, and SSE streaming routes
│     │  └─ lmstudio.ts — LM Studio proxy route
│     ├─ types/
│     │  └─ pino-roll.d.ts — module shim for pino-roll until official types
│     └─ test/
│        ├─ features/
│        │  ├─ chat_stream.feature � streaming /chat SSE Cucumber coverage
│        │  ├─ chat_models.feature — Cucumber coverage for chat model list endpoint
│        │  ├─ example.feature — sample feature
│        │  └─ lmstudio.feature — LM Studio proxy scenarios
│        ├─ steps/
│        │  ├─ chat_stream.steps.ts � step defs for chat streaming
│        │  ├─ chat_models.steps.ts — step defs for chat_models.feature
│        │  ├─ example.steps.ts — step defs for example.feature
│        │  └─ lmstudio.steps.ts — step defs for LM Studio feature
│        └─ support/
│           └─ mockLmStudioSdk.ts — controllable LM Studio SDK mock
├─ .husky/ — git hooks managed by Husky
│  ├─ pre-commit — runs lint-staged
│  └─ _/
│     ├─ .gitignore — keep generated scripts out of git
│     ├─ applypatch-msg — hook stub
│     ├─ commit-msg — hook stub
│     ├─ h — Husky helper
│     ├─ husky.sh — Husky bootstrap
│     ├─ post-applypatch — hook stub
│     ├─ post-checkout — hook stub
│     ├─ post-commit — hook stub
│     ├─ post-merge — hook stub
│     ├─ post-rewrite — hook stub
│     ├─ pre-applypatch — hook stub
│     ├─ pre-auto-gc — hook stub
│     ├─ pre-commit — hook stub
│     ├─ pre-merge-commit — hook stub
│     ├─ pre-push — hook stub
│     ├─ pre-rebase — hook stub
│     └─ prepare-commit-msg — hook stub
└─ .husky/pre-commit — root hook invoking lint-staged (already listed above for clarity)
```
