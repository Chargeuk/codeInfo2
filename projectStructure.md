# Project Structure

**Update this file whenever files are added/removed/renamed; every task that changes structure must refresh this map.**

Current root map:

```
.
├─ client/              # React 19 Vite app (MUI), tests, Dockerfile, .dockerignore
├─ server/              # Express API with Cucumber tests, Dockerfile, .dockerignore
├─ common/              # Shared DTO/util package
├─ planning/            # Story plans + template
├─ .husky/              # Git hooks (lint-staged pre-commit)
├─ e2e/                 # Playwright specs
├─ docker-compose.yml   # Compose stack wiring client/server with healthchecks
├─ design.md            # Design notes + mermaid diagrams
├─ projectStructure.md  # This living structure map
├─ README.md            # Overview, commands, env policy
├─ package.json         # Workspaces, scripts, lint-staged, engines
├─ package-lock.json    # Locked deps
├─ tsconfig.base.json   # Shared TS config
├─ tsconfig.json        # Project references for workspaces
├─ eslint.config.js     # Flat ESLint config
├─ .prettierrc          # Prettier config
├─ .prettierignore      # Prettier ignore list
├─ .editorconfig        # Editor defaults
├─ .npmrc               # npm config (save-exact)
├─ .gitignore           # Ignores node_modules, dist, coverage, .env.local, etc. (keeps .env)
└─ AGENTS.md            # Agent workflow rules
```

Notes by area:

- planning/: `plan_format.md` (template) and `0000001-initial-skeleton-setup.md` (active story plan).
- planning/: `plan_format.md` (template) and story plans `0000001-initial-skeleton-setup.md`, `0000002-lmstudio-config.md`.
- client/: Vite config, App/main entrypoints, env defaults, Jest setup, Docker assets, MUI UI, `src/components/NavBar.tsx`, `src/routes/router.tsx`, pages `src/pages/HomePage.tsx` and `src/pages/LmStudioPage.tsx`, tests incl. `src/test/router.test.tsx`.
- server/: Express entrypoint, env defaults (including `LMSTUDIO_BASE_URL`), Cucumber `src/test`, `cucumber.js`, Docker assets, and LM Studio router stub `src/routes/lmstudio.ts`.
- common/: `src/index.ts`, `src/versionInfo.ts`, and shared helpers/types in `src/api.ts` and `src/lmstudio.ts`.
- e2e/: Playwright tests (version.spec.ts) for UI/version checks.
