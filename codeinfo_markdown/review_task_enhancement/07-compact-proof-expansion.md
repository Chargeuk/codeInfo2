# Goal

Add honest proof ownership to selected review-created tasks without creating one proof subtask for every invariant.

<instruction_priority>

- Follow `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"` and keep the scope limited to the selected review-created `__to_do__` tasks.
- Preserve selected review-created task identities and grouping.
- Prefer one proof-authoring subtask per proof file, proof surface, or harness path.
- Compactness must not weaken exact ordering, producer-consumer, default-path, runtime-handoff, or review-finding proof.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Add proof-authoring subtasks only to substantive review-fix tasks; preserve exactly one lint and one formatting checklist item per worked-on repository in the dedicated final task.

</instruction_priority>

<compact_proof_rules>

- Immediately before editing, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking`, and use only its fresh bounded task selection and section content.
- For each selected substantive review-created task, identify the proof files, harnesses, markers, fixtures, screenshots, logs, or prepared proof surfaces that must be authored or updated.
- Use one compact proof-authoring subtask per proof file or proof surface when that file or surface can cover multiple related assertions.
- Inside that proof subtask, list the required assertions or invariants inline, including any exact ordering, interleaving, producer-consumer propagation, default-path reachability, stale-state, or runtime-handoff checks.
- Split proof subtasks only when:
  - different proof files or harnesses are required;
  - proof sequencing differs;
  - one proof owner cannot honestly cover the listed assertions;
  - combining would hide a high-risk invariant or make the proof vague.
- Do not create separate proof subtasks solely because one proof file must assert multiple related conditions.
- Do not allow generic proof wording such as `update tests`, `add coverage`, or `prove the fix` without exact proof surfaces and assertions.
- Keep execution commands in `Testing`; proof-authoring subtasks should describe proof files or surfaces to create or update before formal proof runs.

</compact_proof_rules>

<verification_loop>

- Check that every endorsed finding addressed by the selected tasks has a proof owner.
- Check that high-risk invariants from `02b-risk-and-prerequisite-scan.md` remain explicit inside compact proof subtasks.
- Check that no exact ordering, producer-consumer, default-path, or runtime-handoff proof was dropped for compactness.
- Check that proof subtasks are grouped by proof owner rather than split into one checkbox per assertion unless that split is genuinely needed.

</verification_loop>

<output_contract>

- Update selected review-created tasks directly.
- Keep proof wording compact but auditable.
- Do not add proof subtasks that depend on future generated proof output to become complete.

</output_contract>
