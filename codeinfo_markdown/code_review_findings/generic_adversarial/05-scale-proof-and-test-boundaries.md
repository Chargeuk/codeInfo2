# Goal

Run the scale-shape and proof-strength findings pass for changed non-support implementation files.

<review_rules>

- In the second pass, prioritize:
  - tests that appear to prove a route or orchestrator contract only because a mocked downstream seam throws the expected error, rather than because the production boundary itself enforces that contract;
  - query builders, delete filters, or bulk selectors whose size grows with repository, file, chunk, or symbol count without batching, paging, or another bounding strategy;
  - changed mocks or test helpers that accept `AbortSignal`, cancellation flags, or timeout controls but never inspect already-aborted or already-cancelled state at construction time.
- For any changed route, service, or orchestrator whose tests mock a downstream seam to produce a contract error, verify that at least one test or direct code path still proves the production boundary itself performs that validation. If that proof is missing, raise a finding or record residual weak proof explicitly rather than treating the mocked contract as sufficient.
- For changed query builders, delete filters, or bulk selectors, verify whether filter size or payload size grows with repository, file, chunk, or symbol count, and raise a finding when that growth is left unbounded in a large-repository or large-file path without batching, paging, generation tagging, or another bounding strategy.
- At minimum, inspect the top 3 changed helpers/functions by review risk from the evidence artifact, excluding the allowed spelling/grammar-only support files, and explicitly ask what malformed or contradictory input, mixed UI state, stale hidden value, premature dependency initialization, wrapped-error taxonomy mismatch, config-domain mismatch, stale-hint precedence mistake, leaked shared registration, or scale-bounded query failure could still make each one behave incorrectly even if the current tests pass.
- Write a `Rejected Risk Notes` section after the main findings list. For each top-risk helper/function from the evidence matrix, record:
  - the candidate semantic mismatch or contradictory input you tried to break it with;
  - whether that risk became an endorsed finding, a rejected risk, or a residual weak-proof concern;
  - the direct file or test evidence that justified that decision;
  - what still remains weak if the risk could not be fully disproven.
- If `codeInfoTmp/reviews/<review_pass_id>-blind-spot-challenge.md` already exists for this pass, read it and reconcile it with the findings output. If it does not exist yet, still complete the `Rejected Risk Notes` section directly from the evidence artifact, branch diff, and current findings so downstream steps do not depend on the new challenge step to function.
- For each risky path, state whether it has direct proof, indirect proof, or missing proof, and raise a finding when a risky path is only protected by happy-path coverage or is otherwise weakly proven.
- When a valid, low-risk consistency problem is found in files already changed by the story, and the fix does not change public payloads or otherwise broaden scope, prefer `should_fix` over `optional_simplification` so the cleanup is attempted rather than deferred by default. This guidance does not override the spelling/grammar-only rule for the allowed support files.

</review_rules>
