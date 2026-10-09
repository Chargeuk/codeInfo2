# Filter the current review batch by materiality and realistic impact

Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md`. This materiality artifact is applicable only when the completed positive-authorization gate has survivors; when this step runs, it must leave a non-empty completed, partial, or unavailable record.

This is an autonomous flow execution step, not a planning interview. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Use the available evidence and best judgement, preserve uncertainty honestly, and continue with best effort.

## Purpose

Decide whether each remaining positively authorized finding is sufficiently realistic and materially important to justify implementation work and another review iteration. Technical correctness and positive story authorization are necessary but not sufficient. A finding remains actionable when it meets the unused-code exception below or its realistic impact justifies changing otherwise completed code.

This gate reduces low-value review churn without suppressing credible defects. It assesses lasting complexity against practical value, not repair difficulty, and does not invent product policy or reinterpret earlier scope decisions. Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md`, including Supported Assumptions And Security Repairs.

Materiality can never restore, legitimize, or broaden an observation or remedy removed by negative scope or positive authorization. Evaluate only the exact narrowed, positively authorized issue and concrete repair seam passed to this gate. A realistic or severe consequence does not cure missing authorization.

## Authoritative inputs

When scheduler-assigned batch context is present, use its `batch_root` and explicit `plan_path` as required by the shared handoff contract. The following pointer-resolution commands apply only when no scheduler assignment exists: read `codeInfoStatus/flow-state/current-plan.json` only to identify the story and exact canonical `plan_path`, preserving its padded story identifier. Set `batch_handoff` to `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`, then set `batch_dir` exactly once by running `batch_dir="$(python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" resolve --batch-handoff "$batch_handoff")"`. Reuse those exact variables throughout this invocation; never discover, retype, reconstruct, or switch to a similar-looking batch path.

Copy batch identities, repository identities, reviewed commits, finding identities, and paths directly from scheduler-assigned context, its `batch-launch.md`, and assigned inputs. Do not reconstruct, normalize, abbreviate, or type them from memory.

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then load only the bounded top-level Description, Acceptance Criteria, and Out Of Scope context needed to establish supported behavior. Read the audited reconciliation, current actionable reconciliation, `reconciliation/scope-filtered-findings.md`, and `reconciliation/scope-authorized-findings.md`.

Reopen immutable reviewer evidence only when a surviving finding lacks enough evidence for a materiality decision. Do not assume provider names, an expected reviewer count, a required finding schema, a filename pattern inside a job, or a heading layout.

## Survivor-only rule

Evaluate only findings that remain actionable after both negative scope filtering and positive authorization.

Do not reconsider, re-authorize, restore, or substantially reason about any finding or remedy already recorded as fully removed, narrowed away, positively unauthorized, rejected, unsupported, duplicate, or already resolved before this gate.

Read earlier removal records only far enough to identify exclusions, conserve identities and provenance, prevent accidental resurrection or duplicate wording, and resolve a factual contradiction. Do not reopen job evidence for an already removed item unless conflicting identities make it impossible to determine whether a current survivor is actually the same item. Do not repeat the earlier gates' reasoning.

Earlier removals are an append-only audit and reporting trail, not candidates for this gate.

## Unused-code exception

A finding that has passed negative scope and positive authorization remains actionable when current reviewed-commit evidence demonstrates a safely removable unused import, variable, binding, or function parameter in story-modified code. Do not reject it solely as too minor, cleanup preference, or excess churn, and do not require a runtime failure or significant user-facing impact. Removal must preserve required side effects and interface contracts.

For qualifying findings, record the unused code and evidence that removal is safe in place of the ordinary failure-scenario and practical-impact requirements throughout this gate, including required actions and output. This exception satisfies materiality only; it does not restore earlier removals, broaden the authorized remedy, or excuse uncertainty about whether the code is unused and safely removable.

## Materiality standard

For findings outside the unused-code exception, keep a surviving finding actionable only when the available evidence convincingly demonstrates all of the following:

1. **Current behavior**

   The problem exists at the exact reviewed repository and commit. It is not based only on an outdated file, hypothetical future change, stale evidence, or behavior already repaired at the reviewed HEAD.

2. **Realistic reachability**

   Demonstrate one of the following routes with current evidence:
   - **Supported-workflow route:** identify the actual user operation, actual application-produced inputs and invariants, and upstream checks. Trace a concrete reachable failure through the supported production path, including why earlier validation or rejection does not prevent it. Documented supported assumptions bind reviewers; do not substitute arbitrary malformed internal state, unsupported manual modification, prohibited concurrent top-level flows, impossible timing, or explicitly excluded behavior. Broad "validate" wording does not authorize invented caps or new reject behavior. A synthetic test proves behavior, not realistic reachability, unless it reproduces ordinary supported inputs. A synthetic normal valid input failure remains eligible when that supported path is demonstrated. No observed production incident is required.
   - **Credible-security route:** on a reviewed story-owned server surface authorized under the behavior lock, demonstrate attacker access and permissions, the vulnerable operation, and concrete harm such as auth bypass, unauthorized changes, code execution, or resource exhaustion. Crafted malicious requests need not originate from the UI. Explain why upstream authorization, validation, or resource controls do not prevent the attack and why the smallest authorized repair effectively prevents the demonstrated harm. Merely accepting malformed data is not security evidence. A request requiring permissions the attacker cannot obtain does not establish reachability. This route does not authorize unrelated or pre-existing security repairs or override explicit scope exclusions.

