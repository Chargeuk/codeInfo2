# Blind-Spot Challenge: 0000052-review-20260328T010630Z-c39e2618

- Canonical plan: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- Review handoff used: `codeInfoStatus/reviews/0000052-current-review.json`
- Challenge outcome: no new findings

## Challenged Helpers / Functions

- `executeReingestRequest(...)` in `server/src/ingest/reingestExecution.ts`
- `resolvePlanScopeRepositories(...)` in `server/src/ingest/planScopeResolver.ts`
- `getReingestPayload(...)` / `normalizeLegacySingleTargetMode(...)` in `server/src/chat/reingestStepLifecycle.ts`

## Focused Challenges

### `executeReingestRequest(...)`

- Contradictory input or semantic mismatch attempted:
  - A `plan_scope` batch where the working repository is valid, the resolver has already produced an ordered repository list, one repository returns an ok-shaped terminal failure, and a later repository throws an unexpected exception. The challenge was whether the shared batch seam could still preserve earlier outcomes, append warnings for both failure shapes, and return one coherent completed batch instead of aborting or dropping the earlier result.
- Result:
  - strengthened rejected-risk conclusion
- Evidence used:
  - `server/src/ingest/reingestExecution.ts` catches both structured error returns and thrown exceptions inside the per-repository loop, normalizes both to failed outcomes, appends `repository_failed` warnings, and keeps iterating.
  - `server/src/test/unit/reingestExecution.test.ts` directly covers continue-after-failure behavior and ok-shaped terminal error/cancelled cases.
  - `server/src/test/integration/commands.reingest.test.ts` and `server/src/test/integration/flows.run.command.test.ts` show the warning-aware batch behavior on real command and flow surfaces.
- Challenge disposition:
  - no new finding

### `resolvePlanScopeRepositories(...)`

- Contradictory input or semantic mismatch attempted:
  - A handoff whose additional repository list names the same repository through different path spellings or path domains, such as the working repository appearing once as a host path and once as the mapped container path, or an additional repository appearing once with a trailing slash and once without. The challenge was whether deduplication happens on the canonical resolved repository identity rather than the raw handoff text.
- Result:
  - strengthened rejected-risk conclusion
- Evidence used:
  - `server/src/ingest/planScopeResolver.ts` resolves each additional entry through `resolveWorkingFolderWorkingDirectory(...)` and then through `resolveRepositorySelector(...)`, deduplicating on the normalized resolved repository container path rather than the raw entry text.
  - `server/src/test/unit/planScopeResolver.test.ts` directly covers first-seen ordering and duplicate working/additional repository handling.
  - `server/src/test/unit/reingestExecution.test.ts` carries that deduped ordering into the execution layer.
- Challenge disposition:
  - no new finding

### `getReingestPayload(...)` / `normalizeLegacySingleTargetMode(...)`

- Contradictory input or semantic mismatch attempted:
  - A mixed-shape persisted single-result payload with a valid `sourceId`, a malformed future `targetMode`, and otherwise plausible fields such as `requestedSelector`, `status`, and `runId`. The challenge was whether the lifecycle reader could still accidentally reinterpret that record as a canonical `sourceId` success instead of dropping back to generic lifecycle text.
- Result:
  - strengthened rejected-risk conclusion
- Evidence used:
  - `server/src/chat/reingestStepLifecycle.ts` now routes unknown single-result `targetMode` values through `normalizeLegacySingleTargetMode(...)`, which returns `null` for unsupported values and causes `getReingestPayload(...)` to reject the structured payload path entirely.
  - `server/src/test/unit/reingest-step-lifecycle.test.ts` directly covers legacy `current`, omitted historical target modes, and malformed `future_mode` behavior.
- Challenge disposition:
  - no new finding

## Residual Weak Proof

- `current-plan.json` partial-write tolerance remains a residual weak-proof area rather than a new finding. The challenged code still treats malformed or unreadable handoffs as working-only fallback, which matches the planned contract, but this pass still has only indirect proof for a concurrent truncate-and-rewrite race.
