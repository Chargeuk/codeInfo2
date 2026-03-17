# Overview
You are a going to work with a user to document additional scope and requirement details about one of the plans to be worked on.

## Where Are We Working?
The FIRST thing you MUST do is clarify with the user what story you are working with them on to improve the scope.
1. Ask the user to provide you with the absolute or relative path. Remember what they tell you as all the additional steps will be based on this answer.
2. When they have provided you with the file, you must read it and check if you understand it. Think about what it describes and see if you can see gaps in the requirements or scope, or it is missing corner cases that should be documented.

## Scope and Requirement Questions
You are a going to work with a user to document additional scope and requirement details about the plan they should have already told you that they want to work on. This will require you to work through the following points:
1. When you have determined these gaps, please extend the existing `## Questions` section in the document OR create a new `## Questions` section, by adding your list of numbered questions.
2. For each question you add, you should add a bullet point explaining WHY the question is important.
3. For each question you add, perform a thorough search using the code_info mcp tool to see if you can find how similar questions have been answered or implemented accross all ingested repositories as the answer may lie there.
4. THEN perform a second search using deepwiki, context7 and web searches for answers to the question - perhaps finding other people who have hit the question and see how they handles it.
5. Prioritising the results from code_info, as a new Best Answer bullet point to each of the question, that provides what you think the answer should be, why you think this is the best answer, and Where you got the information from that made you think this is the best option.
6. Commit all your question changes.

- Once all Questions follow the above structure, output the written questions to the user an your response, and indicate that this information has been committed to. the file.
- You will then work with the user to answer these questions.

## Scope and Requirement Answers
For each answer that the user provides for one of your questions, you must:
1. Add it to a '## Decisions' section immediately after the '## Questions' section (you will need to create it if it doesn't already exist).
2. Each decision should be added as an item within a numbered list under the '## Decisions' section.
3. The decision should have bullet points that indicate: 
    - The question being addressed,
    - WHY the question matters,
    - WHAT the answer is.
    - WHERE the answer came from
    - WHY it is the best answer to the question.
4. In addition to adding the answer to the '## Decisions' section, you MUST update all other sections of the plan where appropriate based on the information from the answer, including description, acceptance, out of scope, etc...
5. You MUST ALSO remove answered questions from the '## Questions' section, but never actually remove the '## Questions' section heading (in case more questions are added later).
6. Then commit the change.

## Completion
Once all your original questgions have been answered, you may be able to think of some more. If that is the case, then you should repeat this process. Otherwise, thank the user for their input.