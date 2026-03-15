## Story 0000047 Summary

This story unified Codex chat/runtime behavior around one shared config path. The server now treats `codex/chat/config.toml` as the default Codex chat model source, merges that model into the shared Codex model list without disturbing `Codex_model_list` order, bootstraps missing `codex/config.toml` and `codex/chat/config.toml` from canonical in-code templates, preserves required base-runtime inheritance for chat and agent execution, and normalizes Context7 API keys in memory from `CODEINFO_CONTEXT7_API_KEY`.

Post-review fix status:

- Task 8 closed the first reopened `must_fix` by appending `--api-key <env>` in memory when Context7 already uses the canonical no-key args form.
- Task 9 closed the `should_fix` planning-scope finding by removing unrelated future-story planning drift so the branch diff is back to Story 47 artifacts only.
- Task 11 closed the external-review `must_fix` by preserving malformed merged-table scalar values for keys like `mcp_servers` and `tools` until runtime validation rejects them instead of silently normalizing them away.
- Task 13 closed the latest reopened `should_fix` by normalizing `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` so every touched Story 47 REST and MCP surface now emits the same `model_source` vocabulary, while retaining raw Codex source separately as `codex_model_source` where needed.
- Task 14 reran the full regression and manual validation stack after the marker-contract repair and confirmed the Story 47 behavior remained green end to end.
- Task 15 closed the final reopened `should_fix` by restoring mixed-shape `features.view_image_tool` compatibility when runtime configs already contain unrelated `tools` entries but omit canonical `tools.view_image`.
- Task 16 reran the full regression and manual validation stack after that mixed-shape repair and confirmed the Story 47 behavior remains green end to end.
- Task 17 closed the latest reopened `should_fix` by preserving malformed legacy alias values such as `features.view_image_tool = "maybe"` and `features.web_search_request = "sometimes"` until runtime validation rejects them instead of letting normalization delete them silently.
- Task 18 reran the full regression and manual validation stack after the malformed-alias repair and confirmed the Story 47 behavior remains green end to end.

Implementation highlights:

- `server/src/config/chatDefaults.ts`, `server/src/codex/capabilityResolver.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatValidators.ts`, and `server/src/mcp2/tools/codebaseQuestion.ts` now share the same Codex-aware default/model resolution behavior.
- `server/src/config/chatDefaults.ts` now also provides the shared normalization helpers that keep Story 47 marker `model_source` fields consistent across REST and MCP emitters while preserving the raw Codex source under `codex_model_source` when that detail is still operationally useful.
- `server/src/config/codexConfig.ts` now seeds missing base config from one canonical in-code template using `model = "gpt-5.3-codex"` and no seeded Context7 `--api-key` pair.
- `server/src/config/runtimeConfig.ts` now seeds missing chat config directly from the canonical chat template, preserves additive/shared base inheritance for chat and agent runtime config, applies Context7 runtime-only normalization after inheritance, preserves malformed merged-table scalar values long enough for the existing validation path to reject them, and keeps malformed legacy alias values visible to validation instead of normalizing them away.
- `README.md`, `design.md`, `projectStructure.md`, and `planning/0000047-codex-chat-config-defaults-bootstrap-and-context7-overlay.md` now document the final acceptance mapping and Story 47 verification markers.

Observed Story 47 runtime markers during final verification:

- `DEV_0000047_T01_CODEX_DEFAULTS_APPLIED` observed for REST (`/chat/providers`, `/chat/models`) and MCP (`mcp2.codebase_question`) with `success: true`.
- `DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP` observed with `outcome: 'existing'`, `template_source: 'in_code'`, and `success: true`.
- `DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP` observed with `outcome: 'existing'`, `source: 'chat_template'`, and `success: true`.
- `DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED` observed for both `surface: 'chat'` and `surface: 'agent'` with `success: true`.
- Earlier Task 5 live-image proof scenario: `DEV_0000047_T05_CONTEXT7_NORMALIZED` was observed with a temporary no-key runtime home plus `CODEINFO_CONTEXT7_API_KEY=ctx7sk-real`, reporting `mode: 'env_overlay'`, `surface: 'chat'`, and `success: true`; the resolved args were `["-y","@upstash/context7-mcp","--api-key","ctx7sk-real"]`.
- Final Task 18 compose-backed closeout proof scenario: `DEV_0000047_T05_CONTEXT7_NORMALIZED` was observed during the host-port verification at `http://host.docker.internal:5001/chat`, reporting `mode: 'no_key_fallback'`, `surface: 'chat'`, and `success: true`.

Final verification results:

- `npm run build:summary:server` passed with `status: passed` and `warning_count: 0`.
- `npm run build:summary:client` passed with `status: passed` and `warning_count: 0`.
- `npm run test:summary:server:unit` passed with `tests run: 1215`, `passed: 1215`, `failed: 0`.
- `npm run test:summary:server:cucumber` passed with `tests run: 71`, `passed: 71`, `failed: 0`.
- `npm run test:summary:client` passed with `tests run: 544`, `passed: 544`, `failed: 0`.
- `npm run test:summary:e2e` passed with `tests run: 40`, `passed: 40`, `failed: 0`.
- `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`.
- Manual Playwright-MCP verification against `http://host.docker.internal:5001/chat` confirmed the chat UI still loaded with provider `codex`, model `gpt-5.1-codex-mini`, a successful `ok` response, no browser console errors, and the final closeout T05 marker scenario `mode: 'no_key_fallback'` after the malformed-alias validation repair.
- `npm run compose:up` and `npm run compose:down` both completed cleanly around the manual host-port verification pass.
- `git diff --name-status main...HEAD -- planning projectStructure.md` now shows only Story 47 planning artifacts after the Task 9 cleanup.

Remaining indirect-proof areas:

- AC13 `existing client contract remains usable without response-shape change` remains indirect because the current proof still relies on unchanged client/type contracts plus the green wrapper and manual runtime coverage instead of a dedicated response-shape snapshot artifact.
- AC36 `public REST and MCP payload shapes remain unchanged` remains indirect for the same reason; this review cycle intentionally repaired the shared marker contract without introducing a new payload-contract snapshot.

Saved evidence:

- `codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-evidence.md`
- `codeInfoStatus/reviews/0000047-20260315T112504Z-a715fc25-findings.md`
