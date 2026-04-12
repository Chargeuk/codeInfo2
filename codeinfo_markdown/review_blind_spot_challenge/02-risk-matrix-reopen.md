# Goal

Re-open the stored risk matrix and findings state so the challenge stays tightly scoped to the highest-risk contradictions.

<step_rules>

1. Re-validate the current-plan scope and review handoff against the current repository state.
2. Re-open the evidence artifact's `Risk-Invariant Matrix` and identify the highest-risk helpers/functions and contradictory inputs or states recorded there.
3. Re-open the findings artifact and inspect the current findings list plus `Rejected Risk Notes`.
4. For each top-risk helper/function, attempt one more focused semantic challenge that is narrower and more adversarial than the general findings pass.
5. Prefer edge conditions that could make a tentative no-findings conclusion wrong, especially:
   - disabled-or-hidden stale UI state;
   - create-vs-reuse or run-vs-resume mode mismatches;
   - changed tests whose titles may no longer match their assertions.

</step_rules>
