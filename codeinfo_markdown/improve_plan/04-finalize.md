# Goal

Perform a final verification pass, then make one coherent commit if the command changed files.

<instruction_priority>
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
</verification_loop>

<commit_policy>
- If this command changed files, create one commit after the final verification pass.
- The commit message must start with `DEV-[Number] -`.
- Use the current repository branch story number for `[Number]` when available.
- Write a 4- or 5-sentence commit body that explains what changed and why.
- If verification finds a remaining issue, fix it before committing when possible.
- If nothing changed, do not create an empty commit.
</commit_policy>

<output_contract>
- Report briefly what changed, what was verified, and whether a commit was created.
- Do not create tasks.
</output_contract>
