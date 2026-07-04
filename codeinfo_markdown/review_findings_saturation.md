# Goal

Run a bounded same-class sibling scan after the findings pass and before the blind-spot challenge so the review is less likely to miss nearby defects that later passes would rediscover, while emitting additive outputs that a later merge step can apply safely.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` first, derive the canonical `plan_path`, and re-open that exact plan from disk.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and use only the artifacts referenced there.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated.
- Interpret the review handoff semantically instead of as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the evidence and findings artifacts, current-plan handoff, and direct git state to infer the safest usable meaning.
- If the review handoff cannot provide the minimum usable findings and repository scope even after safe inference, write a visible incomplete saturation outcome when enough path information exists and do not ask for repeated regeneration.
- This step does not edit the canonical plan.
- This step does not replace the findings pass. It expands the same findings outcome across bounded sibling surfaces before blind-spot challenge and disposition continue.
- Keep the sibling scan bounded to the same repository unless a finding is already cross-repository.
- Do not broaden into unrelated archaeology. Check only the same changed seam, obvious mirrored producers or consumers, lifecycle-adjacent surfaces, retained proof-owner chains, and directly comparable support-file families.
- This step must not update the canonical findings artifact in place.
- This step must not update `codeInfoTmp/reviews/<story-number>-current-review.json` directly.
- This step may write only its own additive artifact files for a later merge step.

</critical_rules>

<scope_rules>

Read all of the following from disk:

- the canonical plan from `plan_path`;
- the current review handoff;
- the evidence artifact referenced by that handoff;
- the findings artifact referenced by that handoff.

If the review handoff includes `external_review_input_file`, treat it only as additive context already filtered by the findings pass; the findings artifact remains the canonical endorsed-findings source.

Prefer the review handoff's stored local-HEAD-vs-resolved-base comparison metadata, including `comparison_base_commit`, as already resolved evidence. If some metadata is absent, infer only what is needed from the evidence artifact and git state, record that inference in the saturation artifact when it affects confidence, and do not replace local `HEAD` with `origin/<current-story-branch>`. If any repository used or appears to have used `resolved_base_source: local_fallback`, keep that residual-risk context visible in the saturation artifact when it affects the sibling scan.

Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. Make one best-effort interpretation from the existing handoff, referenced artifacts, and git state.

Treat the findings artifact's actionable findings, `Finding Saturation Seeds`, `Checked Defect Families`, and `Rejected Risk Notes` as the primary input set for this step.

For each actionable finding, inspect only bounded same-class sibling surfaces such as:

- the same producer and changed consumer pair;
- the same persisted-artifact family and its reader or cleanup owner;
- lifecycle-adjacent transitions in the same orchestration seam;
- the retained proof-owner or summary-maintenance chain for the same contract;
- the same support-file family when the finding is an allowed hygiene or wording issue.

</scope_rules>

<output_contract>

Write the saturation result to `codeInfoTmp/reviews/<review_pass_id>-findings-saturation.md`.
Write a machine-readable sidecar to `codeInfoTmp/reviews/<review_pass_id>-findings-saturation.json`.

The saturation artifact MUST include:

- the canonical `plan_path`;
- the review handoff path used;
- for each actionable finding:
  - the defect class;
  - the sibling surfaces checked;
  - the sibling sites ruled out;
  - whether additional same-class findings were promoted;
  - or whether the original finding remained isolated after the bounded scan;
- when no actionable findings existed, the defect families checked and whether the no-findings conclusion remained intact;
- exact file references for the sibling-scan evidence used.

- The JSON sidecar must include:
  - `review_pass_id`
  - `status: "complete" | "no_op" | "incomplete"`
  - `generated_findings: true|false`
  - `proposed_findings`
  - `sibling_surfaces_checked`
  - `evidence_refs`
  - `source_artifact`

Do not update the findings artifact in place in this step.

Do not update the current review handoff in this step.

This artifact is additive context for later blind-spot challenge and disposition. Downstream steps must still work when it is absent because an older flow snapshot may still be running.

- Report the saturation artifact path, the saturation sidecar path, and whether the saturation pass generated any new actionable findings.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff still matches the canonical plan and story branch.
- Confirm the review handoff still matches the current scope and referenced artifacts.
- Confirm that any safely inferred comparison context is documented in the saturation artifact when it affects confidence.
- Confirm the bounded sibling scan inspected same-class surfaces instead of restarting the whole review.
- Confirm the saturation artifact and sidecar paths match each other and share the same `review_pass_id`.
- Confirm the artifact explicitly says whether any new actionable finding was generated.
- Confirm the findings artifact still remains the canonical endorsed-findings source until a later merge step runs.
- Confirm the saturation artifact and sidecar only add checked-sibling evidence and proposed findings for the later merge step.

</verification_loop>
