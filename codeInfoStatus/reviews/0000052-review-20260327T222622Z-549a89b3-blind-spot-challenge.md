# Blind-Spot Challenge

- `plan_path`: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `review_handoff`: `codeInfoStatus/reviews/0000052-current-review.json`
- `review_pass_id`: `0000052-review-20260327T222622Z-549a89b3`
- `new_finding_generated`: `false`

## Challenged Top-Risk Helpers

1. `executeReingestRequest` in `server/src/ingest/reingestExecution.ts`
2. `resolvePlanScopeRepositories` in `server/src/ingest/planScopeResolver.ts`
3. `getReingestPayload` / `normalizeBatchWarnings` in `server/src/chat/reingestStepLifecycle.ts`

## Challenge Results

### 1. `executeReingestRequest`

- Contradictory input challenged:
  - a valid working repository;
  - a readable handoff that resolves working-first plus duplicates;
  - one later attempted repository that returns an ok-shaped terminal `error` or `cancelled` result.
- Focused question:
  - Could batch warning emission, attempted repository ordering, and summary accounting diverge once failures are normalized after an otherwise `ok` execution result?
- Outcome:
  - Strengthened rejected-risk conclusion.
- Why:
  - The execution path appends resolution warnings first, then normalizes each attempted repository into a repository outcome, then adds `repository_failed` warnings when the normalized outcome is `failed`, and finally computes the batch summary from the attempted repository list before returning the batch payload. The narrower challenge did not expose a path where a failed attempted repository disappears from the summary or where the batch stops early after a failure.
- Evidence used:
  - [reingestExecution.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestExecution.ts#L485)
  - [reingestExecution.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestExecution.ts#L501)
  - [reingestExecution.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestExecution.ts#L571)
  - [reingestExecution.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingestExecution.test.ts#L331)
  - [reingestExecution.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingestExecution.test.ts#L423)
  - [reingestExecution.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingestExecution.test.ts#L590)
  - [reingestExecution.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingestExecution.test.ts#L686)

### 2. `resolvePlanScopeRepositories`

- Contradictory input challenged:
  - a readable `current-plan.json` that contains unrelated handoff fields, empty `additional_repositories`, duplicate working-repository paths, and later an entirely invalid `additional_repositories` container.
- Focused question:
  - Could the resolver accidentally consume unrelated handoff fields, treat an empty additional-repository list as invalid, or partially append invalid scope instead of falling back cleanly?
- Outcome:
  - Strengthened rejected-risk conclusion.
- Why:
  - The resolver cleanly ignores unrelated fields, treats missing or empty `additional_repositories` as a clean working-only path, and upgrades only structurally unusable `additional_repositories` content to `handoff_invalid` working-only fallback. The narrower challenge matched the plan contract rather than exposing a hidden mixed-shape acceptance bug.
- Evidence used:
  - [planScopeResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/planScopeResolver.ts#L197)
  - [planScopeResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/planScopeResolver.ts#L218)
  - [planScopeResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/planScopeResolver.ts#L229)
  - [planScopeResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/planScopeResolver.ts#L247)
  - [planScopeResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/planScopeResolver.test.ts#L125)
  - [planScopeResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/planScopeResolver.test.ts#L169)
  - [planScopeResolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/planScopeResolver.test.ts#L252)

### 3. `getReingestPayload` / `normalizeBatchWarnings`

- Contradictory input challenged:
  - a historical persisted batch payload with `targetMode: "all"` plus either:
    - a warnings array containing future unknown warning codes; or
    - a non-array `warnings` container.
- Focused question:
  - Could the lifecycle normalization silently relabel malformed warning state as valid plan-scope warnings and make transcript-facing warning counts look cleaner than the underlying persisted payload really was?
- Outcome:
  - Residual weak proof only; no new finding.
- Why:
  - The unit coverage shows the reader explicitly normalizes `all` to `plan_scope`, drops malformed warning data instead of relabeling it, and emits the `DEV-0000052:T10:reingest-lifecycle-warning-dropped` log marker when it does so. That narrows the risk substantially. The remaining weak area is that this behavior is only directly proven through unit harnesses for malformed persisted payloads, not through an end-to-end transcript replay path with intentionally contradictory historical storage.
- Evidence used:
  - [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts#L154)
  - [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts#L205)
  - [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts#L541)
  - [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts#L590)
  - [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts#L643)
  - [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts#L745)

## Summary

- The blind-spot challenge stayed scoped to the evidence artifact's top-risk helpers/functions.
- No new finding was generated.
- The challenge strengthens the rejected-risk conclusions for `executeReingestRequest` and `resolvePlanScopeRepositories`.
- `getReingestPayload` / `normalizeBatchWarnings` remains a residual weak-proof area, but the narrower adversarial check did not produce a fresh defect beyond the findings already recorded for this pass.
