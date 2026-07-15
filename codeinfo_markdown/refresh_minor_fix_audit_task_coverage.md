# Goal

Refresh every completed minor-fix pass audit after combined review task-up so escalated findings identify their resulting individual or grouped task coverage.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` and `codeInfoStatus/flow-state/review-disposition-state.json` from disk.
- Run `python3 "$CODEINFO_ROOT/scripts/write_minor_fix_audit_task.py" --all-passes` from the canonical plan repository root.
- Treat the helper as the sole writer. Do not split grouped task-up work, invent task coverage, or hand-edit audit tasks.
- If task-up did not create coverage for an escalated finding, preserve the explicit pending coverage text and report the mismatch; never claim the finding was tasked.
- Commit only the canonical plan when the helper changed it. Do not push.

</critical_rules>

<output_contract>

- Report each refreshed audit task number and pass ID, plus every escalated finding that remains pending task coverage.
- Confirm each cycle/pass identity still appears exactly once and all existing checked fixed/proof evidence remained unchanged.

</output_contract>
