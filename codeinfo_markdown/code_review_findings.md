## Task

Continue the current story review using ONLY the handoff file written by the previous review-evidence step. Perform the findings pass for the selected repositories and produce findings only.

## Critical Rules

- Do NOT discover the latest review artifact by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and normalize it using the same two-shape rule as the evidence step.
- Then read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit the plan.
- If the review handoff checks fail, stop and say the review handoff is stale and must be regenerated. Do not edit the plan.
- If the handoff is valid, perform the actual review against the planned work and the branch diff for every selected repository.
- This step MUST produce findings only and MUST NOT edit the plan yet.
- Do not commit in this step unless you were forced to make tracked changes to repair the review artifacts themselves.
- Treat `flows/**` as approved workflow-support paths. Do not raise findings solely because those paths changed without being named in the active plan, but continue to review them normally for workflow semantics, instruction safety, stale-handoff handling, commit/push behavior, plan-selection rules, and other agent-control correctness.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not raise findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, review ONLY for spelling, grammar, and obvious wording mistakes. Do NOT raise findings about scope creep, unwanted changes, workflow semantics, runtime safety, contract correctness, artifact hygiene, path usage, plan-selection rules, or revert recommendations for them.

## Scope And Inputs

### Current-Plan Handoff Shapes

- Legacy single-repository shape:

```json
{ "plan_path": "planning/<story-file>.md" }
```

- Multi-repository shape:

```json
{ "story_id": "<story-number>", "review_mode": "single_repo" | "multi_repo", "repos": [ ... ] }
```

### Current-Plan Normalization Rules

- If the legacy single-repository shape is present, treat it as a single repo entry rooted at the current repository.
- If the `repos` array shape is present, use ONLY those repo entries.

### Review Handoff Requirements

Read `codeInfoStatus/reviews/<story-number>-current-review.json` and verify that:

- its `story_id` matches the normalized current-plan handoff;
- its `review_mode` is compatible with that handoff;
- its `review_pass_id` is present;
- its referenced evidence file exists;
- its `repos` entries still match the selected repositories, plans, branches, base branches, and current HEAD commits.

## Validation And Stop Conditions

Before doing findings work, validate all of the following:

- every selected plan exists;
- every selected plan filename carries the same story number;
- each participating repository branch matches that story number;
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

1. Perform the plan-based review against the planned work and the branch diff for every selected repository.
2. After the plan-based review, perform a second pass that is not limited by the acceptance criteria and look for generic engineering defects in the changed code even if the active plan did not mention them.
3. This second pass applies to the non-support-file changes only.
4. In that second pass, prioritize:
   - invalid input being silently normalized into success;
   - warnings/errors/reason values produced by helpers but dropped by callers;
   - inconsistent schema or value vocabularies for the same log marker/event/response field across surfaces;
   - bootstrap/existence checks that may misclassify files/directories/invalid paths;
   - duplicate or conflicting object keys/payload fields;
   - deleted/moved/conditional validation;
   - partial-failure behavior;
   - dead-field or dead-branch risk;
   - logic that hides misconfiguration by falling back too early.
5. For multi-repository stories, include cross-repository generic engineering defects such as:
   - producer/consumer schema drift;
   - one-sided migrations;
   - incompatible fallback precedence between repositories;
   - sequencing that breaks mixed-version operation.
6. In that second pass, you MUST also perform a generic adversarial review for the non-support-file changes and explicitly ask:
   - Could this changed code behave incorrectly because of execution-routing or harness rules that live in unchanged files, including `testMatch`/`testIgnore`, filename or suffix conventions, tags, worker-count or project assignment, startup registration, feature flags, or env wiring?
   - Does any changed test modify shared state, shared temp paths, locks, caches, singleton resources, or persisted artifacts, and if so, what guarantees that it runs in the correct serialized project and cannot interfere with parallel suites, retries, or other project variants?
   - For any changed reader and writer pair over the same file, directory, or persisted artifact, are writes atomic or otherwise safe to observe, do readers tolerate partial writes, and can cleanup or delete paths remove a live resource owned by another actor?
   - Could `missing`, `malformed`, or `incomplete` state be a transient in-progress state rather than a truly stale state, and if so, does the code use ownership proof, age checks, retries, or atomic rename or write patterns before treating that state as stale?
   - Does any cleanup, stale-lock, or recovery logic risk false-positive deletion, reset, or takeover of live state owned by another process, worker, tab, or test?
   - Are there lifecycle or ordering hazards across create or acquire, in-progress, steady-state, cancel, retry, release, teardown, and crash-recovery paths that are not covered by the happy-path tests?
   - Does correctness depend on an unchanged config or harness file that must be opened to review the change honestly? If yes, inspect it and include the result in the findings.
