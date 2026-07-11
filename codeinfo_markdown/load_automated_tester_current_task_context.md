# Goal

Load compact work context for this freshly reset agent thread.

<only_allowed_action>

Run exactly this command and no other command or tool:

```bash
python3 "$CODEINFO_ROOT/scripts/agent_work_context.py" --view "current_task" --agent-type "automated_testing_agent" --identifier "automated_tester"
```

</only_allowed_action>

<prohibited_actions>

- Do not call `code_info` or any other MCP, web, or research tool.
- Do not run another shell command before or after the required command.
- Do not read flow-state files directly.
- Do not open, scan, summarize, or read the entire plan Markdown file.
- Do not inspect git independently, edit files, or begin the next work step.
- Do not retry, repair, reinterpret, or supplement the command output.

</prohibited_actions>

<output_contract>

- Return valid stdout JSON exactly as emitted, without a Markdown fence or other text.
- Preserve invalid-context output exactly.
- If the command fails or stdout is not valid JSON, return only a concise statement that the work-context command failed and do nothing else.

</output_contract>
