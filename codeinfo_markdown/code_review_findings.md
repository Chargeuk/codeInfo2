## Task

Continue the current story review using ONLY the handoff file written by the previous review-evidence step. Perform the findings pass for every repository in review scope and produce findings only.

## Critical Rules

- Do NOT discover the latest review artifact by timestamp.
- Use fresh disk reads and current git state, not conversational memory. Re-read `codeInfoStatus/flow-state/current-plan.json` from disk and determine the canonical `plan_path`, then extract repository paths from `additional_repositories` and re-open the exact relative `plan_path` from disk.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then re-read `codeInfoStatus/reviews/<story-number>-current-review.json` from disk, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit the plan.
- If the review handoff checks fail, stop and say the review handoff is stale and must be regenerated. Do not edit the plan.
- If the handoff is valid, perform the actual review against the planned work and the branch diff for every repository in scope.
- This step MUST produce findings only and MUST NOT edit the plan yet.
- Do not commit in this step unless you were forced to make tracked changes to repair the review artifacts themselves.
- Treat `flows/**` as approved workflow-support paths. Do not raise findings solely because those paths changed without being named in the active plan, but continue to review them normally for workflow semantics, instruction safety, stale-handoff handling, commit/push behavior, plan-selection rules, and other agent-control correctness.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not raise findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, review ONLY for spelling, grammar, and obvious wording mistakes. Do NOT raise findings about scope creep, unwanted changes, workflow semantics, runtime safety, contract correctness, artifact hygiene, path usage, plan-selection rules, or revert recommendations for them.

## Scope And Inputs

### Current-Plan Scope Resolution

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.

### Review Handoff Requirements

Read `codeInfoStatus/reviews/<story-number>-current-review.json` and verify that:

- its `story_id` matches the story number derived from the canonical current-plan `plan_path` filename;
- its `review_pass_id` is present;
- its referenced evidence file exists;
- its `repos` entries still match the selected repositories, current branch names, resolved base branches, and current HEAD commits.

Treat each stored `resolved_base_branch` as the already-resolved review base chosen by the evidence step. It may come either from the repository default branch or from branch ancestry hinted by `current-plan.json`, so do not re-resolve a different base in this step unless the review handoff is stale and must be regenerated.

## Validation And Stop Conditions

Before doing findings work, validate all of the following:

- the canonical plan exists;
- the current repository branch state still matches the canonical plan story number, re-checked directly from git, for example with `git branch --show-current`;
- every repository in scope is still on a branch whose story number matches the canonical plan filename;
- every additional repository branch state was re-checked directly from git, for example with `git -C <repo_root> branch --show-current`;
- the current repository HEAD and each additional repository HEAD were re-checked directly from git, for example with `git log --oneline -1` or `git -C <repo_root> log --oneline -1`;
- the review handoff still matches the normalized current-plan scope and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review-handoff checks fail, stop and say the review handoff is stale and must be regenerated.

## Required Review Areas

For all changed files outside the allowed support-file set, review:

- correctness against the story plan;
- acceptance criteria coverage;
- code quality;
- maintainability;
- performance;
- security;
- configuration/runtime correctness;
- user-facing documentation portability;
- documentation drift;
- scope creep;
- whether the code is more verbose or complex than needed and could be made more succinct without sacrificing quality.

For multi-repository stories, you MUST also perform an explicit cross-repository integration pass after the per-repository review. That cross-repository pass must inspect:

- shared APIs;
- shared types;
- shared message or storage contracts;
- env/config names;
- compatibility assumptions;
- dependency direction;
- migration sequencing;
- any producer/consumer mismatch that would not be visible when looking at one repository alone.

## Exact Review Passes

