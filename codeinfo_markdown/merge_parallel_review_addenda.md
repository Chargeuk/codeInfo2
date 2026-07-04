# Goal

Merge the additive outputs from the parallel visual-review, findings-saturation, and blind-spot-challenge subflows into the canonical findings artifact and shared review handoff.

This step is the single shared-output writer for the parallel review addenda flows that feed either the internal or external review path.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first and use only its `plan_path` and `additional_repositories` as the active review scope.
- Re-open the exact canonical plan from disk before mutating any review artifact.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and use it as the authoritative handoff for the current review cycle.
- Read the canonical findings artifact from the handoff's `findings_file`.
- Derive the expected additive artifact and sidecar paths from the handoff's `review_pass_id`.
- This step must not rediscover alternate review artifacts by timestamp.
- This step must not edit the canonical plan, code, tests, docs, or configuration.
- The only shared review outputs this step may update are the canonical findings artifact and `codeInfoTmp/reviews/<story-number>-current-review.json`.
- Treat missing additive artifacts as `no_op` only when the expected file path can be derived safely and the corresponding subflow was allowed to no-op.

</critical_rules>

<scope_rules>

Read all of the following from disk:

- the canonical plan from `plan_path`;
- the current review handoff;
- the canonical findings artifact referenced by `findings_file`;
- `codeInfoTmp/reviews/<review_pass_id>-visual-design-review.json` when present;
- `codeInfoTmp/reviews/<review_pass_id>-findings-saturation.json` when present;
- `codeInfoTmp/reviews/<review_pass_id>-blind-spot-challenge.json` when present;
- the matching markdown artifacts for those sidecars when present.

If a sidecar is missing, do not guess at an alternate file path. Use only the expected `<review_pass_id>`-derived path and treat the missing sidecar as `no_op` unless the surrounding evidence proves the subflow was incomplete.

</scope_rules>

<merge_rules>

- This step is the only owner allowed to update the canonical findings artifact after the parallel review addenda fan-out.
- Preserve the canonical findings artifact exactly unless an additive sidecar proposes a non-duplicate actionable finding or requires a rejected-risk-note strengthening that belongs in the canonical findings artifact.
- Deduplicate proposed findings conservatively. Treat two findings as duplicates when they describe the same core defect, same owner surface, and same corrective obligation in materially equivalent form.
- If a proposed finding duplicates an existing canonical finding, do not add it again. Record that duplicate handling in this step's response and preserve the existing canonical wording unless the new proposal is materially clearer without widening scope.
- Merge new findings into the canonical findings artifact in findings-first severity order while preserving existing sections such as `Rejected Risk Notes`, `Finding Saturation Seeds`, `Checked Defect Families`, and residual-risk notes.
- Preserve the base findings artifact as the canonical source for later disposition. The visual, saturation, and blind-spot artifacts remain additive evidence only.
- When one or more additive sidecars exist, update the shared review handoff exactly once after the merge decision is complete.
- When updating the handoff, preserve all existing top-level fields and every existing `repos[]` entry exactly unless this step explicitly owns the field being changed.
- This step owns only:
  - `findings_file`
  - findings counts or disposition hints that already belong to the findings owner path
  - `visual_review_file`
  - `visual_review_outcome`
  - `visual_review_generated_findings`
  - `saturation_file`
  - `saturation_outcome`
  - `saturation_generated_findings`
  - `challenge_file`
  - `challenge_outcome`
  - `challenge_generated_findings`

</merge_rules>

<output_contract>

- If one or more additive sidecars exist, inspect them and apply their non-duplicate findings to the canonical findings artifact when appropriate.
- If no additive sidecar exists, leave the findings artifact unchanged, leave the shared review handoff unchanged, and return only a concise no-op response.
- When the findings artifact changes, write the merged result back to the same `findings_file` path.
- When at least one additive sidecar exists, update the shared review handoff so it points to the additive artifact files and records whether each addendum generated findings.
- Report:
  - whether the canonical findings artifact changed;
  - which additive sidecars were consumed;
  - which findings were merged, deduplicated, or ignored;
  - and the final findings artifact path plus review handoff path.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before the review handoff.
- Confirm the canonical plan was re-opened from disk before any mutation.
- Confirm the handoff still points to a usable canonical findings artifact before merging.
- Confirm only the expected `<review_pass_id>`-derived additive paths were considered.
- Confirm duplicate findings were not added twice.
- Confirm the canonical findings artifact remained the only findings source rewritten by this step.
- Confirm the shared review handoff was updated at most once after all merge decisions were complete, and not at all when no additive sidecar existed.
- Confirm no `repos[]` comparison metadata changed.
- Confirm the final findings artifact and review handoff are valid and mutually consistent.

</verification_loop>
