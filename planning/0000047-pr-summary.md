## Story 0000047 Summary

This story unified Codex chat/runtime behavior around one shared config path. The server now treats `codex/chat/config.toml` as the default Codex chat model source, merges that model into the shared Codex model list without disturbing `Codex_model_list` order, bootstraps missing `codex/config.toml` and `codex/chat/config.toml` from canonical in-code templates, preserves required base-runtime inheritance for chat and agent execution, and normalizes Context7 API keys in memory from `CODEINFO_CONTEXT7_API_KEY`.

Post-review fix status:

- Task 8 closed the `must_fix` finding by appending `--api-key <env>` in memory when Context7 already uses the canonical no-key args form.
- Task 9 closed the `should_fix` finding by removing unrelated future-story planning drift so the branch diff is back to Story 47 artifacts only.
- The review's optional runtime-config simplification was intentionally deferred; Story 47 closes on correctness and proof rather than a secondary refactor.

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
- `DEV_0000047_T05_CONTEXT7_NORMALIZED` observed from the live server image with a temporary no-key runtime home plus `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real`, reporting `mode: 'env_overlay'`, `surface: 'chat'`, and `success: true`; the resolved args were `["-y","@upstash/context7-mcp","--api-key","ctx7sk-real"]`.

Final verification results:

- `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`.
- `npm run build:summary:client` passed with `status: passed` and `warning_count: 0`.
- `npm run test:summary:server:unit` passed with `tests run: 1205`, `passed: 1205`, `failed: 0`.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, `failed: 0`.
- `npm run test:summary:client` passed with `tests run: 544`, `passed: 544`, `failed: 0`.
- `npm run test:summary:e2e` passed with `tests run: 43`, `passed: 43`, `failed: 0`.
- `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`.
- Manual Playwright-MCP verification against `http://host.docker.internal:5001/chat` confirmed the chat UI still loaded with provider `codex`, model `gpt-5.1-codex-mini`, a successful `ok` response, and no browser console errors.
- `git diff --name-status main...HEAD -- planning projectStructure.md` now shows only Story 47 planning artifacts after the Task 9 cleanup.

Saved evidence:

- `codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-evidence.md`
- `codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md`