1. Perform the plan-based review against the planned work and the branch diff for every repository in scope.
2. After the plan-based review, perform a second pass that is not limited by the acceptance criteria and look for generic engineering defects in the changed code even if the canonical plan did not mention them.
3. This second pass applies to the non-support-file changes only.
4. In that second pass, prioritize:
   - invalid input being silently normalized into success;
   - warnings/errors/reason values produced by helpers but dropped by callers;
   - raw-to-wrapped error translation mismatches where a lower layer now normalizes or wraps errors but a caller still branches on the old raw error shape;
   - stale persisted hints, cached values, or collection-level metadata that can override fresher values observed during the current run because precedence rules are too broad;
   - inconsistent schema or value vocabularies for the same log marker/event/response field across surfaces;
   - duplicated literals where a nearby named constant already defines the same contract value;
   - dependency or bootstrap initialization that happens before the code proves real work exists, especially on no-op, delete-only, metadata-only, or zero-work fast paths;
   - bootstrap/existence checks that may misclassify files/directories/invalid paths;
   - env/config parsers that accept empty-string, whitespace, zero, negative, or oversized values even though downstream code assumes a smaller safe domain;
   - waiter, listener, callback, subscription, or queue registrations that are cleaned up on success but can leak on timeout, rejection, cancellation, or early return;
   - duplicate or conflicting object keys/payload fields;
   - deleted/moved/conditional validation;
   - partial-failure behavior;
   - dead-field or dead-branch risk;
   - logic that hides misconfiguration by falling back too early;
   - query builders, delete filters, or bulk selectors whose size grows with repository, file, chunk, or symbol count without batching, paging, or another bounding strategy;
   - absolute local filesystem links in changed user-facing docs such as `README.md` or `docs/**`;
   - changed mocks or test helpers that accept `AbortSignal`, cancellation flags, or timeout controls but never inspect already-aborted or already-cancelled state at construction time;
   - fast paths that are supposed to be provider-free but still depend on fallback helpers that can call the provider or network indirectly.
5. For multi-repository stories, include cross-repository generic engineering defects such as:
   - producer/consumer schema drift;
   - one-sided migrations;
   - incompatible fallback precedence between repositories;
   - sequencing that breaks mixed-version operation.
6. In that second pass, you MUST also perform a generic adversarial review for the non-support-file changes and explicitly ask:
   - Could this changed code behave incorrectly because of execution-routing or harness rules that live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, or env wiring?
   - Does the default launcher, wrapper, dispatcher, CI flow, or startup path still execute the changed behavior without manual overrides, or has the change silently made the new path opt-in?
   - Could a disabled, hidden, or mode-gated UI control still leak stale state into a request, persisted draft, or derived payload, and have you compared the UI gating rules with the payload-construction and reset paths directly?
   - Does any changed test modify shared state, shared temp paths, locks, caches, singleton resources, or persisted artifacts, and if so, what guarantees that it runs in the correct serialized project and cannot interfere with parallel suites, retries, or other project variants?
   - For any rename, ignore-rule, suffix, tag, project-assignment, or classification change, what no longer runs by default after this change, and is that exclusion intentional, proven, and reflected in the plan?
   - For any changed config, dispatcher, wrapper, CI, npm-script, or startup selector, have you inspected the corresponding consumer or launcher path that determines whether the new behavior is actually reachable in the standard flow?
   - For any changed reader and writer pair over the same file, directory, or persisted artifact, are writes atomic or otherwise safe to observe, do readers tolerate partial writes, and can cleanup or delete paths remove a live resource owned by another actor?
   - Could `missing`, `malformed`, or `incomplete` state be a transient in-progress state rather than a truly stale state, and if so, does the code use ownership proof, age checks, retries, or atomic rename or write patterns before treating that state as stale?
   - Does any cleanup, stale-lock, or recovery logic risk false-positive deletion, reset, or takeover of live state owned by another process, worker, tab, or test?
   - Are there lifecycle or ordering hazards across create or acquire, in-progress, steady-state, cancel, retry, release, teardown, and crash-recovery paths that are not covered by the happy-path tests?
   - Does correctness depend on an unchanged config or harness file that must be opened to review the change honestly? If yes, inspect it and include the result in the findings.
