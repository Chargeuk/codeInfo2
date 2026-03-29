# Goal

Perform a final verification pass, then make one coherent commit if the command changed files.

<instruction_priority>

- Follow the shared workflow contract from `improve_plan/01-shared-contract.md`.
- Do not create tasks.
- Use fresh disk reads for the final verification.
- Prefer one coherent commit over many small commits.
  </instruction_priority>

<verification_loop>

- Re-read the active plan from disk before finalizing.
- Check correctness: does the updated plan satisfy the command goals without adding tasks?
- Check completeness: are all relevant planning areas covered or explicitly not applicable?
- Check consistency: are there contradictions across Description, Acceptance Criteria, Out Of Scope, Implementation Ideas, contracts, test harnesses, edge cases, and validation steps?
- Check evidence alignment: are plan changes supported by repository evidence or official documentation?
- Check tasking readiness: is the plan detailed enough for a later tasking pass without relying on hidden senior knowledge?
- Check proof realism: will the planned validation steps be runnable at the point they are supposed to happen?
- Check whether the applicable categories from `shared/review-preemption-checklist.md` are either explicitly handled in the plan or explicitly not applicable.
  </verification_loop>

<commit_policy>

- If this command changed files, create one commit after the final verification pass.
- Follow the repository's commit-message and branch conventions from `AGENTS.md` or other repository-specific instructions when they exist.
- If no repository-specific commit convention exists, use a concise commit subject and a short explanatory body.
- If verification finds a remaining issue, fix it before committing when possible.
- If nothing changed, do not create an empty commit.
  </commit_policy>

<output_contract>

- Report briefly what changed, what was verified, and whether a commit was created.
- Do not create tasks.
  </output_contract>
