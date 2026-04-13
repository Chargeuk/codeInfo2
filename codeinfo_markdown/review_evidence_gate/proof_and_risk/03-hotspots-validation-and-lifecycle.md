# Goal

Capture the validation, execution-timing, and lifecycle hotspots that the findings pass must inspect explicitly.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file after the risk matrix is complete.
- Treat this file as the owner of validation, fast-path, lifecycle, and cleanup hotspot capture.

</usage_rules>

<hotspot_rules>

- For each changed file or helper outside the allowed spelling/grammar-only support-file set, record any review hotspot involving:
  - merge-before-validate logic;
  - normalization-before-validate logic;
  - provider, client, dispatcher, lock, or bootstrap setup that may happen before the code proves real work still exists on no-op, metadata-only, delete-only, or zero-work fast paths;
  - startup, bootstrap, dispatcher, or recovery paths whose degraded-dependency behavior may differ from the retryable or service-unavailable contract exposed by the normal request, tool, or UI path;
  - bootstrap or existence checks;
  - helpers that return warnings/errors/reason metadata;
  - raw-to-wrapped error translation helpers plus any changed caller that branches on raw error names, SDK error classes, provider error codes, retryability, or cancel-vs-terminal semantics;
  - fallback or precedence helpers where stale persisted hints, cached values, collection-level metadata, or degraded fallback values may override fresher values observed during the current run;
  - shared waiter, listener, callback, queue, or subscription registrations that may survive timeout, rejection, cancellation, or early return without unregistering;
  - partial-failure handling;
  - dead-field or dead-branch risk;
  - any helper that could hide misconfiguration by defaulting too early.
- For any changed queued, deferred, retried, or promoted execution path, explicitly compare request-admission validation against execution-time validation. Record a hotspot whenever model-lock checks, allowlist checks, invalid-state checks, authorization checks, or equivalent preconditions are enforced on one path but skipped on another.
- For any changed route, service, or orchestration boundary whose tests mock a downstream seam to produce the expected contract error, record whether there is also direct proof that the production boundary itself performs the validation. If not, mark that proof as indirect and add a review hotspot for mocked-seam false confidence.
- For each changed orchestration function that initializes external providers, clients, dispatchers, locks, or other runtime dependencies, record whether any no-op, metadata-only, delete-only, or zero-work fast path can complete before that initialization happens. If the answer is unclear, add that ordering question to the review hotspots and the `Risk-Invariant Matrix`.
- For any changed startup, bootstrap, or recovery entrypoint whose normal operational paths already map dependency outage into a retryable or service-unavailable contract, record whether that entrypoint preserves the same degraded behavior or can still terminate the process before the standard contract is reachable.
- When a fast path is intended to complete without embedding, network, model, or provider work, record the exact dependency-free invariant that the findings pass must challenge explicitly.
- If an acceptance test proves only terminal status semantics for a fast path, but does not prove behavior under provider or bootstrap failure, mark that proof as indirect rather than direct.
- If a changed helper registers waiters, listeners, callbacks, subscriptions, or queue entries into shared state, record whether every exit path unregisters them, including success, timeout, rejection, cancellation, and early-return paths.
- If a changed helper chooses between persisted hints and freshly observed values, record whether the current-success path needs different precedence from zero-work or degraded fallback paths.

</hotspot_rules>
