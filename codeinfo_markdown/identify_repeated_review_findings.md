# Identify previously accepted review findings

Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md` and `$CODEINFO_ROOT/codeinfo_markdown/shared/repeated-review-repair.md`. This step only routes the current accepted findings; do not implement changes, invent new findings, reconsider earlier gate removals, or ask a human.

Use the scheduler-assigned batch directory and plan. Only when no scheduler assignment exists, resolve the exact immutable current batch from the canonical current-batch handoff. Read its disposition, combined filtering audit, target snapshot, and accepted finding evidence. From the target repository root, run:

```bash
python3 "$CODEINFO_ROOT/scripts/review_findings.py" list --exclude-batch '<exact current batch ID>'
```

The helper resolves the active plan through the current-plan handoff; use `--plan` only with an established explicit plan path. Read the compact historical `Accepted` records: review identity, repository, Finding ID, title, Simple description, and expansion reference. These are previously seen issues, not proof of successful fixes. Missing descriptions or legacy sections produce coverage limitations and bounded source ranges; inspect relevant ranges through the plan helpers or bounded reads before concluding there is no match. Do not silently drop older records. A partial index cannot support a blanket claim that no repeat exists.

Compare each current accepted actionable finding with the historical descriptions. Match the underlying trigger, violated behavior, and affected contract, not just the filename, wording, severity, or subsystem. Different IDs can represent the same issue. The same ID in another review or repository does not establish a match. Opposite proposed remedies for the same behavior are possible recurring conflicts and require research. Repository identity is evidence to inspect, never a guessed authority to edit.

Expand plausible matches only as needed:

```bash
python3 "$CODEINFO_ROOT/scripts/review_findings.py" expand --reference '<exact reference from list>'
```

Keep costs small: start with descriptions, expand plausible candidates, and leave root-cause investigation to research. Route each current finding as ordinary repair when evidence supports no likely historical match, or possible repeat when a match is plausible. Unresolved matching uncertainty goes to research. A missing or unavailable index requires best-effort recovery; any findings whose classification remains uncertain also go to research, while clearly classified siblings proceed normally.

Write one self-describing `repeated-findings.md` under this batch's reconciliation directory. State batch identity, purpose, evidence/coverage, each current finding and owning target, its route and reason, and every candidate's exact historical review identity, Finding ID, repository information, and expansion reference. Explicitly account for all current accepted findings, including no candidates. Do not copy the entire plan or create a permanent issue ledger. Reopen the artifact and confirm the handoff as required by the shared contract; research will append its outcomes to this same artifact.
