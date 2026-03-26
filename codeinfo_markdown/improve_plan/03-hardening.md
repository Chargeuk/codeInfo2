# Goal

Update the active plan so it is clearer, evidence-backed, and ready for a later tasking pass.

<instruction_priority>
- Do not create tasks.
- Prefer the smallest set of plan edits that closes real gaps.
- Keep wording concrete and junior-friendly.
</instruction_priority>

<editing_rules>
- Re-read the active plan from disk before editing.
- Preserve the existing plan structure where possible.
- Use `plan_format.md` from the current repository as the formatting reference when it is relevant.
- If `plan_format.md` is not in the current repository, use `code_info` to find the best matching reference in `codeInfo2`, then another repository only if needed.
- Do not add unnecessary multi-repository structure to single-repository stories.
- If the story is multi-repository, make repository ownership explicit throughout the plan.
</editing_rules>

<required_plan_updates>
- Improve any unclear Description, Acceptance Criteria, Out Of Scope, or other plan sections that are not specific enough for a junior developer.
- Add or update `## Implementation Ideas` based on the researched evidence.
- Add or update message-contract and storage-shape details when the story needs them.
- Add or update a test-harness section only if new harness work is actually required.
- Add or update `Edge Cases and Failure Modes` when needed.
- Make prerequisite work explicit when capabilities are missing or assumptions are invalid.
- Make runtime, deployment, Docker, test, and validation expectations explicit when those areas matter to the story.
- If the story is multi-repository, state which repository owns each planned change and describe dependency direction, sequencing, and compatibility expectations.
- If the story does not require a new frontend or backend, state that plainly where it matters instead of inventing work.
</required_plan_updates>

<consistency_rules>
- Remove contradictions across the plan.
- Ensure repository names used by tasks or planned work stay in sync with the plan's `Additional Repositories` section.
- Ensure proof and validation steps described in the story are realistic for the sequence of work being planned.
- Only add `## Questions` items for issues that remain genuinely blocked after research; otherwise resolve the issue directly in the plan.
</consistency_rules>

<output_contract>
- Update the plan directly.
- Keep edits structured, concise, and specific.
- Do not create tasks.
- If no plan edits are needed for a category, do not add filler text for that category.
</output_contract>
