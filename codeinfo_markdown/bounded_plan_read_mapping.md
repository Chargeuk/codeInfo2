# Bounded Plan Read Mapping

`flows/implement_next_plan.json` and its review subflows use structured plan helpers instead of exposing complete plan Markdown to agents.

| Work family                            | Primary bounded input                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Plan selection and scope refresh       | `plan_status.py`, `story_workflow_status.py`, and `plan_sections.py --profile story-scope`                              |
| Current-task selection and orientation | `select_current_task.py`, `check_current_task_handoff.py`, and `plan_sections.py --profile current-task --task current` |
| Implementation and gotchas             | `plan_sections.py --profile implementation --task current`                                                              |
| Automated proof and task audits        | `plan_sections.py --profile automated-proof --task current` or `--profile current-task --task current`                  |
| Blocker diagnosis and repair           | `plan_blocker_status.py` and `plan_sections.py --profile blocker-repair --task current`                                 |
| Manual proof                           | `manual_testing_guidance_status.py` and `plan_sections.py --profile manual-proof --task current`                        |
| Review evidence gate                   | `plan_sections.py --profile review-evidence` for story scope, task index, and the final-task proof packet               |
| Code review findings                   | `plan_sections.py --profile review-findings`, followed by named sections for only tasks relevant to changed seams       |
| Findings saturation and blind spots    | `plan_sections.py --profile review-findings`, current review artifacts, and finding-specific task expansion             |
| Review classification and filtering    | `agent_work_context.py --view review` and `plan_sections.py --profile review-scope`                                     |
| Review-created task repair             | Fresh `plan_sections.py --profile review-tasking` output before each edit or final verification pass                    |
| Cross-task testing audit               | `plan_sections.py --profile testing-audit`; request extra named sections only for tasks needing repair                  |
| Visual design review                   | `plan_sections.py --profile review-scope`, followed by one named task design packet when needed                         |
| Simple-story and closeout summaries    | `plan_sections.py --profile closeout`, task summaries, review state, and retained proof paths                           |

Every caller must also follow `codeinfo_markdown/shared/bounded-plan-read.md`. Missing information is resolved with another named-section query or an exact heading-bounded `rg` plus `sed` fallback, never a complete-plan read. Multi-pass commands rerun the appropriate bounded profile after earlier edits instead of reopening the plan. Manual workflow-state fallback verifies only path readability and repository validity with content-free shell and Git checks. The policy test resolves flow `markdownFile` entries, subflows, agent `commandName` JSON stacks, and recursively linked shared Markdown, and rejects whole-plan wording that refers to selected or referenced plans as well as canonical or active plans.
