# Blind-spot Challenge

Reviewed HEAD: `9dba5908242576d7c31ba79945ded296978a9f20`
Comparison base: `0b436f8c792e5041105aaf4541d1e8cb58245d63`
Scope: the story-55 repair commit and the new proof around GitHub warning completion and script-failure provenance, with emphasis on the warning lifecycle paths in [`server/src/flows/service.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and the added regression tests in [`server/src/test/integration/flows.run.basic.test.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) and [`server/src/test/integration/flows.run.errors.test.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts).

## Findings

### Medium - warning still collapses to `ok` on the non-persisted lifecycle paths

- Evidence:
  - [`server/src/flows/service.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts#L3679-L3682) still normalizes any assistant `warning` turn to `ok` in `normalizeFlowChildTurnStatus()`.
  - [`server/src/flows/service.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts#L13386-L13396) still maps a latest assistant `warning` to `ok` in `getFlowRunStatus()` when no persisted `runLifecycle` is available.
  - The new proof in [`server/src/test/integration/flows.run.basic.test.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts#L2943-L3093) only exercises the persisted warning path. It does not cover the turn-only fallback that these helpers still use.
- Why it matters:
  - The commit advertises warning as a terminal flow state, but these two fallback branches still erase that state. A warning can therefore be reported as `ok` for legacy, replayed, or not-yet-persisted lifecycle reads, and parent subflow status resolution can also miss the warning when it has to infer from turns.
  - That leaves the new behavior only partially durable, which is exactly the kind of blind spot the added review proof should have ruled out.

## Residual Risk

- I did not run the server wrappers or the full automated suite in this review pass.
- The review proof in the planning file still only demonstrates one direct warning scenario and one parent-subflow scenario; the other warning-producing branches in `server/src/flows/service.ts` remain unproven by targeted regression coverage.
