# Goal

Run a focused blind-spot challenge after the findings pass and before disposition so a tentative no-findings conclusion gets one more adversarial check.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json`, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-findings` for fresh story scope and the compact task index.
- When a challenge depends on a task-specific promise, request only that task's relevant named sections with `plan_sections.py --task-number <number>`.
- After deriving the story number from that canonical `plan_path`, check for `codeInfoTmp/reviews/<story-number>-current-review-base.json`. When it exists, preserve that artifact's current-repository comparison metadata as authoritative context for this challenge.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and use only the artifacts referenced there.
- Require exact equality with the prepared base for canonical seven-digit `story_id`, `plan_path`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `head_commit`, and `comparison_base_commit`. Never infer or normalize these identity fields.
- Re-check the active session before atomically updating the stable pointer. Stop rather than overwriting a newer session.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated.
- Interpret optional descriptive metadata semantically when needed, but never infer or repair story/session/pass/HEAD/base identity.
- If the review handoff cannot provide the required identity directly, or cannot provide the remaining findings/rejected-risk context and repository scope after descriptive-only inference, write a visible incomplete challenge outcome when enough path information exists and do not ask for repeated regeneration.
- This step does not edit the canonical plan.
- This step does not replace the findings pass. It either strengthens confidence in a no-findings conclusion or produces late findings that the disposition step must honor.

</critical_rules>

<scope_rules>

Read all of the following from disk:

- the bounded review-findings packet for the canonical `plan_path`;
- the current review handoff;
- the evidence artifact referenced by that handoff;
- the findings artifact referenced by that handoff.
- the saturation artifact referenced by that handoff when `saturation_file` is present.

Prefer the review handoff's stored local-HEAD-vs-resolved-base comparison metadata, including `comparison_base_commit`, as already resolved evidence. When the prepared current-repository review-base artifact exists, preserve it as the authoritative source for the current repository. Never infer, normalize, or repair an identity field or prepared base, including `story_id`, review session, review pass, parent execution, `head_commit`, or `comparison_base_commit`. If optional descriptive metadata is absent, infer only descriptive remote/fallback context, record that inference in the challenge artifact when it affects confidence, and do not replace the stored local head with `origin/<current-story-branch>`. If any repository used or appears to have used `resolved_base_source: local_fallback`, keep that residual-risk context visible in the challenge artifact when it affects the blind-spot conclusion.

Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. Make one best-effort interpretation from the existing handoff, referenced artifacts, and git state.

Treat the evidence artifact's `Risk-Invariant Matrix`, the findings artifact's `Rejected Risk Notes`, and any saturation artifact's sibling-scan outcome as the primary input set for this challenge.

For every changed runtime file outside the allowed support-file set, run at least one changed-hunk contradiction pass that asks whether the exact edit can:

- drop preserved state or identifiers during rebuild or normalization;
- crash on malformed or partial config instead of degrading safely;
- break shell, startup, or runtime portability assumptions;
- mislabel diagnostics so operators are pointed at the wrong failure class;
- add eager optional-dependency work or failure surfaces where lazy evaluation would preserve current behavior.

</scope_rules>

<output_contract>

Write the challenge result to `codeInfoTmp/reviews/<review_pass_id>-blind-spot-challenge.md`.

The challenge artifact MUST include:

- the canonical `plan_path`;
- the review handoff path used;
- the top-risk helpers/functions challenged;
- which changed runtime files received a changed-hunk contradiction pass;
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

When updating the handoff for challenge results, preserve all existing top-level fields and every existing `repos[]` entry exactly unless this step explicitly owns the field being changed. Only add or update the challenge-owned fields listed above.

This artifact is additive context for disposition. Downstream steps must still work when it is absent because an older flow snapshot may still be running.

- Report the challenge artifact path and whether the challenge generated any new findings.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff still matches the canonical plan and story branch.
- Confirm the review handoff still matches the current scope and referenced artifacts.
- Confirm the review handoff still preserves existing repository comparison identity after this step's update, and that any safely inferred descriptive remote/fallback context is documented in the challenge artifact when it affects confidence.
- Confirm the challenge consumed the saturation artifact when it was present, and still remained backward-compatible when it was absent.
- Confirm the challenge inspected the top-risk helpers/functions rather than restarting the entire review.
- Confirm every changed runtime file outside the allowed support-file set received at least one changed-hunk contradiction pass covering state loss, malformed config, portability, diagnostics labeling, or eager optional-dependency work.
- Confirm the challenge artifact path matches the `challenge_file` value written into the handoff.
- Confirm the artifact explicitly says whether any new finding was generated.

</verification_loop>
