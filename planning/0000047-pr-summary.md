## Story 0000047 Summary

This story unified Codex chat/runtime behavior around one shared config path. The server now treats `codex/chat/config.toml` as the default Codex chat model source, merges that model into the shared Codex model list without disturbing `Codex_model_list` order, bootstraps missing `codex/config.toml` and `codex/chat/config.toml` from canonical in-code templates, preserves required base-runtime inheritance for chat and agent execution, and normalizes Context7 API keys in memory from `CODEINFO_CONTEXT7_API_KEY`.

Implementation highlights:

- `server/src/config/chatDefaults.ts`, `server/src/codex/capabilityResolver.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatValidators.ts`, and `server/src/mcp2/tools/codebaseQuestion.ts` now share the same Codex-aware default/model resolution behavior.
- `server/src/config/codexConfig.ts` now seeds missing base config from one canonical in-code template using `model = "gpt-5.3-codex"` and no seeded Context7 `--api-key` pair.
- `server/src/config/runtimeConfig.ts` now seeds missing chat config directly from the canonical chat template, preserves additive/shared base inheritance for chat and agent runtime config, and applies Context7 runtime-only normalization after inheritance.
- `README.md`, `design.md`, `projectStructure.md`, and `planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md` now document the final acceptance mapping and Story 47 verification markers.

Observed Story 47 runtime markers during final verification:

- `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` observed for REST (`/chat/providers`, `/chat/models`) and MCP (`mcp2.codebase_question`) with `success: true`.
- `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP` observed with `outcome: 'existing'`, `template_source: 'in_code'`, and `success: true`.
- `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP` observed with `outcome: 'existing'`, `source: 'chat_template'`, and `success: true`.
- `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED` observed for both `surface: 'chat'` and `surface: 'agent'` with `success: true`.
- `DEV_0000047_T05_CONTEXT7_NORMALIZED` observed for both `surface: 'chat'` and `surface: 'agent'` with `mode: 'no_key_fallback'` and `success: true`.

Final verification results:

- `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`.
- `npm run build:summary:client` passed with `status: passed` and `warning_count: 0`.
- `npm run test:summary:server:unit` passed with `tests run: 1202`, `passed: 1202`, `failed: 0`.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, `failed: 0`.
- `npm run test:summary:client` passed with `tests run: 544`, `passed: 544`, `failed: 0`.
- `npm run test:summary:e2e` passed with `tests run: 43`, `passed: 43`, `failed: 0`.
- `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`.
- Manual Playwright-MCP verification against `http://host.docker.internal:5001/chat` confirmed the unchanged chat UI reflected the server-selected Codex defaults and merged model list, including `gpt-5.3-codex` in the dropdown, with no browser console errors.

Saved evidence:

- `test-results/screenshots/0000047-7-chat-defaults.png`
- `test-results/screenshots/0000047-7-chat-model-list.png`
