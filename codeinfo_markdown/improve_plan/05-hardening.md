# Goal

Update the active plan so it is clearer, evidence-backed, and ready for a later tasking pass.

<instruction_priority>

- Follow the shared workflow contract from `improve_plan/01-shared-contract.md`.
- Do not create tasks.
- Prefer the smallest set of plan edits that closes real gaps.
- Keep wording concrete and junior-friendly.
  </instruction_priority>

<editing_rules>

- Re-read the active plan from disk before editing.
- Preserve the existing plan structure where possible.
- Use `plan_format.md` from the current repository as the formatting reference when it is relevant.
- If `plan_format.md` is not present in the current repository, use the copy from `codeInfo2` if it is available.
- If it is still not available, use `code_info` to find the best matching planning template in another repository.
- Do not add unnecessary multi-repository structure to single-repository stories.
- If the story is multi-repository, make repository ownership explicit throughout the plan.
  </editing_rules>

<required_plan_updates>

- Improve any unclear Description, Acceptance Criteria, Out Of Scope, or other plan sections that are not specific enough for a junior developer.
- Make each Acceptance Criterion and meaningful edge case specific enough that a later tasking pass can map it to named proof locations rather than only generic wrapper commands.
- Add or update `## Implementation Ideas` based on the researched evidence.
- Add or update message-contract and storage-shape details when the story needs them.
- Add or update env/config domain details when the story introduces or changes numeric limits, margins, percentages, timeouts, queue caps, concurrency knobs, or other constrained values.
- Add or update a test-harness section only if new harness work is actually required.
- Add or update `Edge Cases and Failure Modes` when needed.
- Preserve the standard named planning sections used by this planning system when they are relevant, such as `Feasibility Proof Pass`, `Message Contracts And Storage Shapes`, `Test Harnesses`, `Edge Cases And Failure Modes`, and `Log Or Proof Markers`.
- Add further relevant sections only when they are genuinely helpful for the selected plan.
- Make prerequisite work explicit when capabilities are missing or assumptions are invalid.
- Make runtime, deployment, Docker, test, and validation expectations explicit when those areas matter to the story.
- Make scale-bounding expectations explicit when a query, delete filter, or bulk selector could otherwise grow with repository, file, chunk, or symbol count.
- When the story changes UI state, mode switching, create-vs-reuse behavior, or hidden/disabled fields, state the expected submission behavior explicitly, including whether stale state must be cleared or merely excluded from payloads and persistence.
- If the story is multi-repository, state which repository owns each planned change and describe dependency direction, sequencing, and compatibility expectations.
- If the story does not require a new frontend or backend, state that plainly where it matters instead of inventing work.
  </required_plan_updates>

<consistency_rules>

- Remove contradictions across the plan.
- Ensure repository names used by tasks or planned work stay in sync with the plan's `Additional Repositories` section.
- Ensure proof and validation steps described in the story are realistic for the sequence of work being planned.
- Ensure proof and validation expectations are granular enough that the later tasking pass can name exact test files or proof artifacts for each acceptance path and not only broad wrapper runs.
- Only add `## Questions` items for issues that remain genuinely blocked after research; otherwise resolve the issue directly in the plan.
  </consistency_rules>

<verification_loop>

- Re-read the edited plan and check whether it is now ready for a later tasking pass without hidden senior interpretation.
- Check whether any broad implementation area still needs to be split into clearer seams before later tasking.
- Check whether each added detail is supported by repository evidence or official documentation.
  </verification_loop>

<output_contract>

- Update the plan directly.
- Keep edits structured, concise, and specific.
- Do not create tasks.
- If no plan edits are needed for a category, do not add filler text for that category.
  </output_contract>
