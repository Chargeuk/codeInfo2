# Target-local authority

Read `$CODEINFO_ROOT/codeinfo_markdown/single_target_review_contract.md` first and follow it as the authoritative scope contract for this invocation.

# Goal

Run a bounded visual-conformance review using retained manual-testing screenshots and named design assets, then add any visual findings to the current findings artifact.

This step is additive to the normal findings pass. It must not replace the code or contract review.

## Activation

Run this step only when all of the following are true:

1. The active plan explicitly names design-target assets intended as implementation references. Treat that as `Design Contract Present`.
2. A current review handoff exists and identifies a usable findings artifact.
3. Retained manual-proof screenshots exist for the active story under either:
   - `codeInfoTmp/manual-testing/<story-number>/`
   - or `codeInfoStatus/manual-proof/<story-number>/`

If either the design assets or the screenshots cannot be found honestly from disk, do nothing:

- do not modify the findings artifact;
- do not create a visual-review artifact;
- do not update the review handoff;
- return a concise no-op result explaining which prerequisite was missing.

## Success Criteria

- Only the named design surfaces that can actually be compared are reviewed.
- The comparison stays bounded, concrete, and evidence-backed.
- Any material mismatch against mandatory visual invariants becomes a normal actionable finding.
- Any missing screenshot-to-design comparison proof becomes a finding only when both the design assets and the retained screenshots are present but the claimed comparison proof is still absent or weak.
- Missing screenshots by themselves do not create a visual-review finding in this step.
- If no actionable visual findings are discovered, the normal findings artifact remains the canonical source of truth and the visual review is recorded only as additive evidence.

<critical_rules>

- Require the current-review handoff to match the prepared review base exactly on canonical seven-digit `story_id`, `plan_path`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `head_commit`, `comparison_base_commit`, and every prepared-scope field: `repo_alias`, `repo_root`, `branch`, `branched_from`, `logical_base_branch`, `resolved_base_branch`, `resolved_base_source`, `remote_name`, `remote_fetch_status`, optional `remote_fetch_error` and `remote_fetch_exit_code`, `local_fallback_reason`, `comparison_base_ref`, `comparison_head_ref`, `comparison_rule`, `review_context_file`, `review_context_sha256`, `review_context_source_plan_sha256`, and `review_excluded_paths`. Re-check the session before atomically updating the pointer; never overwrite a newer session.

- Use fresh disk reads and current git state, not conversational memory.
- Use the prepared base's `plan_host_root` plus `plan_path` as the only plan source; do not read target-local `current-plan.json` or `additional_repositories`.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --plan <absolute-plan-path> --profile review-scope` before judging whether `Design Contract Present` is true. Request only a named task design packet when the review state identifies an owning task.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and infer the current findings artifact from it.
- If the prepared target or plan-host checks fail, stop without changing review artifacts and report the target mismatch.
- If the review handoff cannot identify a usable findings artifact, stop with a concise no-op result and do not mutate review artifacts.
- This step must not edit the canonical plan directly.
- This step must not invent screenshot paths, design assets, or comparison evidence.
- Keep the review bounded. Compare only the surfaces that the active plan clearly treats as design-owned and that the retained screenshots can actually show.
- Review only the screenshots that manual testing actually retained. Do not invent or require screenshot evidence that does not exist on disk.

</critical_rules>

<comparison_rules>

- Identify design assets from the active plan only. Prefer explicit `## Design Contract`, task-scoped design packets, story manual-testing guidance, and explicit final-design references over inference.
- Re-open the current task requirements that own the reviewed screenshots before judging visual conformance, including the task's explicit subtasks, task-level visual invariants, task exit criteria, and any task-level `Manual Testing Guidance`.
- When lower-precedence design sources are needed for the same surface, consult both paired design markdown and any paired visual design asset such as `*.png` or `*.svg` when both exist.
- When judging visual conformance, use the current task's explicit subtasks and task-level requirements as the immediate contract first, then the story plan or `Design Contract`, then paired design markdown, then the supporting visual asset.
- When paired design markdown plus visual design assets such as `*.png` or `*.svg` both exist for the same surface, treat the markdown as canonical only relative to that lower-precedence visual asset.
- Inspect retained screenshots and design images with available local image-view tools when possible.
- Read the paired design markdown and use it as the text contract for hierarchy, placement, spacing priorities, interaction patterns, exact specified colors, and other explicit requirements that may not be reliably inferred from the image alone.
- If the implementation matches an explicit current-task requirement but differs from a lower-precedence design source on that same point, do not treat that difference by itself as a mismatch.
- If the current task is silent on that point, fall back to the story plan or `Design Contract`, then to paired design markdown, then to the supporting visual asset.
- If the current task is vague or silent and the implementation violates a higher-precedence fallback source, treat that as a design-contract mismatch.
- Keep the scan bounded to the most relevant screenshot/design pairs. If many screenshots exist, prioritize the screenshots most clearly tied to:
  - the final revalidation task;
  - the highest-numbered task folder;
  - or the surfaces explicitly named by the design contract.
