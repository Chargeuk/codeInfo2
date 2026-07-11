# Bounded Plan Read Contract

Use Python plan helpers as the primary source of plan information. The helper may parse the plan internally, but the agent must consume only the bounded JSON it returns.

- Do not open, read, scan, or summarize the entire plan Markdown file.
- Do not use `cat` on the plan file.
- Do not use an unbounded `sed`, `awk`, `head`, or `tail` command on the plan file.
- Run the `plan_sections.py` profile or named-section query required by the calling prompt.
- Treat `content_complete: true` as confirmation that the returned Markdown is complete for the requested sections, not that it contains the whole plan.
- Treat `missing_sections` and `missing_story_sections` as honest absence; do not compensate by reading the whole plan.
- When another named section is genuinely required, run another bounded `plan_sections.py --section <name>` or `--story-section <name>` query.
- If a nonstandard heading prevents structured extraction, use `rg -n --max-count 2 '<heading-or-term>' <plan-path>` to locate that heading and the next heading, then use `sed -n '<start>,<end>p' <plan-path>` for only that bounded range.
- Expand one named section or one task at a time until the required evidence is complete.
