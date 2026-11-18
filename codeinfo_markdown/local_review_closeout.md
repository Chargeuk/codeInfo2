# Reconcile local review progress at closeout

Use the assigned immutable batch records, existing review tasks, canonical plan, and qualifying proof artifacts. Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md`, `$CODEINFO_ROOT/codeinfo_markdown/shared/review-findings-plan-record.md`, and existing closeout/settlement rules. Reconcile earlier progress in place; preserve provenance, stable finding identities, gate exclusions, repository ownership, and any uncertainty. Do not reopen rejected findings or infer success from missing evidence.

Account for every planned review task and batch: addressed findings, remaining survivor checkboxes, unresolved or unavailable repair, exact repositories and heads, fix commits/fix-bearing state, focused and whole-story proof coverage, limitations, and any applicable cap, stall, or blocked outcome. Repair understandable omissions in the existing canonical records without duplicating them. Keep open gates and proof limitations visible; do not mark implementation or proof complete without evidence.

Honor existing Git/commit ownership and the caller's boundary. Stop after reconciliation: do not add tests, start another review, create another record/repair loop or handoff, or perform new proof. Return a compact status with the canonical record/task references and remaining gates.
