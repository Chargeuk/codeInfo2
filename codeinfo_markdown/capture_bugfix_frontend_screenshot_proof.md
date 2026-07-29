# Capture local frontend screenshot proof

This is the one optional frontend-proof pass for the story and subtask already bound by the current loop. Read and follow `AGENTS.md`. Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_next_bugfix_subtask.py"` and continue only when it still returns `status: "ready"` for the same In Progress subtask assigned to the current user. Read that subtask's `information.md`, `plan.md`, exact selector-provided `frontend_proof` file, and the smallest relevant repository startup documentation.

Do not edit product source, tests, `information.md`, `plan.md`, or Jira. Do not commit, push, upload attachments, add comments, or change Jira state. The only task artifacts this step may create or replace are current screenshot image files directly inside the selector-provided `proof` directory.

Continue only when `frontend-proof.json` contains exactly `{"required":true}`. The preceding final-proof step owns stale-image cleanup; this step must only add screenshots captured during the current pass and must never rely on an earlier image as current proof.

Start the smallest repository-supported browser environment that honestly exercises the changed surface. For the `io-api` repository, read and follow its root `system_start.md`; use the complete mock environment with fake Auth0, the entitlement/security mock, and the mock XTP transaction stream. Use the documented `npm run xtp:local:start:all` and `npm run xtp:local:stop:all` lifecycle when a new complete environment is required. Respect checkout-isolation and collision checks, never use raw Docker Compose as a substitute, and never stop a stack whose ownership is uncertain.

Use Playwright MCP or Chrome DevTools MCP to exercise the repaired behaviour and its most relevant visible regression case. Inspect browser console and failed network activity where useful, but retain only screenshots as task artifacts. Confirm visually that each retained screenshot actually shows the intended fixed state.

Playwright screenshot paths are relative to its runtime output directory, normally `/tmp/playwright-output`; do not pass a target-repository absolute path to Playwright. Use deterministic staging names such as:

`bugfixes/<storyId>/<subtaskId>/proof-01-<short-description>.png`

For the normal CodeInfo2 harness, first look for that staged file at:

`$CODEINFO_ROOT/playwright-output-local/bugfixes/<storyId>/<subtaskId>/proof-01-<short-description>.png`

Transfer each retained image into the target repository as a direct child of:

`codeInfoTmp/bugfixes/<storyId>/<subtaskId>/proof/`

Use deterministic basenames such as `proof-01-<short-description>.png`. Verify every transferred file exists and inspect it from its final local path. If the normal host-visible staging bind is unavailable, use only the positively identified Playwright runtime's supported copy-out path; do not guess a container.

Return the tested environment to the state observed at the beginning of this step. If startup, browser access, capture, transfer, inspection, or cleanup fails, report the limitation honestly and do not create or preserve a misleading screenshot. Make no Jira call even when proof succeeds.
