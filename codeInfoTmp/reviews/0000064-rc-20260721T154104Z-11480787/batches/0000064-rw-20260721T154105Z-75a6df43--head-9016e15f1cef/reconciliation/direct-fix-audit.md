# Direct-fix audit

## Batch identity

- Story: `0000064`
- Review cycle: `0000064-rc-20260721T154104Z-11480787`
- Review batch: `0000064-rw-20260721T154105Z-75a6df43`
- Reviewed HEAD: `9016e15f1ceff4991d4ecdc7808392e3d8eb1425`
- Disposition: `reconciliation/batch-disposition.md`

## Completed safe direct fixes

### R-1 — Resume-state parser receives the nested flow object

- Outcome: resolved.
- Changed files: `server/src/flows/service.ts`; `server/src/test/integration/flows.run.subflow.test.ts`.
- Repair: all three affected callers now pass the complete conversation flags wrapper to `parseFlowResumeState`, preserving interrupted-child detection, retry-ownership state preservation, and failure-lifecycle persistence.
- Focused proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` passed: 39 tests, 0 failures. The suite includes stale-terminal interrupted-child reattachment and failed lifecycle-state persistence coverage.

### R-2 — Explicit rewind preserves stale terminal and restart metadata

- Outcome: resolved.
- Changed files: `server/src/flows/service.ts`; `server/src/test/integration/flows.run.subflow.test.ts`.
- Repair: explicit rewind now clears `terminalOutcome` and `restartReconciliation` together with stale active-child and wave tracking, so the resumed execution starts without a prior terminal or recovery classification.
- Focused proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts` passed: 39 tests, 0 failures. The rewind regression starts with `not_applicable` terminal and interrupted restart metadata and asserts both are absent after fresh completion.

## Commits and residuals

- Direct-fix commit: `e2bf5cf8951bb1586d7645e1fac473e30bcdcf97` (`DEV-[64] - Repair review batch lifecycle state`).
- Unresolved accepted findings: none. No task-required findings were created, reclassified, or discarded.
- Another review of the new committed HEAD is useful: yes. The original batch was not clean, both direct fixes changed runtime lifecycle behavior, and the next immutable HEAD should be reviewed by the normal batch flow.