- Do not promote a mismatch finding for tiny spacing noise, font-rendering differences, or obvious environment-level rendering variation when the mandatory visual invariant is still honestly met.
- When paired design markdown and visual design asset disagree, judge mandatory visual invariants from the highest-precedence source that actually answers the disputed point, using the visual asset only when the higher-precedence sources are silent.
- Do promote a finding when the implementation is only directionally similar and misses a mandatory visual invariant such as:
  - wrong shell structure;
  - missing or misplaced rail, pane, composer, or overlay;
  - incorrect hierarchy or metadata placement;
  - materially different interaction pattern;
  - or a visible contract that weakens usability or contradicts the named design asset.

</comparison_rules>

<finding_rules>

- If a material visual mismatch is found, update the existing findings artifact in place and add a normal actionable finding using the repository's current findings format.
- Before adding a new visual finding, check whether the current findings artifact already contains the same visual defect in materially equivalent form. If it does, do not add a duplicate finding; update the additive visual-review artifact only.
- Classify the visual finding as:
  - `must_fix` when the mismatch breaks a mandatory visual invariant or clearly undermines the story's stated design contract;
  - `should_fix` when the mismatch is material but somewhat narrower in user impact;
  - `optional_simplification` only when the screenshot/design difference is real but not contract-breaking.
- Mark visual mismatch findings as `generic_engineering_issue` unless the active plan explicitly made the design contract itself a required plan contract surface, in which case `plan_contract_issue` is also acceptable.
- Use `Scope Impact: behavioral_regression` when the visual mismatch changes usability, interaction clarity, or the visible contract.
- Use `Scope Impact: proof_gap` when the issue is that screenshot-to-design comparison proof was expected but is missing or too weak even though the required screenshots and design assets are present.
- Name the likely same-class sibling surfaces that should be checked next, such as the same shell family, the paired mobile or desktop variant, or the matching composer surface.
- If no actionable visual findings are found, do not add cosmetic filler findings.

</finding_rules>

<artifact_rules>

- If this step activates, write an additive artifact at `codeInfoTmp/reviews/<review_pass_id>-visual-design-review.md`.
- That artifact must include:
  - the canonical `plan_path`;
  - the findings artifact path it inspected and may have updated;
  - the design assets reviewed;
  - the screenshot paths reviewed;
  - the screenshot/design pairs compared;
  - the comparison outcome for each pair: `matches`, `minor mismatch`, or `material mismatch`;
  - whether any actionable visual findings were added.
- If this step adds actionable findings, update the findings artifact in place so those new findings become part of the canonical findings source for later saturation, challenge, and disposition steps.
- If this step activates, update the current review handoff with:
  - `visual_review_file`
  - `visual_review_outcome`
  - `visual_review_generated_findings: true|false`, where the value is `true` only if this step added one or more actionable visual findings to the canonical findings artifact, otherwise `false`
- Preserve all existing top-level fields and every existing `repos[]` entry in the review handoff exactly unless this step explicitly owns the field being changed.
- If this step does not activate because screenshots or design assets are missing, do not write any artifact or handoff update.

</artifact_rules>

<output_contract>

- When the step activates, report:
  - whether actionable visual findings were added;
  - the visual-review artifact path;
  - and the findings artifact path that was inspected or updated.
- When the step does not activate, report a concise no-op result stating whether screenshots were missing, design assets were missing, or both.

</output_contract>

<verification_loop>

- Confirm the prepared target still matches the working repository, branch, HEAD, and canonical plan-host context.
- Confirm the review handoff still identifies a usable findings artifact before any mutation.
- Confirm `Design Contract Present` was decided from the active plan on disk, not from memory.
- Confirm retained screenshots actually existed on disk before attempting visual comparison.
- Confirm no artifact or handoff update was written when screenshots or design assets were missing.
- Confirm no finding was added solely because screenshots were absent.
- Confirm any new actionable visual finding was added to the canonical findings artifact rather than being left only in the additive visual-review artifact.
- Confirm the additive visual-review artifact, when written, states exactly which screenshots and design assets were compared.

</verification_loop>
