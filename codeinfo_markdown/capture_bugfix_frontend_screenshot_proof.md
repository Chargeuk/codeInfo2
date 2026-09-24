# Capture local frontend screenshot proof

This is the one optional frontend-proof pass for the story and subtask already bound by the current loop. Read and follow `AGENTS.md`. Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_bound_bugfix_subtask.py"` and continue only when it returns `status: "ready"` for the same durably bound In Progress subtask and reports `assigned_to_current_user: true`. Never run the next-work selector or adopt another issue. Read that subtask's `information.md`, `plan.md`, exact bound-task-helper-provided `frontend_proof` file, and the smallest relevant repository startup documentation.

Do not edit product source, tests, `information.md`, `plan.md`, or Jira. Do not commit, push, upload attachments, add comments, or change Jira state. The only task artifacts this step may create or replace are current screenshot image files directly inside the bound-task-helper-provided `proof` directory.

Continue only when `frontend-proof.json` contains exactly `{"required":true}`. The preceding final-proof step owns stale-image cleanup; this step must only add screenshots captured during the current pass and must never rely on an earlier image as current proof.

Start the smallest repository-supported browser environment that honestly exercises the changed surface. For the `io-api` repository, read and follow its root `system_start.md`; use the complete mock environment with fake Auth0, the entitlement/security mock, and the mock XTP transaction stream. Use the documented `npm run xtp:local:start:all` and `npm run xtp:local:stop:all` lifecycle when a new complete environment is required. Respect checkout-isolation and collision checks, never use raw Docker Compose as a substitute, and never stop a stack whose ownership is uncertain.

If `information.md` positively establishes that the changed surface can be conclusively verified only in the deployed Dev environment, this remains a best-effort local screenshot pass. Attempt the smallest safe local environment when it can provide useful partial evidence, but do not fabricate equivalence between a local mock and the Dev-only condition. Failure to obtain a local screenshot is non-blocking for later closure only under that explicit Dev-only verification condition; report the limitation precisely so the publication and closure steps can evaluate it. Ordinary frontend changes remain subject to the normal local screenshot contract.

Use Playwright MCP or Chrome DevTools MCP to exercise the repaired behaviour and its most relevant visible regression case. Inspect browser console and failed network activity where useful, but retain only screenshots as task artifacts. Confirm visually that each retained screenshot actually shows the intended fixed state.

When using Playwright MCP, call its screenshot tool with the `filename` argument set to one flat relative filename containing no `/` characters. Do not pass an absolute path, a target-repository path, or a nested relative path. Use a deterministic staging filename such as:

`bugfix-<storyId>-<subtaskId>-proof-01-<short-description>.png`

For the normal CodeInfo2 local harness, Playwright resolves that relative filename inside `/tmp/playwright-output`. After the screenshot tool succeeds, find that exact staged file at:

`$CODEINFO_ROOT/playwright-output-local/bugfix-<storyId>-<subtaskId>-proof-01-<short-description>.png`

Transfer each retained image into the target repository as a direct child of:

`codeInfoTmp/bugfixes/<storyId>/<subtaskId>/proof/`

Use deterministic basenames such as `proof-01-<short-description>.png`. Verify every transferred file exists and inspect it from its final local path. If the normal host-visible staging bind is unavailable, use only the positively identified Playwright runtime's supported copy-out path; do not guess a container.

If Playwright cannot produce a transferable file, use Chrome DevTools MCP as the backup. Prefer a focused viewport screenshot rather than a full-page screenshot so the returned image remains small while still showing complete proof. If Chrome DevTools cannot write directly to the final proof path but returns the PNG as image or base64 content, stream that base64 data through stdin in small chunks to a `base64 --decode` process writing the exact final proof file. Never put the complete base64 payload in a shell command argument or send it as one large terminal write. Use an explicit end marker, wait for the decoder to exit successfully, confirm the resulting file is non-empty and has a PNG signature, and inspect it from the final proof path. Delete any incomplete or uninspectable file and report failure honestly if a clean recapture and transfer does not succeed.

Return the tested environment to the state observed at the beginning of this step. If startup, browser access, capture, transfer, inspection, or cleanup fails, report the limitation honestly and do not create or preserve a misleading screenshot. Make no Jira call even when proof succeeds.
