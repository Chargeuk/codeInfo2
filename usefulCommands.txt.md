Setup:
Please read Agents.md and follow it's instructions. Give me an overview of the project and where we are up to.

Tasks:
do you feel this story's task instructions are detailed enough for an inexperienced, junior developer that has never seen our codebase before? especially compared with the baseline set in the first story

do you feel task 11's instructions are detailed enough for an inexperienced, junior developer that has never seen our codebase before? especially compared with the baseline set in the first story

in various tasks you have a single subtask to update multiple markdown documents. this is ambiguous. please separate these out to separate subtasks and be explicit about what needs updating

some of the tasks look quite big, could they be split up without loosing any information?

It looks like we are referencing libraries in the tasks that we have not explicitly stated where documentation is available. Please update the Documentation Locations for each task and ensure that every single external library has the correct documentation location, whether that is an mcp tool or an explicit web address.

some tasks do not have a final subtask to fix linting and prettier (format)

the last subtask of every task should be Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

Update the Testing steps for every task except the final task to only be the following list, in the following order:
`npm run build --workspace server` OR `npm run build --workspace client` depending on if the task updates server or client code. Use both as seperate testing steps if both or the common code were edited.
`npm run test --workspace server` OR `npm run test --workspace client` depending on if the task updates server or client code. Use both as seperate testing steps if both or the common code were edited.
`npm run compose:build`
`npm run compose:up`
`npm run compose:down`

every task needs a final testing step (not subtask) to ensure the docker environment can compose, and confirm that everything runs well, followed by a step to tear it down.nNote the build and run tasks should not be a subtask, but be part of the Testing section of the task.

ensure the tasks that update archetecture or add flows also update design.md with the required information and mermaid diagrams. these tasks should reference the mermaid docs via context 7.

please ensure any task writing jest tests includes references to context7 tool jest documentation and any task that includes cucumber tests references cucumber at https://cucumber.io/docs/guides/ within the Documentation Locations section of each relevant task


Execution:
I want to see if you can run a seperate codex agent. Please try to run the following command: : codex exec -s danger-full-access "What does this repository do?"

I want you to get other codex agents to implement all remaining tasks of the current story sequentially, and to get back to me with information about how this way of working went. This should be possible if you execute the following command for each task in sequence once the previous task is completed, adjusting the appropriate task number and story plan name for each task. Note that you must not try to run multiple agents at the same time, run an agent for the next task, when that is complete, run a new agent for the task after, and so on until all tasks are complete. each agent could take up to 35 minutes to complete a task: codex exec -s danger-full-access "Please read Agents.md and follow it's instructions. Once done you must work through Task [Task Number & name] of planning/[current planning document].md, precisely following the steps within the 'Implementation Plan Instructions' section to work through each step. You must keep the subtasks tickbox updated as you work through each subtask to ensure everyone understands what has been done."

Please work through Task 11 yourself, precisely following the steps within the 'Implementation Plan Instructions' section to work through each step. You must keep the subtasks tickbox updated as you work through each subtask to ensure everyone understands what has been done. Then you run through the testing steps, ensuring you keep the subtasks tickbox updated as you work through each testing step.

please create a pr comment that summerises the changes along with bullet points