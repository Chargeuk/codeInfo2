# Goal

Capture the changed-test proof hotspots and the generic adversarial checklist that later review steps must inspect.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file after the contract and scale hotspot pass.
- Treat this file as the owner of changed-test proof hotspots and generic adversarial checklist setup.

</usage_rules>

<hotspot_rules>

- For each changed file or helper outside the allowed spelling/grammar-only support-file set, record any review hotspot involving:
  - changed test titles or descriptions whose assertions may no longer match the invariant they claim to prove;
  - changed tests that prove "something did not happen yet" using fixed delays instead of a deterministic scheduler, resource, or state boundary.
- Record a generic adversarial review checklist for the findings pass. For every non-support-file change, note whether the findings pass MUST inspect:
  - execution-routing or harness-selection rules that may live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, and env wiring;
  - default launcher, wrapper, dispatcher, CI, or startup entrypoints to verify the changed behavior still runs in the standard path without manual overrides;
  - shared-state surfaces touched by the change, including lock files or directories, temp paths, caches, singleton resources, ports, persisted artifacts, and cross-test fixtures;
  - selector/consumer pairs that jointly determine reachability, inclusion, or routing, such as config files plus dispatcher scripts, wrapper scripts, CI jobs, npm scripts, startup code, or other launch-time selectors;
  - reader and writer pairs over the same file, directory, or persisted artifact, including whether writes are atomic, whether readers tolerate partial writes, and whether cleanup or delete paths can remove a live resource owned by another actor;
  - lifecycle transitions and cleanup paths, including create or acquire, in-progress or partially written state, steady-state, retry, cancel, release, teardown, and crash recovery;
  - tests that mutate shared state or rely on serialization, including what prevents interference with parallel suites, other projects, retries, or stateful variants;
  - malformed, missing, incomplete, or contradictory state that could be transient rather than stale, including partially written files, half-created directories, and delayed metadata visibility;
  - rename, ignore-rule, suffix, tag, project-assignment, or classification changes that may silently exclude tests, routes, jobs, or code paths from the default validation path.
- For any risky area above, record the controlling unchanged files, helpers, or configs that must be opened during findings even if they are outside the branch diff, and note whether current proof is direct, indirect, or missing.
- If a changed helper wraps, normalizes, or classifies errors, record the consumer branch that interprets those errors and note whether cancellation, retry, ignore, and terminal-failure semantics still depend on the old raw error shape.
- If a changed test file is being used as acceptance proof, also record whether that test itself introduces review risk through shared paths, shared fixtures, cleanup side effects, runner-project selection, worker-safety assumptions, or cross-suite interference.
- If a changed test file is being used as acceptance proof, also record whether the test name, inline description, and assertions still exercise the same invariant after the implementation changes rather than only adjacent behavior.
- If a changed test file is being used as acceptance proof, also record whether any negative assertion depends on an arbitrary elapsed-time sleep instead of a deterministic scheduler, resource, or state boundary, and mark that proof as weak when no stronger boundary is demonstrated.

</hotspot_rules>
