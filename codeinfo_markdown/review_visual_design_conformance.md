# Goal

Run a bounded visual-conformance review using retained manual-testing screenshots and named design assets, then emit additive review outputs that a later merge step can apply to the canonical findings artifact.

This step is additive to the normal findings pass. It must not replace the code or contract review, and it must not directly mutate shared review outputs when parallel review addenda are enabled.

## Activation

Run this step only when all of the following are true:

1. The active plan explicitly names design-target assets intended as implementation references. Treat that as `Design Contract Present`.
2. A current review handoff exists and identifies a usable findings artifact.
3. Retained manual-proof screenshots exist for the active story under either:
   - `codeInfoTmp/manual-testing/<story-number>/`
   - or `codeInfoStatus/manual-proof/<story-number>/`

If either the design assets or the screenshots cannot be found honestly from disk, do not modify shared review outputs. If you can identify the active `review_pass_id`, still write a concise no-op additive result so the later merge step can treat this pass deterministically as `no_op`.

## Success Criteria

- Only the named design surfaces that can actually be compared are reviewed.
- The comparison stays bounded, concrete, and evidence-backed.
- Any material mismatch against mandatory visual invariants becomes a normal actionable finding.
- Any missing screenshot-to-design comparison proof becomes a finding only when both the design assets and the retained screenshots are present but the claimed comparison proof is still absent or weak.
- Missing screenshots by themselves do not create a visual-review finding in this step.
- If no actionable visual findings are discovered, the normal findings artifact remains the canonical source of truth and the visual review is recorded only as additive evidence for the later merge step.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Re-read `codeInfoStatus/flow-state/current-plan.json` first and use only its `plan_path` and `additional_repositories` as the active review scope.
- Re-open the exact canonical plan from disk before judging whether `Design Contract Present` is true.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and infer the current findings artifact from it.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated.
- If the review handoff cannot identify a usable findings artifact, stop with a concise no-op result and do not mutate shared review artifacts.
- This step must not edit the canonical plan directly.
- This step must not invent screenshot paths, design assets, or comparison evidence.
- Keep the review bounded. Compare only the surfaces that the active plan clearly treats as design-owned and that the retained screenshots can actually show.
- Review only the screenshots that manual testing actually retained. Do not invent or require screenshot evidence that does not exist on disk.
- This step must not update the canonical findings artifact in place.
- This step must not update `codeInfoTmp/reviews/<story-number>-current-review.json` directly.
- This step may write only its own additive artifact files for a later merge step.

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

- If a material visual mismatch is found, record it as a proposed actionable finding in this step's additive outputs using the repository's current findings format.
- Before proposing a new visual finding, check whether the current findings artifact already contains the same visual defect in materially equivalent form. If it does, do not propose a duplicate finding; record that duplicate check result in the additive visual-review artifact only.
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
- If this step activates, also write a machine-readable sidecar at `codeInfoTmp/reviews/<review_pass_id>-visual-design-review.json`.
- That artifact must include:
  - the canonical `plan_path`;
  - the findings artifact path it inspected;
  - the design assets reviewed;
  - the screenshot paths reviewed;
  - the screenshot/design pairs compared;
  - the comparison outcome for each pair: `matches`, `minor mismatch`, or `material mismatch`;
  - whether any actionable visual findings were proposed.
- The JSON sidecar must include:
  - `review_pass_id`
  - `status: "complete" | "no_op" | "incomplete"`
  - `generated_findings: true|false`
  - `proposed_findings`
  - `evidence_refs`
  - `source_artifact`
- Do not update the findings artifact in place in this step.
- Do not update the current review handoff in this step.
- Preserve the existing findings artifact and review handoff exactly; the later merge step is the only shared-output writer for this parallel addendum path.
- If this step does not activate because screenshots or design assets are missing, write the additive artifact and sidecar only when `review_pass_id` can be determined safely; otherwise write nothing.

</artifact_rules>

<output_contract>

- When the step activates, report:
  - whether actionable visual findings were proposed;
  - the visual-review artifact path;
  - the visual-review sidecar path;
  - and the findings artifact path that was inspected.
- When the step does not activate, report a concise no-op result stating whether screenshots were missing, design assets were missing, or both.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff still matches the canonical plan and story branch.
- Confirm the review handoff still identifies a usable findings artifact before any mutation.
- Confirm `Design Contract Present` was decided from the active plan on disk, not from memory.
- Confirm retained screenshots actually existed on disk before attempting visual comparison.
- Confirm no shared findings-artifact or review-handoff update was written when screenshots or design assets were missing.
- Confirm no finding was added solely because screenshots were absent.
- Confirm any new actionable visual finding was proposed only through the additive visual-review outputs rather than being written directly into the canonical findings artifact.
- Confirm the additive visual-review artifact, when written, states exactly which screenshots and design assets were compared.
- Confirm the additive visual-review sidecar, when written, matches the markdown artifact and records the correct `status` and `generated_findings` values.

</verification_loop>