3. **Meaningful impact**

   The consequence is significant enough to justify modifying completed code. Material examples include incorrect results, lost or duplicated work, false success, a stuck flow, failure of a supported operation, credible security exposure, failure to recover required useful evidence, substantial repeated operator intervention, or a direct violation that leaves an acceptance criterion meaningfully incomplete.

4. **Value proportionate to change risk**

   Correcting the problem provides meaningful value compared with regression risk and lasting complexity. Qualitatively weigh practical impact and likelihood against permanent branches, scans, allocations, duplicated validation, configuration, new reject behavior, and maintenance. Do not invent numeric probability thresholds. An extremely rare low-impact issue needing substantial permanent machinery is normally non-actionable; rare credible severe security or data-loss harm may justify a minimal proportional repair.

   Distinguish repair difficulty from lasting complexity. Do not evade a material necessary fix merely because it is difficult to diagnose or implement or needs the stronger repair agent. Reassess acceptance when new evidence disproves reachability or demonstrates disproportionately complex lasting machinery for negligible impact. Research effort alone does not establish that disproportion.

## Findings normally below the materiality threshold

Treat a finding as non-actionable when it is technically plausible but its demonstrated value is limited to matters such as:

- naming, formatting, style, or code-organization preference;
- speculative defensive hardening without a concrete supported failure or credible-security scenario;
- an extremely theoretical sequence with no convincing reachable example;
- an internal inconsistency with no meaningful downstream effect;
- malformed or manually corrupted input outside supported behavior, without concrete security harm under the credible-security route;
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

Uncertain reachability remains non-actionable: do not create a task, continue repair, or keep a review loop alive to settle speculation. During repair, fresh contrary evidence requires recording a gate conflict and preserving the observation without further implementation; it never permits resurrection of earlier removals.

## Required actions

For each surviving positively authorized finding:

1. Confirm its exact identity and reviewed commit.
2. State a concrete supported scenario in which it could occur, or establish the credible-security route with attacker access, permissions, vulnerable operation, and concrete harm.
3. Explain the practical consequence in simple language.
4. Decide whether that consequence is materially worth implementation work, accounting qualitatively for likelihood and lasting complexity and evidencing an effective proportional minimal repair.
5. Keep the finding actionable, narrow it to its materially supported core, or remove it from the actionable reconciliation.
6. Preserve every generating and corroborating review harness already established.

When narrowing a mixed finding, retain only the materially supported core. Record the removed low-value wording or remedy separately so it cannot be restored downstream.

## Output and mutation boundary

Always write `reconciliation/materiality-filtered-findings.md`, even when every survivor remains material or the gate is partial or unavailable. Use flexible self-describing Markdown rather than a rigid schema.

State whether the result is completed, partial, or unavailable. Record the exact story, cycle, batch, repository, and reviewed-commit identities; every finding presented to this gate; whether it remains actionable, was narrowed, or was removed; its evidenced reachability route and practical impact; upstream checks and supported assumptions or attacker permissions; proportional repair and lasting complexity; why that impact is or is not material; uncertainty and missing evidence; confirmation that previously removed findings were not reconsidered; and confirmation that immutable job evidence was unchanged.

Update only the derived actionable reconciliation to remove or narrow below-threshold findings.

Do not modify implementation code, tests, configuration, or the canonical plan. Do not modify job `input/`, `work/`, `output/`, or `verification/` evidence; review-cycle control state; provider pointers; or reviewer-native artifacts.

Later disposition must place material survivors under `Accepted` and materiality-filtered items under `Ignored for This Story`.

## Failure and recovery

If the exact batch or positive-authorization survivor set cannot initially be established safely, first salvage every understandable fragment and triangulate it with the other trustworthy assigned batch evidence. If uncertainty remains, leave the actionable reconciliation unchanged and write an honest partial or unavailable materiality artifact; do not fail the turn or stop the surrounding flow.

A partial or unavailable result must not promote a finding or invent a clean review outcome. The surrounding independent audit and disposition steps continue with best effort and keep unproven work non-actionable.

## Completion checks

Before returning:

1. Reopen the negative-filter, positive-authorization, actionable reconciliation, and materiality artifacts.
2. Confirm every item evaluated was a genuine positive-authorization survivor.
3. Confirm no previously removed finding was reconsidered or restored.
4. Confirm every survivor received exactly one materiality decision.
5. Confirm every removal or narrowing remains visible for later `Ignored for This Story` recording.
6. Only when `$batch_handoff` exists and agrees with the assigned batch (or no scheduler assignment exists), run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" check --batch-handoff "$batch_handoff"`.
7. Repair only this step's derived materiality artifacts; report scheduler-owned structural failures without recreating their evidence.
8. Reopen `materiality-filtered-findings.md`, compare every stated identity and path character-for-character with the authoritative handoff, and correct allowed mismatches.

Return a concise execution summary and the materiality artifact path, not questions.
