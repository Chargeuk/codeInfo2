# Goal

Run the default-path, lifecycle, and cleanup findings pass for changed non-support implementation files.

<review_rules>

- In the second pass, prioritize:
  - dependency or bootstrap initialization that happens before the code proves real work exists, especially on no-op, delete-only, metadata-only, or zero-work fast paths;
  - bootstrap/existence checks that may misclassify files/directories/invalid paths;
  - waiter, listener, callback, subscription, or queue registrations that are cleaned up on success but can leak on timeout, rejection, cancellation, or early return;
  - partial-failure behavior;
  - dead-field or dead-branch risk.
- For multi-repository stories, include cross-repository generic engineering defects such as:
  - producer/consumer schema drift;
  - one-sided migrations;
  - incompatible fallback precedence between repositories;
  - sequencing that breaks mixed-version operation.
- In that second pass, you MUST also perform a generic adversarial review for the non-support-file changes and explicitly ask:
  - Could this changed code behave incorrectly because of execution-routing or harness rules that live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, or env wiring?
  - Does the default launcher, wrapper, dispatcher, CI flow, or startup path still execute the changed behavior without manual overrides, or has the change silently made the new path opt-in?
  - For any rename, ignore-rule, suffix, tag, project-assignment, or classification change, what no longer runs by default after this change, and is that exclusion intentional, proven, and reflected in the plan?
  - For any changed config, dispatcher, wrapper, CI, npm-script, or startup selector, have you inspected the corresponding consumer or launcher path that determines whether the new behavior is actually reachable in the standard flow?
  - When a dependency outage, queue outage, or degraded backend state is intentionally mapped to a retryable route, tool, or UI contract, does the startup or recovery path preserve that same degraded behavior, or can bootstrap still crash the process before the normal 503 or retryable contract is ever surfaced?
  - For any changed reader and writer pair over the same file, directory, or persisted artifact, are writes atomic or otherwise safe to observe, do readers tolerate partial writes, and can cleanup or delete paths remove a live resource owned by another actor?
  - Could `missing`, `malformed`, or `incomplete` state be a transient in-progress state rather than a truly stale state, and if so, does the code use ownership proof, age checks, retries, or atomic rename or write patterns before treating that state as stale?
  - Does any cleanup, stale-lock, or recovery logic risk false-positive deletion, reset, or takeover of live state owned by another process, worker, tab, or test?
  - Are there lifecycle or ordering hazards across create or acquire, in-progress, steady-state, cancel, retry, release, teardown, and crash-recovery paths that are not covered by the happy-path tests?
  - Does correctness depend on an unchanged config or harness file that must be opened to review the change honestly? If yes, inspect it and include the result in the findings.
- For changed code that reads state written by another actor, explicitly compare the writer and reader implementations together rather than reviewing them in isolation.
- For changed config, dispatcher, wrapper, CI, npm-script, or startup selector logic, explicitly compare the selector and consumer paths together rather than reviewing them in isolation.
- For changed helpers that register waiters, listeners, callbacks, subscriptions, or queue entries into shared state, verify that cleanup happens on every exit path, including timeout, rejection, cancellation, and early return. Raise a finding when registrations can leak into later tests or runs.
- Raise a finding when a concurrency-sensitive, lifecycle-sensitive, cleanup-sensitive, or harness-sensitive path has only happy-path proof or depends on an unstated serialization convention.
- Raise a finding when a change can silently skip tests, disable coverage, move checks out of the default validation path, or make important behavior reachable only through a manual or non-default invocation, unless that deviation is explicitly planned, intentional, and directly proven.

</review_rules>
