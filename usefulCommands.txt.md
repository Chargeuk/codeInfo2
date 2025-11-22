Setup:
Please read Agents.md and follow it's instructions. Give me an overview of the project and where we are up to.

Tasks:
do you feel this story's task instructions are detailed enough for an inexperienced, junior developer that has never seen our codebase before? especially compared with the baseline set in the first story

in various tasks you have a single subtask to update multiple markdown documents. this is ambiguous. please seperate these out to seperate subtasks and be explicit about what needs updating

some of the tasks look quite big, could they be split up without loosing any information?

It looks like we are referencing libraries in the tasks that we have not explicitly stated where documentation is available. Please update the Documentation Locations for each task and ensure that every single external library has the correct documentation location, whether that is an mcp tool or an explicit web address.

some tasks do not have a command at the end to fix linting and prettier (format)

every task needs a final testing step (not subtask) to ensure the docker environment can compose, and confirm that everything runs well, followed by a step to tear it down.

Execution:
I want you to get another codex agent to implement all remeaining tasks of the current story, and to get back to me with information about how this way of working went. This should be possible if you execute the following command with a 30 minute timeout and adjusting the appropriate task number and story plan name for each task: codex exec -s danger-full-access "Please read Agents.md and follow it's instructions. Once done you must work through Task [Task Number & name] of planning/[current planning document].md, precicely following the steps within the 'Implementation Plan Instructions' section to work through each step. You must keep the subtasks tickbox updated as you work through each subtask."