# Subflow waves and repository review sets

`subflowWave` is a generic flow step for starting a bounded set of child flows concurrently. It is not review-specific: a wave combines any number of matrix groups with singleton groups, expands them once from immutable flow input, starts every viable child, and waits for every terminal outcome.

## Authoring contract

```json
{
  "type": "subflowWave",
  "label": "Run review wave",
  "groups": [
    {
      "kind": "matrix",
      "id": "target-reviews",
      "itemsFrom": "review_wave.targets",
      "itemName": "review_target",
      "flowNames": [
        "review_artifacts_main",
        "codex_review",
        "open_code_review"
      ],
      "bindings": {
        "workingFolderFrom": "review_target.repo_root",
        "input": {
          "review_target": "review_target",
          "review_wave": "review_wave"
        }
      }
    },
    {
      "kind": "singleton",
      "id": "cross-repository",
      "flowName": "cross_repository_review",
      "bindings": {
        "workingFolderFrom": "review_wave.plan_host_root",
        "input": { "review_wave": "review_wave" }
      }
    }
  ]
}
```

Binding paths resolve against the parent input and prior deterministic flow-step outputs. Matrix bindings additionally expose the current item through `itemName`. Bound input must remain JSON-only and is normalized, hashed, and persisted with the active child identity. A missing binding, empty matrix, duplicate group, duplicate matrix flow name, or duplicate expanded instance fails validation or launch before ambiguous work is accepted.

Instance IDs are stable within the immutable input: matrix jobs use `<group-id>:<item-index>:<flow-name>` and singleton jobs use `<group-id>:<flow-name>`. Repeated flow names receive target-aware titles such as `codex_review [payments-api]`; their parent-wave execution ID, instance ID, target ID, and display name are exposed in server-owned `flags.flowChild` metadata.

## Runtime and observability

The parent persists `flags.flow.subflowWaveProgress` with `expected`, `running`, `completed`, `failed`, `stopped`, and `notApplicable` counts plus every job's stable identity, title, and status. The same counts appear in the live and terminal parent assistant turns and in structured `flows.run.subflow_wave_progress` logs. Ordinary `subflow` steps retain their existing behavior and metadata.

Cancellation is broadcast to all active children. A terminal parent snapshot accounts for unlaunched jobs as stopped and launch failures as failed. Resume reattaches through the persisted instance ID, run token, immutable input hash, working folder, and title; it does not relaunch a remembered child. A child may publish the generic terminal outcome `not_applicable`, which is counted separately from successful work.

## Review-target model

Before each story review pass, `prepareReviewTargets` reads the active plan and creates a new immutable snapshot. The snapshot contains the plan-host repository plus every additional plan-scope repository, with a stable alias/target ID, real repository root, checked-out story branch, full HEAD commit, and comparison base. Every root must already be an ingested repository and a separate checkout/worktree; the runtime never switches branches in a shared checkout.

For `N` targets, the production review wave expands to `3N + 1` jobs: three single-target reviewers per repository and one story-scoped cross-repository reviewer. Each target-local child is bound to that target's repository root and receives only its explicit target contract. The cross-repository child owns integration findings spanning repository boundaries. With one target it writes `not_applicable` and exits before expensive review work; with multiple targets it runs alongside the target-local reviews. Post-wave aggregation validates and merges its output but does not perform a second cross-repository diff review.

## Artifact layout and ownership

The plan host owns story-level coordination artifacts under `codeInfoTmp/reviews/`:

- `<story>-current-review-targets.json` and a wave-versioned target snapshot;
- `<story>-current-review-set.json` and a wave-versioned prepared manifest;
- `<story>-current-cross-repository-review.json` and its wave-versioned result;
- `<story>-current-review-wave-validation.json` and the finalized review set.

Each target repository owns its prepared context/base and its three target-local review pointers under that repository's own `codeInfoTmp/reviews/`. Every pointer carries the story, wave, target, branch, HEAD, and parent execution identity, so one target cannot overwrite or validate another target's evidence. The finalized review-set manifest enumerates every expected matrix cell and singleton, preserves partial/failed coverage, aggregates target-owned findings, and blocks a clean multi-target closeout when cross-repository coverage is missing or invalid.

Downstream review-loop prompts must read `codeinfo_markdown/shared/review-wave-consumer-contract.md` before consuming findings. Fixes lead to a new target snapshot and wave ID on the next pass, so stale results remain versioned evidence without replacing the current stable pointers.
