# Blind-Spot Challenge: 0000052-review-20260327T235133Z-1c55020b

- Canonical plan path: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- Review handoff used: `codeInfoStatus/reviews/0000052-current-review.json`
- Review pass id: `0000052-review-20260327T235133Z-1c55020b`
- Challenge generated new findings: `false`

## Top-Risk Helpers Challenged

1. `executeReingestRequest(...)` in `server/src/ingest/reingestExecution.ts`
2. `resolvePlanScopeRepositories(...)` in `server/src/ingest/planScopeResolver.ts`
3. `getReingestPayload(...)` / `normalizeBatchWarnings(...)` in `server/src/chat/reingestStepLifecycle.ts`

## Challenge Results

### 1. `executeReingestRequest(...)`

- Contradictory input attempted:
  - A host `working_folder` path that would only succeed if the unchanged selector path still honors `hostPath`, combined with warning-aware `plan_scope` partial-failure handling.
- Evidence re-opened:
  - `server/src/ingest/reingestExecution.ts:372-514`
  - `server/src/mcpCommon/repositorySelector.ts:50-82`
  - `server/src/test/integration/commands.reingest.test.ts`
  - `server/src/test/unit/reingestExecution.test.ts:840-872`
- Result:
  - Strengthened rejected-risk conclusion.
- Why:
  - The pre-start validation still routes through `resolveRepositorySelector(...)`, and the unchanged selector still checks both normalized `containerPath` and normalized `hostPath`.
  - The runtime and test coverage still show ordered attempted repositories, warning counts, and partial-failure continuation without a late mismatch.

### 2. `resolvePlanScopeRepositories(...)`

- Contradictory input attempted:
  - Additional repository entries expressed with alternative path spellings or duplicate references that could bypass de-duplication if the helper compared raw input strings instead of the resolved canonical repository identity.
- Evidence re-opened:
  - `server/src/ingest/planScopeResolver.ts:97-312`
  - `server/src/mcpCommon/repositorySelector.ts:70-82`
  - `server/src/test/unit/planScopeResolver.test.ts`
  - `server/src/test/unit/reingestExecution.test.ts`
- Result:
  - Strengthened rejected-risk conclusion.
- Why:
  - The helper resolves additional entries through the selector layer and de-duplicates by normalized resolved `containerPath`, not by raw handoff string.
  - That keeps host-path/container-path aliases and repeated entries from turning into duplicate attempted repositories.

### 3. `getReingestPayload(...)` / `normalizeBatchWarnings(...)`

- Contradictory input attempted:
  - A persisted single-result payload with a malformed `targetMode` such as `plan_scope` or another unknown string, plus otherwise valid single-result fields, to see whether the reader rejects it, preserves the malformed value, or silently rewrites it into a canonical-looking selector result.
- Evidence re-opened:
  - `server/src/chat/reingestStepLifecycle.ts:270-304`
  - `server/src/test/unit/reingest-step-lifecycle.test.ts:680-826`
  - `codeInfoStatus/reviews/0000052-review-20260327T235133Z-1c55020b-findings.md`
- Result:
  - Strengthened existing finding, but produced no new finding.
- Why:
  - The batch-warning hardening is directly proven by the lifecycle tests.
  - The narrower single-result challenge still lands on the already-endorsed finding: malformed single-result `targetMode` values are coerced to `sourceId`, and there is still no direct test proving that path should be accepted or rejected.
  - This challenge confirms the finding is real, but it does not reveal an additional defect beyond the one already recorded.

## Outcome Summary

- New endorsed findings: none
- Rejected-risk conclusions strengthened:
  - `executeReingestRequest(...)`
  - `resolvePlanScopeRepositories(...)`
- Existing finding strengthened:
  - malformed single-result `targetMode` coercion in `getReingestPayload(...)`
- Residual weak proof:
  - unchanged wrapper/launcher reachability remains indirect because this challenge stayed scoped to helper semantics rather than rerunning wrappers
