# Subflow waves and generic review batches

`subflowWave` starts a bounded set of child flows concurrently. It is not review-specific: a wave may use static `groups` or discover a caller-supplied array through `groupsFrom`, expands matrix and singleton groups from immutable flow input, starts every viable child, and waits for every terminal outcome.

## Authoring contract

Static scheduling is useful when a parent owns a fixed policy. Dynamic scheduling lets a reusable child consume any group configuration without knowing reviewer names or counts:

```json
{
  "type": "subflowWave",
  "label": "Run configured review batch",
  "groupsFrom": "review_groups",
  "failureMode": "best_effort",
  "reviewWorkspace": {
    "snapshotFrom": "review_batch_targets"
  }
}
```

Groups use the existing matrix and singleton shapes. Bindings may resolve values from flow state through `input`, or carry immutable JSON scheduling configuration through `inputValues`. Matrix bindings additionally expose the current item through `itemName`. Bound input is normalized, hashed, and persisted with the child identity.

A missing binding, empty matrix, duplicate group, duplicate matrix flow name, or duplicate expanded instance fails launch before ambiguous work is accepted. Instance IDs are stable within immutable input: matrix jobs use `<group-id>:<target-id>:<flow-name>` and singleton jobs use `<group-id>:<flow-name>`.

## Runtime and observability

The parent persists `flags.flow.subflowWaveProgress` with running and terminal outcome counts plus every job's identity, title, and status. Cancellation is broadcast to active children. Resume reattaches through persisted instance ID, run token, immutable input hash, working folder, and title instead of launching a duplicate child.

Review waves use best-effort completion. One unavailable child does not erase usable sibling work or stop later recovery, reconciliation, fixing, or settlement steps.

## Review target and workspace model

`prepareReviewTargets` snapshots the plan-host repository plus every additional plan-scope repository. Each target records a real repository root, story branch, full HEAD, and comparison base. Every root must already be an ingested separate checkout or worktree; review execution never switches branches in a shared checkout.

When `reviewWorkspace` is configured, the scheduler creates an immutable batch before launching children:

```text
codeInfoTmp/reviews/<cycle-or-standalone-pass>/batches/<wave>--head-<commit>/
  batch-launch.md
  inputs/<target>/
    review-target.md
    story-context.md
  jobs/<instance>/
    job.md
    work/
    output/
    verification/
  reconciliation/
```

Every job exists before its reviewer starts, so a crash or empty response remains discoverable. Reviewers receive only their assigned directories and common agent-readable inputs. They may use any internal command, intermediate files, or output layout. They finish by writing the clearest self-describing result they can under `output/`; there is no provider pointer, result schema, expected-count join, or publisher.

The stable `<story>-current-review-batch.md` and target-local reviewer job locators point agents to immutable workspaces. They are navigation aids for the supported single top-level review flow, not ownership locks or review-result records.

## Consumption and scheduling

The verifier discovers every directory under `jobs/`, checks factual workspace and Git state, repairs output from preserved native work where possible, and records honest unavailable evidence otherwise. Reconciliation, disposition, fixing, and settlement agents consume the discovered self-describing files without knowing which providers ran or how many reviewers were configured.

Scheduling class belongs only to the caller. The current complete-story policy runs one configured group repeatedly, exiting early when another direct-fix review is not useful and continuing through the same path after the fifth iteration, then runs another configured group once. A reviewer can move between groups—or a new reviewer can be added—without changing the reviewer flow, workspace contract, or consumer pipeline.
