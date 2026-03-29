## Task

Run a focused blind-spot challenge after the findings pass and before disposition. This step exists to break a tentative no-findings conclusion by re-checking only the highest-risk helpers/functions from the evidence artifact.

## Critical Rules

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` first, derive the canonical `plan_path`, and re-open that exact plan from disk.
- Then read `codeInfoStatus/reviews/<story-number>-current-review.json` from disk and use only the artifacts referenced there.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated.
- If the review handoff is stale or incomplete, stop and say the review handoff is stale and must be regenerated.
- This step does not edit the canonical plan.
- This step does not replace the findings pass. It either strengthens confidence in a no-findings conclusion or produces late findings that the disposition step must honor.

## Scope And Inputs

Read all of the following from disk:

- the canonical plan from `plan_path`;
- the current review handoff;
- the evidence artifact referenced by that handoff;
- the findings artifact referenced by that handoff.

Treat the evidence artifact's `Risk-Invariant Matrix` and the findings artifact's `Rejected Risk Notes` as the primary input set for this challenge.

## Exact Review Pass

1. Re-validate the current-plan scope and review handoff against the current repository state.
2. Re-open the evidence artifact's `Risk-Invariant Matrix` and identify the highest-risk helpers/functions and contradictory inputs or states recorded there.
3. Re-open the findings artifact and inspect the current findings list plus `Rejected Risk Notes`.
4. For each top-risk helper/function, attempt one more focused semantic challenge that is narrower and more adversarial than the general findings pass. Prefer edge conditions that could make a tentative no-findings conclusion wrong, especially disabled-or-hidden stale UI state, create-vs-reuse or run-vs-resume mode mismatches, and changed tests whose titles may no longer match their assertions.
5. Inspect one additional changed non-helper file, if present, for a low-risk consistency or portability defect that would not naturally appear in the risk matrix. Prefer changed `README.md` or `docs/**` links, duplicated literals that should reuse a nearby canonical constant, or changed test-support mocks that accept cancellation inputs.
6. For one changed orchestration function, attempt a focused failure-ordering challenge: assume the external provider, model bootstrap, or dispatcher setup fails before any real work begins, and verify whether a no-op, metadata-only, delete-only, or zero-work fast path would still complete correctly. Prefer paths where the existing tests prove terminal status semantics but do not explicitly prove behavior under provider or bootstrap failure.
7. For one changed producer-consumer error path, attempt a wrapped-error mismatch challenge: assume the lower layer now emits a normalized or provider-specific error instead of the old raw SDK error shape, and verify whether the caller still reaches the correct cancel, retry, ignore, or terminal branch.
8. For each challenge, decide whether it:
   - creates a new endorsed finding;
   - strengthens a rejected-risk conclusion;
   - or leaves only residual weak proof.
9. Keep the output tightly scoped to those top-risk helpers/functions plus the one extra non-helper consistency or portability challenge, the one failure-ordering challenge, and the wrapped-error mismatch challenge. Do not restart the whole review.

## Output Contract

Write the challenge result to `codeInfoStatus/reviews/<review_pass_id>-blind-spot-challenge.md`.

The challenge artifact MUST include:

- the canonical `plan_path`;
- the review handoff path used;
- the top-risk helpers/functions challenged;
- for each challenge, the contradictory input or semantic mismatch attempted;
- whether the challenge produced a new finding, strengthened a rejected-risk note, or left residual weak proof;
- exact file references for the evidence used.

If the challenge produces any new finding, update the same review handoff so it includes:

- `challenge_file`
- `challenge_outcome`
- `challenge_generated_findings: true`

If the challenge produces no new finding, update the same review handoff so it includes:

- `challenge_file`
- `challenge_outcome`
- `challenge_generated_findings: false`

This artifact is additive context for disposition. Downstream steps must still work when it is absent because an older flow snapshot may still be running.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff still matches the canonical plan and story branch;
- the review handoff still matches the current scope and referenced artifacts;
- the challenge inspected the top-risk helpers/functions rather than restarting the entire review;
- the challenge artifact path matches the `challenge_file` value written into the handoff;
- the artifact explicitly says whether any new finding was generated.

## Final Response

Report the challenge artifact path and whether the challenge generated any new findings.
