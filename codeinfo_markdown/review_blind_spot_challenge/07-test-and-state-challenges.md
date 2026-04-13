# Goal

Run the remaining blind-spot challenges for changed tests, config domains, scale, shared cleanup, and stale-state handling.

<step_rules>

1. For one changed test used as proof, attempt a weak-proof challenge: if the test proves that something has not happened yet, verify whether it relies on an arbitrary elapsed-time sleep instead of a deterministic scheduler, resource, or state boundary, and decide whether that makes the proof flaky or only residual weak proof.
2. For one changed BDD, step-definition, or equivalent proof file, attempt a step-role honesty challenge: verify whether assertion-style phases mutate the state that earlier setup or action phases were supposed to establish, and decide whether the file's wording still matches its real behavior.
3. For one changed route, service, or orchestrator whose tests mock a downstream seam to produce a contract error, attempt a mocked-seam challenge: verify whether the production boundary itself still performs the validation, or whether the test now only proves that the mock can throw the expected error.
4. For one changed env/config parser, attempt a domain-mismatch challenge using empty string, whitespace, zero, negative, or oversized values and verify whether downstream invariants still hold or whether the parser should clamp, fallback, or reject earlier.
5. For one changed query/filter/bulk selector in a large-repository or large-file path, attempt a scale-shape challenge: identify whether the filter or payload grows with repository, file, chunk, or symbol count and verify whether the implementation bounds that growth.
6. For one changed async helper or test-support utility, attempt a leaked-registration challenge: if timeout, rejection, cancellation, or early return wins, verify whether any shared waiter, listener, callback, subscription, or queue registration is still unregistered before the helper exits.
7. For one changed fallback-selection or precedence helper, attempt a stale-hint challenge: assume an earlier cancelled or degraded run persisted a weak fallback value, then verify whether a later successful run with fresher observed state can override it correctly.
8. For each challenge in this command sequence, decide whether it:
   - creates a new endorsed finding;
   - strengthens a rejected-risk conclusion;
   - or leaves only residual weak proof.
9. Keep the output tightly scoped to the selected matrix items plus the extra non-helper consistency or portability challenge, the failure-ordering challenge, the admission-vs-execution challenge, the wrapped-error mismatch challenge, the weak-proof test challenge, the step-role honesty challenge, the mocked-seam challenge, the env/config domain challenge, the scale-shape challenge, the leaked-registration challenge, and the stale-hint challenge. Do not restart the whole review.

</step_rules>
