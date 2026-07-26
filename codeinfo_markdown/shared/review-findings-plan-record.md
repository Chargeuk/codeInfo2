# Human-Readable Review Findings Plan Record

Use this contract whenever an agent creates, repairs, verifies, or consumes a durable `## Code Review Findings` block in a story plan.

The plan record is a human-readable projection of flexible self-describing review evidence. Interpret source artifacts by meaning and make a best effort to repair understandable omissions. Do not require immutable reviewer output, reconciliation, scope, disposition, or repair artifacts to match one rigid schema.

## Section Identity And Timestamp

Keep the heading exactly:

```markdown
## Code Review Findings
```

Existing plan helpers depend on that exact heading. Put these human-readable metadata bullets immediately below it:

```markdown
- Findings recorded: `<local display timestamp>`
- Review batch: `<immutable batch id>`
- Review cycle: `<immutable cycle id>`
- Reviews attempted:
  - <human-readable review name> (`<flow name>`, job `<job instance id>`, target `<target when applicable>`) — <completed, partial, or unavailable>
    - Input tokens: <number, `At least <number> reported; incomplete`, or `Not reported`>
    - Cached input tokens: <number, `At least <number> reported; incomplete`, or `Not reported`>
    - Output tokens: <number, `At least <number> reported; incomplete`, or `Not reported`>
```

Generate the display timestamp at the time the plan block is written by running:

```bash
node "$CODEINFO_ROOT/scripts/format-display-timestamp.mjs"
```

Use its complete output, including locale and IANA time-zone identity. `CODEINFO_DISPLAY_LOCALE` and `CODEINFO_DISPLAY_TIME_ZONE` are the preferred display settings. If they are unavailable, the helper uses the runtime's resolved locale and time zone and labels both values. Never claim an unlabeled value is host-local.

The localized plan timestamp is presentation only. Preserve UTC machine timestamps, review IDs, batch IDs, cycle IDs, comparison identities, and ordering fields exactly as recorded.

## Batch Review Inventory And Optional Usage

For an immutable generic batch, discover every direct review job from the batch handoff, direct `jobs/` children, `job.md`, verification, and outcome evidence. List every attempted job exactly once, including jobs that found nothing, failed, or became unavailable. Copy the human-readable name, flow, job identity, target, and honest outcome from that evidence. Do not hard-code a reviewer list, count, scheduling group, or provider.

Inspect optional actual-review evidence under each job's `work/review-usage/` directory. Record input tokens, cached input tokens, and output tokens separately. Cached input is part of the input category and must never be added to input as an additional amount. Do not substitute whole-flow, wrapper, verification, reconciliation, filtering, fixing, testing, settlement, or plan-writing usage.

For a multi-stage review job, sum each token category independently across only the explicitly designated reviewing-model artifacts. Write an exact category total only when every applicable artifact reports that category. If some but not all artifacts report it, write `At least <known sum> reported; incomplete`. If none reports it, write `Not reported`. Preserve conflicts or questionable provenance in a concise note instead of guessing.

Usage is optional factual context only. Missing, partial, malformed, contradictory, or provider-unavailable usage never changes job outcome, finding validity, scope, materiality, repair, tasking, review-loop continuation, or closeout. Keep one batch block even when both finding categories are empty so the attempted-review inventory remains durable.

## Finding Shape

Record accepted and ignored findings with the same understandable core:

```markdown
### Accepted

#### 1. <plain-language title>

- Finding ID: `<stable identity or exact source reference>`
- Review harnesses:
  - <human-readable review flow name> (`<flow name>`, job `<job instance id>`)
- Simple description: <one to three short sentences explaining what happens and why it matters>
- Example: <a small concrete scenario showing the trigger, behavior, and problem>
- Why accepted: <why the issue is valid, authorized, realistically reachable, and materially worth repair for this story>

### Ignored for This Story

#### 2. <plain-language title>

- Finding ID or Review reference: `<stable identity or exact source reference>`
- Review harnesses:
  - <human-readable review flow name> (`<flow name>`, job `<job instance id>`)
- Simple description: <one to three short sentences explaining the claimed issue>
- Example: <a small concrete scenario showing what the claim would mean>
- Why ignored: <why it is invalid, unproven, already resolved, duplicate, outside scope, unauthorized, or below the materiality threshold>
```

Number findings continuously across both categories. If a category is empty, write `- None.`.

## Review Harness Provenance

For every finding, discover every generating or corroborating review job from the immutable batch job directories, `job.md`, launch evidence, native output, verification, and reconciliation. Preserve:

- the human-readable review name when evidence supplies one;
- the flow name;
- the exact job instance identity;
- the target or repository alias when needed to disambiguate;
- and whether a harness generated, corroborated, or only repeated the same finding when that distinction is material.

Deduplicate exact job identities and order entries deterministically by review name, target alias, flow name, and job identity.

Do not hard-code provider names, expected reviewers, reviewer counts, or scheduling groups. A newly added review flow appears automatically when its discovered job metadata supports the finding.

An artifact path or opaque source job ID alone is not an understandable harness list. When older or incomplete evidence genuinely cannot identify the harness, write one honest entry such as `Unknown review harness (source: <exact existing reference>)`; never invent a provider or silently omit provenance.

## Description And Example Quality

Keep `Simple description` limited to the issue itself. State the current behavior and the practical problem in ordinary language. Do not make the reader decode code locations, authorization language, severity labels, or implementation advice to understand the issue.

Every finding must have a concrete example. Derive one from validated repository evidence when the original reviewer omitted it. A useful example identifies:

1. the starting condition;
2. the action or event;
3. the observed behavior; and
4. why that behavior is harmful, or why the rejected claim does not establish harm.

Do not invent facts. If no honest concrete scenario can be inferred after reopening the available evidence, explain the exact missing evidence in the `Example` bullet instead of using a generic `No concrete example was recorded` placeholder.

Keep implementation advice, scope authorization, and final routing out of the simple description and example. Put those decisions only in `Why accepted` or `Why ignored`.

Only findings that survive negative scope, positive authorization, and materiality belong under `Accepted`. Preserve every removal and narrowed-away meaning from all three gates under `Ignored for This Story`. A materiality removal must say that the finding may be technically supported and positively authorized while its realistic reachability, meaningful impact, or value for changing completed code was not sufficiently demonstrated.

## Idempotency And Audit

Identify a current generic block by exact review-batch ID and a legacy block by its exact recorded review-pass identity. Update an existing matching block in place. Never create a duplicate for the same immutable review identity and never rewrite a historical block for another review identity.

Before completing:

- reopen the plan block;
- verify the timestamp is present and labelled with locale and time zone;
- verify every direct batch job appears exactly once in `Reviews attempted`, including no-findings and unavailable jobs;
- verify input, cached input, and output remain separate and every unavailable or incomplete category is labelled honestly;
- account for every accepted and ignored finding;
- confirm every finding has at least one honest harness entry;
- confirm every finding has a simple description and a concrete or explicitly evidence-limited example;
- and repair understandable omissions directly.
