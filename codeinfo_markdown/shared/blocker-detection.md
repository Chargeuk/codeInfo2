# Blocker Detection Contract

Use this file whenever an agent must decide whether a task has a live blocker.

This contract is intentionally procedural. The goal is to remove guesswork and make blocker checks depend on one repeatable parse path instead of visual scanning.

## Critical Rule

A task has a live blocker only when that task's section contains a markdown list item whose line begins exactly with:

```md
- **BLOCKER**
```

Nothing else counts as a live blocker.

These do not count:

- inline mentions of `**BLOCKER**` inside prose
- `**BLOCKING ANSWER**`
- `**RESOLVED ISSUE**`
- blocker text that belongs to a different task section

## Required Inputs

Before checking for blockers, the agent must:

1. Read `codeInfoStatus/flow-state/current-plan.json`.
2. Resolve the stored `plan_path`.
3. Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md` and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile blocker-repair --task-number <selected-task-number>`.
4. Select the relevant task exactly as the calling prompt defines it:
   - highest `__in_progress__` task
   - highest `__in_progress__` or `__done__` task
   - or a specific task number

## Required Procedure

Do not rely on visual scanning.

Run the canonical parser:

```bash
python3 "$CODEINFO_ROOT/scripts/plan_status.py"
```

Use flags when needed:

```bash
python3 "$CODEINFO_ROOT/scripts/plan_status.py" --selector active
python3 "$CODEINFO_ROOT/scripts/plan_status.py" --selector active_or_done
python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 94
python3 "$CODEINFO_ROOT/scripts/plan_status.py" --plan planning/0000055-users-can-queue-ingest-and-re-embed-requests.md --selector active_or_done
python3 "$CODEINFO_ROOT/scripts/plan_status.py" --include-tasks
```

Use the parser output as the source of truth when it returns usable output.

Manual fallback is allowed only when the canonical parser cannot be used operationally because the script is missing, unreadable, the Python interpreter is unavailable, the command exits before producing usable JSON, or the output is empty or malformed.

Do not use manual fallback when the parser returned valid output, even if that output is a negative result such as no selected task or zero live blockers.

## Decision Rules

Use the parser output, not narrative judgment.

- If the selected task reports one or more `live_blockers`, the blocker answer is `yes`.
- If the selected task reports zero `live_blockers`, the blocker answer is `no`.
- If no task matches the requested selector, answer according to the calling prompt's fallback rule.
- If the parser cannot be used under the manual-fallback rule above, use `rg -n --max-count` plus one exact `sed -n` range to recreate only the same selector or explicit task-number choice requested by the calling prompt.
- In that permitted manual fallback, treat a blocker as present only when the selected task section contains a markdown list item whose line begins exactly `- **BLOCKER**`.
- During manual fallback, ignore inline prose mentions of `**BLOCKER**`, ignore `**BLOCKING ANSWER**`, ignore `**RESOLVED ISSUE**`, and ignore blocker text outside the selected task section.
- If the parser fails and the selected task still cannot be identified safely from that bounded fallback, stop and report that blocker status could not be determined.

## Output Requirements For Prompt Authors

When a prompt asks an agent to check for blockers, it should require the agent to report or internally verify:

- the selected task number
- the selected task status
- the matching blocker line numbers, if any

This prevents silent false negatives.

## Notes

- The parser scopes blocker matches to a task section bounded by `### Task <n>. ...`.
- The parser matches only exact live-blocker bullets at line start.
- The parser also reports task-status and checklist state; use `--include-tasks` only when a prompt genuinely needs the full task list.
- `$CODEINFO_ROOT/scripts/plan_blocker_status.py` remains a compatibility wrapper, but `$CODEINFO_ROOT/scripts/plan_status.py` is the canonical source of truth.