7. For changed tests, treat test code with the same review rigor as production code. Do not accept a changed test as sufficient proof of correctness until you have also checked isolation, shared-state safety, project membership, worker-safety, teardown behavior, interaction with other suites, and whether the test title or description still matches the invariant that its assertions actually prove.
8. When a changed test proves that something has not happened yet, prefer a deterministic scheduler, resource, or state boundary over an arbitrary elapsed-time sleep. Raise a weak-proof concern or finding when a fixed-delay negative assertion is used even though the code under test exposes a stronger observable boundary.
9. For changed code that reads state written by another actor, explicitly compare the writer and reader implementations together rather than reviewing them in isolation.
10. For changed config, dispatcher, wrapper, CI, npm-script, or startup selector logic, explicitly compare the selector and consumer paths together rather than reviewing them in isolation.
11. For changed env/config parsers, verify that empty-string and whitespace-only inputs are either treated as unset, clamped safely, or rejected, rather than silently coerced into dangerous values.
12. For changed numeric env/config inputs, verify that the parser enforces the domain the downstream code assumes, including lower bounds, upper bounds, and closed or half-open intervals such as `(0, 1]`.
13. Raise a finding when downstream code assumes a constrained config domain but the parser accepts a wider range that can produce invalid limits, oversize requests, disabled guards, negative sizes, or pathological performance.
14. For changed query builders, delete filters, or bulk selectors, verify whether filter size or payload size grows with repository, file, chunk, or symbol count, and raise a finding when that growth is left unbounded in a large-repository or large-file path without batching, paging, generation tagging, or another bounding strategy.
15. For changed helpers that register waiters, listeners, callbacks, subscriptions, or queue entries into shared state, verify that cleanup happens on every exit path, including timeout, rejection, cancellation, and early return. Raise a finding when registrations can leak into later tests or runs.
16. For changed fallback-selection or precedence helpers, explicitly compare stale persisted hints or cached values against fresher values observed during the current execution. Raise a finding when the helper prefers the stale hint even after the current run has learned a more authoritative value.
17. Raise a finding when a concurrency-sensitive, lifecycle-sensitive, cleanup-sensitive, or harness-sensitive path has only happy-path proof or depends on an unstated serialization convention.
18. Raise a finding when a change can silently skip tests, disable coverage, move checks out of the default validation path, or make important behavior reachable only through a manual or non-default invocation, unless that deviation is explicitly planned, intentional, and directly proven.
19. For every changed API route, config shape, persisted artifact, wrapper output, or shared log marker/event schema OUTSIDE the allowed spelling/grammar-only support-file set, perform a before/after contract comparison and state whether the change is backward compatible, intentionally breaking, or unclear.
20. For every changed helper that merges, normalizes, or defaults config/runtime/user input before validation OUTSIDE the allowed spelling/grammar-only support-file set, verify that malformed input is not silently dropped, coerced into `{}`, or replaced by inherited defaults before validation can reject it. Also check whether validation was deleted, moved later, or made conditional in a way that weakens the previous contract.
21. For any changed normalization, alias-migration, or backward-compatibility helper OUTSIDE the allowed spelling/grammar-only support-file set, compare old vs new behavior for mixed-shape inputs where legacy and canonical fields partially coexist. Flag regressions where a guard changed from checking whether the canonical field exists to checking only whether the parent object exists, or any similar narrowing that makes previously accepted configs stop working.
22. For any changed function OUTSIDE the allowed spelling/grammar-only support-file set that returns warnings/errors/reason metadata or otherwise mixes data with diagnostics, trace each changed caller and state whether those diagnostics are surfaced to clients, logged, or intentionally dropped. If dropped, decide whether that is an intentional contract choice or a defect.
23. For any changed error-mapping, normalization, retry, or provider wrapper helper OUTSIDE the allowed spelling/grammar-only support-file set, inspect all changed callers that branch on raw error names, raw SDK classes, provider-specific error codes, retryability, or cancel-vs-terminal semantics. Raise a finding when the producer now emits a wrapped or normalized error shape but the consumer still expects the old raw shape.
24. If the same log marker, event name, or response field is emitted from more than one code path OUTSIDE the allowed spelling/grammar-only support-file set, compare the emitted schema and value vocabulary across those emitters and flag mismatches that would make downstream parsing, analytics, or operational debugging ambiguous.
25. For fallback-selection logic OUTSIDE the allowed spelling/grammar-only support-file set, verify that precedence still matches the canonical plan and does not override explicit user intent.
26. For partial-failure logic outside that set, verify what happens when only part of the resolution succeeds and whether the resulting behavior is explicit, safe, and observable.
27. Before raising a finding about bootstrap, existence checks, invalid-path handling, config-domain enforcement, scale-bounded query construction, stale-hint precedence, or shared-registration cleanup in the non-support-file changes, compare the implementation against the story's explicit edge cases or failure-mode contract and do not raise a finding solely because the code differs from a generic best practice if it matches the canonical plan's stated contract.
28. For every changed orchestration path with a no-op, metadata-only, delete-only, or zero-work fast return, verify that external dependency setup such as model lookup, provider client creation, dispatcher creation, lock acquisition, or network/bootstrap probes happens only after the code proves that real work still exists, unless the canonical plan explicitly requires that dependency for the fast path.
29. If a fast path is meant to complete without embedding work, compare every helper it calls against that contract and raise a finding when a fallback helper can still reach the provider, network, or runtime dependency indirectly.
30. Treat terminal-state tests for fast paths as incomplete proof unless at least one test or direct code inspection also proves behavior when the external provider or bootstrap dependency is unavailable.
31. At minimum, inspect the top 3 changed helpers/functions by review risk from the evidence artifact, excluding the allowed spelling/grammar-only support files, and explicitly ask what malformed or contradictory input, mixed UI state, stale hidden value, premature dependency initialization, wrapped-error taxonomy mismatch, config-domain mismatch, stale-hint precedence mistake, leaked shared registration, or scale-bounded query failure could still make each one behave incorrectly even if the current tests pass.
32. Write a `Rejected Risk Notes` section after the main findings list. For each top-risk helper/function from the evidence matrix, record:

