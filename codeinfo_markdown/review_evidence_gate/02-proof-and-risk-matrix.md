# Goal

Provide the dense proof-mapping, hotspot-capture, and risk-matrix rules that the review evidence gate command applies after scope validation succeeds.

<usage_rules>

- Use this file only as part of the `review_evidence_gate` review-agent command.
- Apply this file after canonical plan scope, branch alignment, and repository validation are already complete.
- Treat this file as the owner of the detailed proof-source mapping rules, hotspot catalog, and `Risk-Invariant Matrix` construction rules for the evidence artifact.

</usage_rules>

<proof_mapping_rules>

- For every acceptance criterion in the canonical plan, identify the current proof source:
  - code path;
  - tests;
  - wrapper/test logs;
  - screenshots/manual proof;
  - or note that the proof is weak/missing.
- For multi-repository stories, add a dedicated cross-repository evidence section covering:
  - integration seams;
  - ownership boundaries;
  - dependency direction;
  - compatibility expectations;
  - any before/after contract comparison that only becomes visible when two or more repositories are considered together.
- Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
- Add a `Risk-Invariant Matrix` section to the evidence summary for the top risky helpers/functions. For each one, record:
  - the helper/function name and repository scope;
  - the semantic invariant or contract it must preserve;
  - the highest-risk contradictory input, state, or mixed-shape condition that could break that invariant;
  - whether current proof is direct, indirect, or missing;
  - which later review step must challenge that invariant explicitly.

</proof_mapping_rules>

<hotspot_catalog>

- For each changed file or helper OUTSIDE the allowed spelling/grammar-only support-file set, record any review hotspots that the findings pass must inspect explicitly:
  - merge-before-validate logic;
  - normalization-before-validate logic;
  - provider, client, dispatcher, lock, or bootstrap setup that may happen before the code proves real work still exists on no-op, metadata-only, delete-only, or zero-work fast paths;
  - bootstrap or existence checks;
  - env/config parsers whose accepted domain is wider than the downstream code safely supports, especially empty-string handling, whitespace handling, and numeric ranges that should be clamped, rejected, or treated as unset;
  - helpers that return warnings/errors/reason metadata;
  - raw-to-wrapped error translation helpers plus any changed caller that branches on raw error names, SDK error classes, provider error codes, retryability, or cancel-vs-terminal semantics;
  - fallback or precedence helpers where stale persisted hints, cached values, collection-level metadata, or degraded fallback values may override fresher values observed during the current run;
  - shared waiter, listener, callback, queue, or subscription registrations that may survive timeout, rejection, cancellation, or early return without unregistering;
  - changed test titles or descriptions whose assertions may no longer match the invariant they claim to prove;
  - shared log markers or shared response fields;
  - query builders, delete filters, or bulk selectors whose size grows with repository, file, chunk, or symbol count, especially `$or`, `$in`, `$nin`, and per-file delete payloads;
  - fallback-selection logic;
  - duplicate/conflicting object keys;
  - deleted/moved/conditional validation;
  - partial-failure handling;
  - dead-field or dead-branch risk;
  - changed tests that prove "something did not happen yet" using fixed delays instead of a deterministic scheduler, resource, or state boundary;
  - UI enable/disable/visibility or mode-gating logic versus the payload, persistence, or submission path it is supposed to control;
  - any helper that could hide misconfiguration by defaulting too early;
  - any alias-migration or backward-compatibility helper where legacy and canonical fields can partially coexist in mixed-shape configs.
- For any changed queued, deferred, retried, or promoted execution path, explicitly compare request-admission validation against execution-time validation. Record a hotspot whenever model-lock checks, allowlist checks, invalid-state checks, authorization checks, or equivalent preconditions are enforced on one path but skipped on another.
- For any changed route, service, or orchestration boundary whose tests mock a downstream seam to produce the expected contract error, record whether there is also direct proof that the production boundary itself performs the validation. If not, mark that proof as indirect and add a review hotspot for mocked-seam false confidence.
- Identify any changed external contract surfaces OUTSIDE the allowed spelling/grammar-only support-file set that need explicit before/after comparison in findings:
  - API routes;
  - config file shapes;
  - persisted artifacts;
  - wrapper outputs;
  - log marker/event schemas;
  - legacy alias/deprecated-input compatibility where old and new field shapes may coexist.
- Note where backward-compatibility risk exists and where the canonical plan explicitly permits an edge-case deviation from generic best practice.
- For each changed orchestration function that initializes external providers, clients, dispatchers, locks, or other runtime dependencies, record whether any no-op, metadata-only, delete-only, or zero-work fast path can complete before that initialization happens. If the answer is unclear, add that ordering question to the review hotspots and the `Risk-Invariant Matrix`.
- When a fast path is intended to complete without embedding, network, model, or provider work, record the exact dependency-free invariant that the findings pass must challenge explicitly.
- If an acceptance test proves only terminal status semantics for a fast path, but does not prove behavior under provider or bootstrap failure, mark that proof as indirect rather than direct.
- For each changed env/config parser, record the value domain the downstream code expects, including empty-string or whitespace behavior, lower and upper bounds, and whether invalid values must clamp, fallback, or fail.
- For each changed query/filter/bulk selector that scales with repository, file, chunk, or symbol count, record the growth dimension, whether the implementation batches or bounds request size, and whether the active story explicitly targets large-repository or large-file behavior.
- If a changed helper registers waiters, listeners, callbacks, subscriptions, or queue entries into shared state, record whether every exit path unregisters them, including success, timeout, rejection, cancellation, and early-return paths.
- If a changed helper chooses between persisted hints and freshly observed values, record whether the current-success path needs different precedence from zero-work or degraded fallback paths.
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

</hotspot_catalog>
