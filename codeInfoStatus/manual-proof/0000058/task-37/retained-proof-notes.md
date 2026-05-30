# Story 0000058 Task 37 Retained Proof Notes

- Review pass: `0000058-20260525T060243Z-e4ce8252`
- Review cycle: `0000058-rc-20260525T082128Z-2279fe86`
- Repository scope: current repository only
- Final revalidation owner: `Task 37. Re-Validate Story 58 After Review Pass \`0000058-20260525T060243Z-e4ce8252\``

## Proof Chain

- The durable proof chain must point at repository-owned desktop and mobile retained artifacts under `codeInfoStatus/manual-proof/0000058/`.
- Scratch staging under `codeInfoTmp/manual-testing/0000058/37/` is transient only and does not count as final Story 58 proof by itself.
- Final closeout proof should keep the curated retained artifacts separate from the browser-run stdout summaries and from any scratch-only staging directory.

## Supported Stack Handoff

- Wrapper-owned startup path: `npm run compose:build` followed by `npm run compose:up`, and later `npm run compose:down`.
- Checked-in compose env files: `server/.env`, `server/.env.local`, `client/.env`, and `client/.env.local`.
- Expected readiness check: `http://localhost:5010/health`.
- User-facing proof surface: `http://localhost:5001`.
- Mounted manual agent catalogs:
  - `manual_testing/codeinfo_agents -> /app/codeinfo_agents`
  - `manual_testing/codex_agents -> /app/codex_agents`
- Read-only ingest namespace: `${CODEINFO_HOST_INGEST_DIR:-/tmp} -> /data`
- Retained artifact destination: `codeInfoStatus/manual-proof/0000058/`

## Notes

- The broad revalidation task must keep the current-repository-only applicability decision intact.
- The refreshed visual proof, when captured, should be promoted from scratch staging into the durable retained-proof tree rather than left only under the task-scoped manual-testing directory.