- the candidate semantic mismatch or contradictory input you tried to break it with;
- whether that risk became an endorsed finding, a rejected risk, or a residual weak-proof concern;
- the direct file or test evidence that justified that decision;
- what still remains weak if the risk could not be fully disproven.

33. If `codeInfoStatus/reviews/<review_pass_id>-blind-spot-challenge.md` already exists for this pass, read it and reconcile it with the findings output. If it does not exist yet, still complete the `Rejected Risk Notes` section directly from the evidence artifact, branch diff, and current findings so downstream steps do not depend on the new challenge step to function.
34. For each risky path above, state whether it has direct proof, indirect proof, or missing proof, and raise a finding when a risky path is only protected by happy-path coverage or is otherwise weakly proven.
35. Look for new fields that are written but never read, branches that cannot be reached under the current contract, and diagnostics that are intentionally hidden from clients without an actionable log trail in the non-support-file changes.
36. When a valid, low-risk consistency problem is found in files already changed by the story, and the fix does not change public payloads or otherwise broaden scope, prefer `should_fix` over `optional_simplification` so the cleanup is attempted rather than deferred by default. This guidance does not override the spelling/grammar-only rule for the allowed support files.
37. After the main correctness and adversarial review, run a narrow consistency and portability scan on changed non-support implementation files plus changed user-facing docs such as `README.md` or `docs/**`. In that scan, look for duplicated literals that should reference an existing canonical constant, absolute local filesystem links, and changed mocks or test helpers that accept cancellation inputs but do not model already-aborted or already-cancelled state.
38. Only raise low-severity findings from that consistency and portability scan unless you can prove a real behavior defect, contract break, or validation gap.

## Output Contract

Write the findings to `codeInfoStatus/reviews/<review_pass_id>-findings.md`.

The findings file MUST:

- use findings-first ordering by severity;
- include file references;
- classify each finding as `must_fix`, `should_fix`, or `optional_simplification`;
- state for each finding whether it is a `plan_contract_issue` or a `generic_engineering_issue`;
- identify the affected repository scope for every finding using the reviewed repository roots or aliases.

Cross-repository findings are valid when the issue only becomes visible when comparing two or more repositories together, even if each repository looks individually plausible.

If no findings exist:

- state that explicitly;
- still include the `Rejected Risk Notes` section;
- also record any residual risks or weak-proof areas.

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints, including repo-local versus cross-repository grouping when relevant.

This findings file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff was normalized correctly;
- the canonical plan and story branch still match the scope;
- the review handoff still matches the current scope and HEAD commits;
- the plan-based review was completed for every repository in scope;
- the cross-repository integration pass was completed when required;
- the generic engineering pass and the generic adversarial review were both completed;
- the top 3 risky helpers/functions from the evidence artifact were inspected;
- the findings artifact includes `Rejected Risk Notes` for those risky helpers/functions;
- all findings include severity, issue type, and affected repository scope;
- no finding was raised against allowed support files for anything other than spelling, grammar, or obvious wording mistakes;
- the findings file path and the handoff `findings_file` field match.

## Final Response

Never recommend reverting or removing the allowed support-file changes merely because they exist. Only call out spelling, grammar, or obvious wording mistakes in those files.
