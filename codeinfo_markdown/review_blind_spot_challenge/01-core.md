# Goal

Run a focused blind-spot challenge after the findings pass and before disposition so a tentative no-findings conclusion gets one more adversarial check, while emitting additive outputs that a later merge step can apply safely.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` first, derive the canonical `plan_path`, and re-open that exact plan from disk.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and use only the artifacts referenced there.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated.
- Interpret the review handoff semantically instead of as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the evidence, findings, optional saturation artifact, current-plan handoff, and direct git state to infer the safest usable meaning.
- If the review handoff cannot provide the minimum usable findings/rejected-risk context and repository scope even after safe inference, write a visible incomplete challenge outcome when enough path information exists and do not ask for repeated regeneration.
- This step does not edit the canonical plan.
- This step does not replace the findings pass. It either strengthens confidence in a no-findings conclusion or produces late findings that the disposition step must honor.
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
- the saturation artifact referenced by that handoff when `saturation_file` is present.

Prefer the review handoff's stored local-HEAD-vs-resolved-base comparison metadata, including `comparison_base_commit`, as already resolved evidence. If some metadata is absent, infer only what is needed from the evidence artifact and git state, record that inference in the challenge artifact when it affects confidence, and do not replace local `HEAD` with `origin/<current-story-branch>`. If any repository used or appears to have used `resolved_base_source: local_fallback`, keep that residual-risk context visible in the challenge artifact when it affects the blind-spot conclusion.

Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. Make one best-effort interpretation from the existing handoff, referenced artifacts, and git state.

Treat the evidence artifact's `Risk-Invariant Matrix`, the findings artifact's `Rejected Risk Notes`, and any saturation artifact's sibling-scan outcome as the primary input set for this challenge when those artifacts are already present. This step must still remain correct when the saturation artifact is absent because parallel review addenda may still be running.

For every changed runtime file outside the allowed support-file set, run at least one changed-hunk contradiction pass that asks whether the exact edit can:

- drop preserved state or identifiers during rebuild or normalization;
- crash on malformed or partial config instead of degrading safely;
- break shell, startup, or runtime portability assumptions;
- mislabel diagnostics so operators are pointed at the wrong failure class;
- add eager optional-dependency work or failure surfaces where lazy evaluation would preserve current behavior.

</scope_rules>

<output_contract>

Write the challenge result to `codeInfoTmp/reviews/<review_pass_id>-blind-spot-challenge.md`.
Write a machine-readable sidecar to `codeInfoTmp/reviews/<review_pass_id>-blind-spot-challenge.json`.

The challenge artifact MUST include:

- the canonical `plan_path`;
- the review handoff path used;
- the top-risk helpers/functions challenged;
- which changed runtime files received a changed-hunk contradiction pass;
- for each challenge, the contradictory input or semantic mismatch attempted;
- whether the challenge produced a new finding, strengthened a rejected-risk note, or left residual weak proof;
- exact file references for the evidence used.

- The JSON sidecar must include:
  - `review_pass_id`
  - `status: "complete" | "no_op" | "incomplete"`
  - `generated_findings: true|false`
  - `proposed_findings`
  - `rejected_risk_note_updates`
  - `evidence_refs`
  - `source_artifact`

Do not update the findings artifact in place in this step.

Do not update the current review handoff in this step.

This artifact is additive context for later merge and disposition. Downstream steps must still work when it is absent because an older flow snapshot may still be running.

- Report the challenge artifact path, the challenge sidecar path, and whether the challenge generated any new findings.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff still matches the canonical plan and story branch.
- Confirm the review handoff still matches the current scope and referenced artifacts.
- Confirm that any safely inferred comparison context is documented in the challenge artifact when it affects confidence.
- Confirm the challenge consumed the saturation artifact when it was present, and still remained backward-compatible when it was absent.
- Confirm the challenge inspected the top-risk helpers/functions rather than restarting the entire review.
- Confirm every changed runtime file outside the allowed support-file set received at least one changed-hunk contradiction pass covering state loss, malformed config, portability, diagnostics labeling, or eager optional-dependency work.
- Confirm the challenge artifact and sidecar paths match each other and share the same `review_pass_id`.
- Confirm the artifact explicitly says whether any new finding was generated.
- Confirm the findings artifact still remains the canonical endorsed-findings source until a later merge step runs.
- Confirm the challenge artifact and sidecar only add proposed findings or rejected-risk-note updates for the later merge step.

</verification_loop>