7. For changed tests, treat test code with the same review rigor as production code. Do not accept a changed test as sufficient proof of correctness until you have also checked isolation, shared-state safety, project membership, worker-safety, teardown behavior, and interaction with other suites.
8. For changed code that reads state written by another actor, explicitly compare the writer and reader implementations together rather than reviewing them in isolation.
9. Raise a finding when a concurrency-sensitive, lifecycle-sensitive, cleanup-sensitive, or harness-sensitive path has only happy-path proof or depends on an unstated serialization convention.
10. For every changed API route, config shape, persisted artifact, wrapper output, or shared log marker/event schema OUTSIDE the allowed spelling/grammar-only support-file set, perform a before/after contract comparison and state whether the change is backward compatible, intentionally breaking, or unclear.
11. For every changed helper that merges, normalizes, or defaults config/runtime/user input before validation OUTSIDE the allowed spelling/grammar-only support-file set, verify that malformed input is not silently dropped, coerced into `{}`, or replaced by inherited defaults before validation can reject it. Also check whether validation was deleted, moved later, or made conditional in a way that weakens the previous contract.
12. For any changed normalization, alias-migration, or backward-compatibility helper OUTSIDE the allowed spelling/grammar-only support-file set, compare old vs new behavior for mixed-shape inputs where legacy and canonical fields partially coexist. Flag regressions where a guard changed from checking whether the canonical field exists to checking only whether the parent object exists, or any similar narrowing that makes previously accepted configs stop working.
13. For any changed function OUTSIDE the allowed spelling/grammar-only support-file set that returns warnings/errors/reason metadata or otherwise mixes data with diagnostics, trace each changed caller and state whether those diagnostics are surfaced to clients, logged, or intentionally dropped. If dropped, decide whether that is an intentional contract choice or a defect.
14. If the same log marker, event name, or response field is emitted from more than one code path OUTSIDE the allowed spelling/grammar-only support-file set, compare the emitted schema and value vocabulary across those emitters and flag mismatches that would make downstream parsing, analytics, or operational debugging ambiguous.
15. For fallback-selection logic OUTSIDE the allowed spelling/grammar-only support-file set, verify that precedence still matches the active plan and does not override explicit user intent.
16. For partial-failure logic outside that set, verify what happens when only part of the resolution succeeds and whether the resulting behavior is explicit, safe, and observable.
17. Before raising a finding about bootstrap, existence checks, or invalid-path handling in the non-support-file changes, compare the implementation against the story's explicit edge cases or failure-mode contract and do not raise a finding solely because the code differs from a generic best practice if it matches the plan's stated contract.
18. At minimum, inspect the top 3 changed helpers/functions by review risk from the evidence artifact, excluding the allowed spelling/grammar-only support files, and explicitly ask what malformed or contradictory input could still make each one behave incorrectly even if the current tests pass.
19. For each risky path above, state whether it has direct proof, indirect proof, or missing proof, and raise a finding when a risky path is only protected by happy-path coverage or is otherwise weakly proven.
20. Look for new fields that are written but never read, branches that cannot be reached under the current contract, and diagnostics that are intentionally hidden from clients without an actionable log trail in the non-support-file changes.
21. When a valid, low-risk consistency problem is found in files already changed by the story, and the fix does not change public payloads or otherwise broaden scope, prefer `should_fix` over `optional_simplification` so the cleanup is attempted rather than deferred by default. This guidance does not override the spelling/grammar-only rule for the allowed support files.

## Output Contract

Write the findings to `codeInfoStatus/reviews/<review_pass_id>-findings.md`.

The findings file MUST:

- use findings-first ordering by severity;
- include file references;
- classify each finding as `must_fix`, `should_fix`, or `optional_simplification`;
- state for each finding whether it is a `plan_contract_issue` or a `generic_engineering_issue`;
- identify the affected repository scope for every finding:
  - `affected_repos: [ "<repo_id>" ]` for repo-local findings;
  - `affected_repos: [ "<repo_id-a>", "<repo_id-b>" ]` or more for cross-repository findings.

Cross-repository findings are valid when the issue only becomes visible when comparing two or more repositories together, even if each repository looks individually plausible.

If no findings exist:

- state that explicitly;
- also record any residual risks or weak-proof areas.

Update the same handoff file so `findings_file` points to the exact findings artifact, and include any useful counts or disposition hints, including per-repository or cross-repository grouping when relevant.

This findings file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.

## Verification Before Finalizing

Before you finish this step, verify all of the following:

- the current-plan handoff was normalized correctly;
- every selected plan and branch still matches the story number;
- the review handoff still matches the current scope and HEAD commits;
- the plan-based review was completed for every selected repository;
- the cross-repository integration pass was completed when required;
- the generic engineering pass and the generic adversarial review were both completed;
- the top 3 risky helpers/functions from the evidence artifact were inspected;
- all findings include severity, issue type, and affected repository scope;
- no finding was raised against allowed support files for anything other than spelling, grammar, or obvious wording mistakes;
- the findings file path and the handoff `findings_file` field match.

## Final Response

Never recommend reverting or removing the allowed support-file changes merely because they exist. Only call out spelling, grammar, or obvious wording mistakes in those files.
