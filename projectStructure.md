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
- client/: Vite config, App/main entrypoints, env defaults, Jest setup, Docker assets, MUI UI.
- server/: Express entrypoint, env defaults, Cucumber `src/test`, `cucumber.js`, Docker assets.
- common/: `src/index.ts` and `src/versionInfo.ts` exporting VersionInfo/getAppInfo.
- e2e/: Playwright tests (version.spec.ts) for UI/version checks.
