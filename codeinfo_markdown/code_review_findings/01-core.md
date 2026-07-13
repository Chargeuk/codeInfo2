# Goal

Continue the current story review using ONLY the stored review handoff, perform the findings pass for every repository in review scope, and produce findings only.

<critical_rules>

- Do NOT discover the latest review artifact by timestamp.
- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json`, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-findings`. Use its repository scope, story contract, available headings, and compact task index as the initial plan context.
- When a changed file, finding, repository, or behavior seam needs detailed task requirements, use the task index to run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --task-number <number> --section Overview --section "Task Exit Criteria" --section Subtasks --section Testing`. Request another named section only when that review decision genuinely requires it.
- After deriving the shared story number from that canonical `plan_path`, check for `codeInfoTmp/reviews/<story-number>-current-review-base.json`. When it exists, treat it as the authoritative current-repository comparison contract for this pass and do not re-fetch or recompute the current repository base branch.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then re-read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit the plan.
- Interpret the review handoff semantically instead of as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the evidence artifact, current-plan handoff, referenced artifacts, and direct git state to infer the safest usable meaning.
- If the handoff and artifacts still cannot provide the minimum context needed to review, produce a visible incomplete-review findings artifact or summary when enough path information exists, do not edit the plan, and do not claim that no findings exist.
- If the handoff is usable directly or by safe inference, perform the actual review against the planned work and the branch diff for every repository in scope.
- If the active plan explicitly names design-target assets intended as implementation references, identify whether design-conformance review is relevant and whether the active review context includes usable retained screenshots and named design assets. Leave screenshot-to-design mismatch finding generation to `"$CODEINFO_ROOT/codeinfo_markdown/review_visual_design_conformance.md"`.
- If the active plan explicitly names design-target assets intended as implementation references, treat the current task's explicit subtasks and task-level requirements as the immediate visual-review contract first, then use the story plan or `Design Contract`, then paired design markdown, then the supporting visual asset as fallbacks when the task is silent.
- This step MUST produce findings or a visible incomplete-review outcome only, and MUST NOT edit the plan yet.
- Do not commit scratch review artifacts in this step. Only commit if a separate tracked repository change is genuinely required to repair the workflow state.
- Treat `flows/**` as approved workflow-support paths. Do not raise findings solely because those paths changed without being named in the active plan, but continue to review them normally for workflow semantics, instruction safety, stale-handoff handling, commit/push behavior, plan-selection rules, and other agent-control correctness.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not raise findings solely because those allowed support files changed without being named in the active plan.
- Do not raise a finding solely because a non-support file changed outside the active plan when the evidence and direct diff inspection show that change is formatting-only spillover with no semantic effect.
- Still review formatting-only spillover for hygiene, secrets, tracked-artifact mistakes, and misclassification. If the diff is mixed or appears to change behavior, configuration meaning, proof meaning, or workflow semantics, review it normally and do not treat it as formatting-only spillover.
- For those allowed support files, default to spelling, grammar, and obvious wording review, but still raise findings for:
  - hard-coded secrets, tokens, credentials, or API keys;
  - tracked files that live under ignored paths;
  - checked-in local config that should remain template-only;
  - tracked temp, generated, or runtime artifact directories.
- Do NOT raise findings about scope creep, unwanted changes, workflow semantics, path usage, plan-selection rules, or revert recommendations for allowed support files unless the issue is one of those explicit hygiene or secret cases.
- When formatting-only spillover exists, you may note it briefly in residual-risk or rejected-risk notes for transparency, but do not convert it into a scope-creep, unwanted-change, or revert-oriented finding by itself.

</critical_rules>

<finding_taxonomy_rules>

- For every actionable finding, include one structured `Scope Impact: <value>` line whenever possible.
- Valid `Scope Impact` values are:
  - `behavioral_regression`
  - `correctness_bug`
  - `proof_gap`
  - `cleanup_preference`
  - `unknown_scope_impact`
- If the reviewer cannot determine a valid value safely, prefer `Scope Impact: unknown_scope_impact` rather than failing the review.
- Downstream review steps must treat missing, malformed, or unrecognized `Scope Impact` values as `unknown_scope_impact` and continue; they must not stop, suppress the finding, or close the review because of that metadata problem.
- `cleanup_preference` means portability, template-safety, or contract neatness concern without a reproduced user-visible, runtime, or operational failure on the current head.
- Do not raise a `cleanup_preference` finding as `must_fix` or `should_fix` unless at least one of these is true:
  - the active story explicitly asked for that cleanup;
  - the current head is already broken because of the issue;
  - the user has explicitly approved that scope expansion.
- When a finding touches `.env*`, `docker-compose*`, startup env loaders, entrypoints, mounted-path mapping, or working-folder selection surfaces, compare the current known-working behavior before recommending a behavior-changing cleanup.
- If the current behavior is known to work and the review concern is only portability or neatness, prefer `optional_simplification` plus `Scope Impact: cleanup_preference`, or record the concern as a rejected-risk note instead of reopening the story.
- If the active plan explicitly names design-target assets intended as implementation references, treat material design-contract mismatch and screenshot-comparison proof gaps as actionable only through `"$CODEINFO_ROOT/codeinfo_markdown/review_visual_design_conformance.md"` when that step activates.
- Do not treat a lower-precedence design-source mismatch as actionable when an explicit current-task requirement clearly and specifically answers that disputed point in a way that supports the implementation on that same point. Broad or underspecified task wording is not enough to suppress the mismatch.
- Do not raise a review finding solely because screenshots are absent. The manual-testing pass owns the attempt to capture them first.

</finding_taxonomy_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.
- Read `codeInfoTmp/reviews/<story-number>-current-review.json` and identify the minimum usable review context either from named handoff fields or by safe inference from the handoff path, canonical `plan_path`, artifact filenames, artifact content, and current git state:
  - the story identifier matches the story number derived from the canonical current-plan `plan_path` filename;
  - the review pass identifier can be identified or safely inferred;
  - the evidence artifact can be identified and exists;
  - its `repos` entries, combined with current git state, identify the selected repositories, current branch names, and current local `HEAD` commits;
  - each repository has either a stored `comparison_base_commit`, a stored `comparison_base_ref` or `resolved_base_branch` that can be resolved safely, or enough evidence summary detail to infer the review base without guessing.
- Prefer each stored `comparison_base_commit` as the pinned base object for review diffs when it resolves to a commit object. If it is missing but `comparison_base_ref`, `resolved_base_branch`, or the evidence summary identifies the base clearly, resolve that base once, record the inference in the findings artifact, and use it for this pass.
- For the current repository, prefer the prepared review-base artifact when it exists and preserve its `comparison_base_ref` and `comparison_base_commit` unchanged through this step.
- Treat a stored or inferred `comparison_head_ref` as local `HEAD`. Review the local working branch against the stored or inferred comparison base, and do not compare `origin/<current-story-branch>` against the base.
- Treat `remote_name`, `remote_fetch_status`, `resolved_base_source`, `local_fallback_reason`, `remote_fetch_error`, and `remote_fetch_exit_code` as useful evidence when present. Do not fail only because those fields are absent, older, or differently shaped; instead preserve or infer the relevant remote-vs-local fallback context when it affects confidence.
- If `remote_fetch_error` is present, do not repeat raw error text into new artifacts unless it is already sanitized or can be safely categorized without credentials, userinfo, access tokens, or query strings.
- If any repository used or appears to have used a local fallback base, preserve that fact in the findings artifact's residual-risk or rejected-risk notes so the review does not silently imply it used a fresh remote base.
- Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. Make one best-effort interpretation from the existing handoff, referenced artifacts, and git state; if the minimum review context still cannot be determined, leave a visible incomplete-review outcome instead of looping or claiming success.

</scope_rules>

<validation_rules>

Before doing findings work, validate all of the following:

- the canonical plan exists;
- the current repository branch state still matches the canonical plan story number;
- every repository in scope is still on a branch whose story number matches the canonical plan filename;
- every additional repository branch state was re-checked directly from git;
- the current repository HEAD and each additional repository HEAD were re-checked directly from git;
- the review handoff, after safe inference from referenced artifacts when needed, still describes the normalized current-plan scope and current repository state well enough to review.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review handoff cannot provide the minimum usable review context even after safe inference, do not ask for regeneration in a loop. Produce a visible incomplete-review outcome when possible, and do not claim that the review found no issues.

</validation_rules>

<output_contract>

When the minimum review context is available directly or by safe inference, write the findings to `codeInfoTmp/reviews/<review_pass_id>-findings.md`. When the minimum review context is not available but a safe artifact path can still be determined, write an incomplete-review findings artifact at that path instead and make clear that the review did not conclude no-findings.

The findings file or incomplete-review artifact MUST:

- use findings-first ordering by severity when findings can be produced;
- include file references;
- classify each finding as `must_fix`, `should_fix`, or `optional_simplification` when findings can be produced;
- state for each finding whether it is a `plan_contract_issue` or a `generic_engineering_issue` when findings can be produced;
- state each finding's `Scope Impact` using the taxonomy above when findings can be produced; if the value is missing or unclear, use `unknown_scope_impact` or omit it and continue the review rather than failing;
- identify the affected repository scope for every finding or incomplete-review blocker using the reviewed repository roots or aliases when available;
- for every `must_fix` or `should_fix` finding, name the defect class and the most likely same-class sibling surfaces that should be checked next, or state explicitly why no meaningful sibling surface exists for that finding;
- when the active plan explicitly names design-target assets intended as implementation references, the findings artifact must reflect any actionable visual mismatch or screenshot-comparison proof gap added by `"$CODEINFO_ROOT/codeinfo_markdown/review_visual_design_conformance.md"` when that step activates;
- include a short `Finding Saturation Seeds` section that records the likely same-class sibling files, mirrored producers or consumers, lifecycle-adjacent seams, proof-owner chains, or support-file families that a later bounded saturation pass should check before disposition when findings can be produced;
- when no actionable findings exist after a complete review, include a `Checked Defect Families` section that lists the main same-class defect families actively ruled out during the findings pass rather than implying they were never considered;
- when the artifact is an incomplete-review outcome, name the missing context, the artifacts inspected, and the minimum evidence needed to complete the review.

Cross-repository findings are valid when the issue only becomes visible when comparing two or more repositories together, even if each repository looks individually plausible.

If a complete review produces no findings:

- state that explicitly;
- still include the `Rejected Risk Notes` section;
- also record any residual risks or weak-proof areas.

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints, including repo-local versus cross-repository grouping when relevant.

When updating the handoff, preserve all existing top-level fields and every existing `repos[]` entry exactly unless this step explicitly owns the field being changed. In particular, preserve `resolved_base_branch`, `resolved_base_source`, `logical_base_branch`, `remote_name`, `remote_fetch_status`, optional fetch-failed-only sanitized `remote_fetch_error`, optional fetch-failed-only `remote_fetch_exit_code`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, `comparison_rule`, and `head_commit`.

This findings file is a high-quality local review artifact for the active flow run. It MUST NOT be committed.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff was normalized correctly.
- Confirm the canonical plan and story branch still match the scope.
- Confirm the review handoff still matches the current scope and HEAD commits.
- Confirm the review handoff or safely inferred context identifies the local-HEAD-vs-resolved-base comparison for every repository and that any local fallback is carried into residual-risk notes.
- Confirm the plan-based review was completed for every repository in scope.
- Confirm the cross-repository integration pass was completed when required.
- Confirm the generic engineering pass and the adversarial review were both completed.
- Confirm the top 3 risky helpers/functions from the evidence artifact were inspected.
- Confirm the findings artifact includes `Rejected Risk Notes` for those risky helpers/functions.
- Confirm all findings include severity, issue type, and affected repository scope.
- Confirm every actionable finding includes a defect class plus likely same-class sibling surfaces, or an explicit reason no meaningful sibling surface exists.
- Confirm the findings artifact includes `Finding Saturation Seeds`, or `Checked Defect Families` when no actionable findings exist.
- Confirm any finding raised against allowed support files was either a wording issue or an explicit secret/artifact-hygiene issue.
- If the active plan explicitly names design-target assets intended as implementation references, confirm the review explicitly checked visual conformance whenever both the named design assets and usable retained screenshots existed, instead of limiting itself to behavioral correctness.
- Confirm the findings file path and the handoff `findings_file` field match.

</verification_loop>

<final_response_rule>

- Never recommend reverting or removing the allowed support-file changes merely because they exist.
- Only call out spelling, grammar, obvious wording mistakes, or explicit secret/artifact-hygiene defects in those files.
- If no findings exist, still say that explicitly.

</final_response_rule>
