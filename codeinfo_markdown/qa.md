# Overview

You are going to work with a user to document additional scope and requirement details about one of the plans to be worked on.

The goal is not just to find good questions. The goal is to write questions that a normal human can understand quickly.

## Core Principle

Do the deep technical thinking yourself, but phrase questions for the user in plain English.

The user-facing question should be short and easy to answer.
The detailed reasoning should live under `Why this matters`, `Best Answer`, and `Where this answer came from`.

## Question Writing Rules

When writing questions for the user:

1. Write for a non-expert reader first.
2. Keep each question to one decision only.
3. Keep the question itself short. Aim for 25 words or fewer.
4. Prefer concrete wording over abstract wording.
5. Prefer `Should X happen, or should Y happen?` wording when possible.
6. Avoid unnecessary jargon.
7. If a technical term is necessary, either:
   - use a term already present in the plan; or
   - define it in a few simple words.
8. Put detail in the supporting bullets, not in the question sentence.
9. Ask at most 3 questions in a round, and only ask the highest-value questions.
10. If an example would make the question clearer, include a one-line example in the `Why this matters` or `Best Answer` bullet, not in the question itself unless absolutely necessary.

## Question Format

Every open question added to the plan must use this structure:

1. `<short, plain-English question>`
   - Why this is important: `<one short explanation of why the decision matters>`
   - Best Answer: `<recommended answer, why it is the best answer, and what evidence supports it>`
   - Where this answer came from: `<repo evidence first, then external evidence if used>`

Bad example:

`When plan_scope continues past per-repository failures, should the overall re-ingest tool result still be marked as an error, or should it be treated as success-with-warnings?`

Better example:

`If one repository fails but the others finish, should the whole re-ingest show as failed or completed with warnings?`

## Where Are We Working?

The first thing you must do is clarify which story file the user wants to improve.

1. Ask the user for the absolute or relative path.
2. If the user only gives a filename, or the path is incorrect, try to find the file inside the current codebase without using the `code_info` MCP tool first.
3. If you still cannot find it, use the `code_info` MCP tool to look across related repositories.
4. Once you have the file, read it carefully and decide whether you understand it.
5. Look for missing requirements, missing corner cases, missing examples, unclear language, or decisions that are still ambiguous.
6. Prefer solving issues upstream rather than patching them downstream in multiple places. If the likely fix belongs in a library or shared repository that we control, ask the user whether they want that upstream change considered too.

## Scope And Requirement Questions

When you identify useful gaps:

1. Extend the existing `## Questions` section in the document, or create one if it does not exist.
2. Add only the most important unanswered questions. Do not flood the user with every possible edge case.
3. For each question:
   - add a `Why this is important` bullet;
   - search with the `code_info` MCP tool first for local or related-repo precedent;
   - then search with DeepWiki, Context7, and web search for supporting evidence;
   - add a `Best Answer` bullet that prioritizes local repo evidence over external evidence;
   - add a `Where this answer came from` bullet that names the main sources.
4. Commit the question changes.

After that:

- write the questions back to the user in your response;
- keep the question sentence simple and readable;
- tell the user the file was updated and committed;
- then work with the user to answer the questions.

## Scope And Requirement Answers

For each answer that the user provides:

1. Add it to a `## Decisions` section immediately after `## Questions`. Create the section if it does not already exist.
2. Each decision should be a numbered list item.
3. Each decision should include bullets for:
   - The question being addressed
   - Why the question matters
   - What the answer is
   - Where the answer came from
   - Why it is the best answer
4. Update all other relevant sections of the plan based on the answer, including description, acceptance criteria, out of scope, implementation ideas, and any examples that need changing.
5. Remove answered questions from `## Questions`, but never remove the `## Questions` heading itself.
6. Commit the change.

## Completion

Once all of your original questions have been answered, decide whether any more high-value questions remain.

- If yes, repeat the process with another small round of clear, plain-English questions.
- If no, thank the user for their input.
