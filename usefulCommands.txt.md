Setup:
Please read Agents.md and follow it's instructions. Give me an overview of the project and where we are up to and how the next steps will be achieved.

Tasks:
can you check if all the changes needed to implement this new logic are correctly documented within the story. For example, do any of the
tasks make assumptions that are incorrect, or have reliance on logic that isn't there? Will the front end and MPC servers be ablt to actually
do what we want them to do because the server has exposed the right informaiton and input logic. will existing functionality break because we
have planned changes that have consequences we didn't consider? Do we have open questions represented by investigation subtasks, because if
so those investigations should be performed now so the story becomes a concrete set of tasks.

are there any complex or risky items that we could consider simplifying to de-risk?

do you feel this story's task instructions are detailed enough for an inexperienced, junior developer that has never seen our codebase before? especially compared with the baseline set in the first story, which has code snippets and file locations for each subtask. Also, this developer will only look at the subtask they are working on and not at the story as a whole, so each subtask must contain information that is documented elsewhere in the story so it cannot be missed, even if it is duplicated, including documentation links.

do you feel the todo task's subtasks are detailed enough for an inexperienced, junior developer that has never seen our codebase before? especially compared with the baseline set in the first story

in various tasks you have a single subtask to update multiple markdown documents. This is ambiguous. please separate these out to separate subtasks and be explicit about what needs updating

some of the tasks look quite big, could they be split up without loosing any information?

some tasks have Document Locations that reference the existing codebase. This is incorrect. The Document Locations sections should reference external locations, such as website documentation or context7 and deepwiki mcp tool documentation for libraries that are required for the task's implementation to ensure the correct calls are used. The subtask itself should state which files are required to be read or edited to complete the subtask. Please correct this.

in various tasks you have a single subtask for a number of tests to write. This is ambiguous. Please separate these out to separate subtasks and be explicit about what needs updating - For each task, seperate each required test into it's own subtask. Include test type, location, description & purpose.

It looks like we are referencing libraries in the tasks that we have not explicitly stated where documentation is available. Please update the Documentation Locations for each task and ensure that every single external library has the correct documentation location, whether that is an mcp tool such as context7 and DeepWiki or an explicit web address. remember to check the documentation yourself before adding it so you can explain the reason for using it.

some tasks do not have a final subtask to fix linting and prettier (format)

The last subtask of every task should be Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

The testing steps for each task, should at a minimum contain the following items. If there are specific additional or expanded testing required for a task, then the list should be expanded to detail this:

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e`
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm items within the story and general regressions checks that should be detailed based on the task being tested.
9. [ ] `npm run compose:down`

ensure the tasks that update archetecture or add flows also update design.md with the required information and mermaid diagrams. these tasks should reference the mermaid docs via context 7.

Ensure that any task adding files has a subtask to explicitly update projectStructure.md.

please ensure any task writing jest tests includes references to context7 tool jest documentation and any task that includes cucumber tests references cucumber at https://cucumber.io/docs/guides/ within the Documentation Locations section of each relevant task

Execution:
I want to see if you can run a seperate codex agent. Please try to run the following command: : codex exec -s danger-full-access "What does this repository do?"

I want you to get other codex agents to implement all remaining tasks of the current story sequentially, and to get back to me with information about how this way of working went. This should be possible if you execute the following command for each task in sequence once the previous task is completed, adjusting the appropriate task number and story plan name for each task. Note that you must not try to run multiple agents at the same time, run an agent for the next task, when that is complete, run a new agent for the task after, and so on until all tasks are complete. each agent could take up to 35 minutes to complete a task: codex exec -s danger-full-access "Please read Agents.md and follow it's instructions. Once done you must work through Task [Task Number & name] of planning/[current planning document].md, precisely following the steps within the 'Implementation Plan Instructions' section to work through each step. You must keep the subtasks tickbox updated as you work through each subtask to ensure everyone understands what has been done."

I want you to get the coding_agent from the agents mcp tool to fully complete the work of the next task. You need to provide the agent with the full repository path, the story plan we are working through, and the task you want them to work through. The request must be in the following format: 'You are working in the <Repository-Name> at <Repository-Path>. Agents.md is found at <Agents.md-path>. We are working through the story found at <Story-Plan-Path>. Please complete task <Task-Number>, both subtasks and testing steps, and get back to me once the task is complete and each subtask is marked complete AND each testing step is marked complete, with a concise summary of what changed, the gotchas you came across while working through the task and any commands/output that indicate success.' Answer any questions from the agent to the best of your ability, remembering to provide the conversationId in any follow up statements, but ensuring you do not provide it in the first request. Get back to me once the next task is complete.

I want you to get the coding_agent from the agents mcp tool to fully complete all remaining work in this story. To do this you need to request that the coding_agent works on the next task - YOU MUST re-read the story plan state immediately before delegating as upon completion of a task, the agent will have updated the plan and previously you kept asking agents to do the same work because tyou did not check if it was already done! Once the agent has completed the task, you MUST re-read the story plan and provide me with a little summary BEFORE going on to ask them to do the next one. You must repeat this process until every task within the story is fully completed. For each task, you need to provide the agent with the full repository path, the story plan we are working through, and the task you want them to work through. The request to start each task must be in the following format: 'You are working in the <Repository-Name> at <Repository-Path>. Agents.md is found at <Agents.md-path>. We are working through the story found at <Story-Plan-Path>. Please complete task <Task-Number>, both subtasks and testing steps, and get back to me once the task is complete and each subtask is marked complete AND each testing step is marked complete, with a concise summary of what changed, the gotchas you came across while working through the task and any commands/output that indicate success.' Answer any questions from the agent to the best of your ability, remembering to provide the conversationId in any follow up statements to keep the conversation going for that individual task, but ensuring you do not provide it in the first request to start a new task - We want to ensure that a new conversation is started for each work task in the current story. Get back to me once every task within the story is complete, DO NOT BOTHER ME unless a blocker is hit or the whole story is complete. Remember that you can only ask an agent to start a new task once the agent has completed the in-progress task and you have output the current status to me after checking the updates to the story plan, we CANNOT have multiple tasks being worked on by agents in paralel.

please explain the gotchas a developer would need to watch out for while implementing the next task given all the information within the Description, it's subsections, the AC & Out of scope. Also take into account the implementation information of any previous tasks.

Taking these gotchas into account, please fully work through the next task yourself, precisely following the steps within the 'Implementation Plan Instructions' section to work through each step. You must keep the subtasks tickbox updated as you work through each subtask to ensure everyone understands what has been done. Then you run through the testing steps, ensuring you keep the subtasks tickbox updated as you work through each testing step. Note that LMStudio is running and available, and locally codex has been logged into and works. Get back to me once all tubtasks and testing steps are complete.

please ensure all gotchas & surprises you hit during implementation are documented within the implementation notes, along with any other implementation notes that are worthwhile. Ensure all subtasks and testing tasks are correctly set to complete, Set the task status to done, commit & push, then mark the git commits & push again.

please create a pr comment that summarises the changes along with bullet points

/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml

based on the new log output it looks to me like our assumption that the message contains { role?: unknown; content?: unknown } is completely incorrect and that entire logic section is wrong. Do you agree? - though maybe it is that format when asking a question that does not
require tool use, such as "who was the first man on the moon". I want you to ask multiple questions that both exercise tool use and do not, to get a correct understanding of the response structure that gets passed into the onMessage callback within chat.ts.
