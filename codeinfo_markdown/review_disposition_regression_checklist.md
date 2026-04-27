# Goal

Provide a small non-runtime checklist for reviewing future changes to the review-disposition prompts and related task-up guidance.

This file is not part of the automated live review flows. It is a maintenance aid for humans or agents reviewing prompt changes, and it is used by a manually invoked regression command.

<critical_rules>

- Do not treat this checklist as part of an automated or live review flow unless a future human explicitly wires it into one. Manual use through the dedicated regression-review command is expected.
- Use this checklist only for manual regression review of proposed edits to review-disposition prompts, minor-fix prompts, or task-up prompts.
- Prefer short yes/no answers plus one sentence of reasoning for each item.

</critical_rules>

<checklist>

1. Does the proposed change still allow one-function structured-error alignment to stay inline when the intended contract is already clearly settled in the same repository?
2. Does the proposed change still allow one-function validation-before-dependency fixes to stay inline when they restore an already-settled request contract?
3. Does the proposed change still allow bounded producer-consumer parity fixes to stay inline when one path is failing to follow an already-established returned-result contract?
4. Does the proposed change still allow proven dead-branch cleanup in a queue, lifecycle, or concurrency-sensitive helper to stay inline when the seam is bounded and focused proof is available?
5. Does the proposed change still force destructive public authority boundary changes into task-up rather than the minor path?
6. Does the proposed change still force broader workflow, storage-contract, lifecycle-reinterpretation, or multi-surface taxonomy work into task-up rather than the minor path?
7. Does the proposed change avoid adding extra review-loop routing complexity unless that added complexity is clearly necessary?
8. Does the proposed change avoid reintroducing wording that escalates findings solely because they sound contract-sensitive, queue-sensitive, concurrency-sensitive, lifecycle-sensitive, or shared-caller-sensitive?

</checklist>

<output_contract>

- Report whether the proposed prompt change passes or fails each checklist item.
- If an item fails, briefly state the concrete wording drift or behavior regression you see.
- If every item passes, say that explicitly.

</output_contract>
