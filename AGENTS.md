# Agent Workflow Guide

## Required Onboarding

- Before doing anything else, call the code_info mcp tool to give you an overview of the project, and to tell you which plan from the ./planning folder is the next one to be worked on based on it being the lowest index numerically based on the filename (<index>-<title>.md) but still having tasks that are marked as in progress or todo. When calling the code_info mcp tool you MUST provide the full path to this repository when you ask it this question so it knows which repository you are interested in. Then you must view the last 3 commits to the repository and using all of this combined information, provide me with an overview of the project, what was last implemented, and what is to be implemented next.
- Confirm the git branch we are currently on & check the equivalent planning document, and the latest planning document (if not the same) from the planning folder.
- Re-read these files at the start of each session; assume they may have changed since your last context window.
- When working in React, use the MUI MCP tool for all Material UI references. For any other APIs or SDKs, consult documentation via the Context7 MCP tool so guidance stays current.

## Working through story plans

- When working through story plans from the ./planning folder you MUST mark each subtask as complete by marking the [ ] box with an 'x' so it becomes [x] at the point of implementing that subtask. DO NOT wait until multiple subtasks are complete and then mark them all in a batch. This ensures you know exactly where you are up to if your context is reset, and allows users to follow your progress precicely. Missing this step of marking subtasks complete at the point of implementation has caused multiple issues in the past, so DO NOT FORGET to keep the subtasks and testing steps up to date at the point you complete each of them!

## Branching & Phase Flow

- Create a feature branch for each story (`feature/<number>-<short-description>`) from the currently checked out loction.
- Each commit should be prefixed with DEV-[Number] - and contain a brief description consisting of 4 or 5 sentences explaining what changed and why.
- Work only within that branch until every task in the story is complete and working.
