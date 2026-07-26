# Filter the current review batch by materiality and realistic impact

This is an autonomous flow execution step, not a planning interview. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Use the available evidence and best judgement, preserve uncertainty honestly, and continue with best effort.

## Purpose

Decide whether each remaining positively authorized finding is sufficiently realistic and materially important to justify implementation work and another review iteration. Technical correctness and positive story authorization are necessary but not sufficient. A finding remains actionable only when its realistic impact justifies changing otherwise completed code.

This gate reduces low-value review churn without suppressing credible defects. It does not decide repair difficulty, invent product policy, or reinterpret earlier scope decisions.

## Authoritative inputs

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story and exact canonical `plan_path`, preserving its padded story identifier. Resolve the exact current immutable batch through `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`.

Copy batch identities, repository identities, reviewed commits, finding identities, and paths directly from the authoritative handoff, `batch-launch.md`, and assigned inputs. Do not reconstruct, normalize, abbreviate, or type them from memory.

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then load only the bounded top-level Description, Acceptance Criteria, and Out Of Scope context needed to establish supported behavior. Read the audited reconciliation, current actionable reconciliation, `reconciliation/scope-filtered-findings.md`, and `reconciliation/scope-authorized-findings.md`.

Reopen immutable reviewer evidence only when a surviving finding lacks enough evidence for a materiality decision. Do not assume provider names, an expected reviewer count, a required finding schema, a filename pattern inside a job, or a heading layout.

## Survivor-only rule

Evaluate only findings that remain actionable after both negative scope filtering and positive authorization.

Do not reconsider, re-authorize, restore, or substantially reason about any finding or remedy already recorded as fully removed, narrowed away, positively unauthorized, rejected, unsupported, duplicate, or already resolved before this gate.

Read earlier removal records only far enough to identify exclusions, conserve identities and provenance, prevent accidental resurrection or duplicate wording, and resolve a factual contradiction. Do not reopen job evidence for an already removed item unless conflicting identities make it impossible to determine whether a current survivor is actually the same item. Do not repeat the earlier gates' reasoning.

Earlier removals are an append-only audit and reporting trail, not candidates for this gate.

## Materiality standard

Keep a surviving finding actionable only when the available evidence convincingly demonstrates all of the following:

1. **Current behavior**

   The problem exists at the exact reviewed repository and commit. It is not based only on an outdated file, hypothetical future change, stale evidence, or behavior already repaired at the reviewed HEAD.

2. **Realistic reachability**

   A concrete failure scenario can occur through a supported or intended workflow. It must not depend entirely on prohibited concurrent top-level flows, deliberately malformed internal state, unsupported manual modification, impossible timing assumptions, or behavior explicitly outside the story contract.

3. **Meaningful impact**

   The consequence is significant enough to justify modifying completed code. Material examples include incorrect results, lost or duplicated work, false success, a stuck flow, failure of a supported operation, credible security exposure, failure to recover required useful evidence, substantial repeated operator intervention, or a direct violation that leaves an acceptance criterion meaningfully incomplete.

4. **Value proportionate to change risk**

   Correcting the problem provides meaningful value compared with the regression and churn risk of changing completed working code. Do not reject a material finding merely because it is difficult to repair or may require the stronger repair agent. Repair difficulty is not a materiality decision.

## Findings normally below the materiality threshold

Treat a finding as non-actionable when it is technically plausible but its demonstrated value is limited to matters such as:

- naming, formatting, style, or code-organization preference;
- speculative defensive hardening without a concrete supported failure;
- an extremely theoretical sequence with no convincing reachable example;
- an internal inconsistency with no meaningful downstream effect;
- malformed or manually corrupted input outside supported behavior;
- a small provenance or wording defect that the existing agent recovery path already corrects reliably;
- test tidiness that does not leave meaningful production behavior unprotected;
- a micro-optimization without evidence of meaningful cost;
- replacing simple working code merely because another design appears cleaner; or
- a harmless implementation difference that still satisfies the same contract.

Do not use reviewer severity labels, historical review decisions, implementation effort, or change size as proof of materiality. Do not invent numeric probability, cost, severity, risk, effort, or impact thresholds.

Rarity alone is not a reason to reject a finding. A rare but credible security, data-loss, corruption, false-success, or permanently stuck-flow scenario may still be material.

## Borderline and uncertain findings

When realistic reachability or meaningful impact cannot be convincingly demonstrated, prefer non-actionable preservation over another implementation loop.

Record the finding as technically supported and positively authorized but below the materiality threshold or insufficiently demonstrated for this story. Do not describe uncertainty as proof that no defect exists. Preserve the evidence so separately approved future work remains possible.

## Required actions

For each surviving positively authorized finding:

1. Confirm its exact identity and reviewed commit.
2. State a concrete supported scenario in which it could occur.
3. Explain the practical consequence in simple language.
4. Decide whether that consequence is materially worth implementation work.
5. Keep the finding actionable, narrow it to its materially supported core, or remove it from the actionable reconciliation.
6. Preserve every generating and corroborating review harness already established.

When narrowing a mixed finding, retain only the materially supported core. Record the removed low-value wording or remedy separately so it cannot be restored downstream.

## Output and mutation boundary

Always write `reconciliation/materiality-filtered-findings.md`, even when every survivor remains material or the gate is partial or unavailable. Use flexible self-describing Markdown rather than a rigid schema.

State whether the result is completed, partial, or unavailable. Record the exact story, cycle, batch, repository, and reviewed-commit identities; every finding presented to this gate; whether it remains actionable, was narrowed, or was removed; its realistic scenario and practical impact; why that impact is or is not material; uncertainty and missing evidence; confirmation that previously removed findings were not reconsidered; and confirmation that immutable job evidence was unchanged.

Update only the derived actionable reconciliation to remove or narrow below-threshold findings.

Do not modify implementation code, tests, configuration, or the canonical plan. Do not modify job `input/`, `work/`, `output/`, or `verification/` evidence; review-cycle control state; provider pointers; or reviewer-native artifacts.

Later disposition must place material survivors under `Accepted` and materiality-filtered items under `Ignored for This Story`.

## Failure and recovery

If the exact batch or positive-authorization survivor set cannot be established safely, leave the actionable reconciliation unchanged and write an honest partial or unavailable materiality artifact.

A partial or unavailable result must not promote a finding or invent a clean review outcome. The surrounding independent audit and disposition steps continue with best effort and keep unproven work non-actionable.

## Completion checks

Before returning:

1. Reopen the negative-filter, positive-authorization, actionable reconciliation, and materiality artifacts.
2. Confirm every item evaluated was a genuine positive-authorization survivor.
3. Confirm no previously removed finding was reconsidered or restored.
4. Confirm every survivor received exactly one materiality decision.
5. Confirm every removal or narrowing remains visible for later `Ignored for This Story` recording.
6. Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>`.
7. Repair only factual derived-workspace issues owned by this step.
8. Reopen `materiality-filtered-findings.md`, compare every stated identity and path character-for-character with the authoritative handoff, and correct allowed mismatches.

Return a concise execution summary and the materiality artifact path, not questions.
