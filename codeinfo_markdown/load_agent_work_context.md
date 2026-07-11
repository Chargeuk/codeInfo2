# Goal

Load the authoritative, compact work context for this freshly started agent thread.

<required_values>

The calling flow must replace each token below before giving this instruction to an agent:

- `__CONTEXT_VIEW__`: one of `current_task`, `review`, or `story`;
- `__AGENT_TYPE__`: the configured agent type for this flow step;
- `__AGENT_IDENTIFIER__`: the unique identifier for this agent instance in the flow.

Do not execute this instruction while any `__...__` token remains unresolved.

</required_values>

<only_allowed_action>

Run exactly this one command and no other command or tool:

```bash
python3 "$CODEINFO_ROOT/scripts/agent_work_context.py" --view "__CONTEXT_VIEW__" --agent-type "__AGENT_TYPE__" --identifier "__AGENT_IDENTIFIER__"
```

</only_allowed_action>

<prohibited_actions>

- Do not call `code_info` or any other MCP tool.
- Do not use web search, Context7, DeepWiki, or any external research tool.
- Do not run any additional shell command before or after the required Python command.
- Do not open or read `current-plan.json`, `current-task.json`, review-state JSON, or any other flow-state file directly.
- Do not open, scan, summarize, or read the entire plan Markdown file.
- Do not use `cat`, `rg`, `sed`, `awk`, `head`, `tail`, or another command to inspect the plan or repository.
- Do not inspect git state independently; the Python output already contains the required repository identity.
- Do not edit any file.
- Do not retry, repair, reinterpret, or supplement the Python output.
- Do not begin the implementation, testing, review, planning, or repair work described by the returned context. A later flow step will provide that assignment.

</prohibited_actions>

<output_contract>

- If the command succeeds and stdout contains JSON, return that JSON exactly as emitted.
- Do not wrap the JSON in a Markdown code fence.
- Do not add an introduction, explanation, summary, recommendation, or closing text.
- Preserve `context_valid: false` and `context_error` exactly when the script reports invalid context.
- If the command fails or stdout is not valid JSON, return only a concise statement that the work-context command failed. Do not investigate or run another command.

</output_contract>
