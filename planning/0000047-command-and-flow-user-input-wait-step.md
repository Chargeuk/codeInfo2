# Story 0000047 – Command And Flow User Input Wait Step

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Commands and flows can already execute multiple automated steps, but there is no supported way for a workflow to pause and ask the user for input before deciding what to do next. Users want a workflow step that can stop execution, show a custom prompt to the user, wait as long as necessary, and then continue from that exact point once the user has provided content.

This is not the same as adding another synchronous step type. A user-input step changes the run lifecycle:

- a command or flow run becomes paused rather than finished;
- the server must remember exactly what is waiting and where execution should resume;
- the page must be able to reconnect later and still know that the conversation is waiting for input.

The user has chosen the following contract decisions for this story:

- resume happens through REST as the canonical mutation path;
- websocket is used for live events and status updates only;
- waiting state is persisted in conversation flags rather than being kept only in in-memory runtime state.

REST is the preferred resume path because it is better for state-changing actions that must survive reconnects, retries, page refreshes, and longer pauses between user actions. Websocket remains valuable for real-time UI updates, but it is not the canonical place to submit the answer that resumes execution.

Persisting waiting state in conversation flags solves an important reliability problem. If the state only exists in memory, a page refresh or server restart can lose the fact that a run was paused for input. By storing the waiting metadata with the conversation, the server and client can recover the waiting state and continue from the correct point later.

This story introduces one new step type for both command JSON and flow JSON. The step shows a custom message to the user, waits for content, captures the exact raw user input, and then resumes execution. It does not overload the existing `llm` type. The new type is intentionally separate because the system behavior is different enough to need its own contracts and stored state.

### Acceptance Criteria

- Command JSON supports a dedicated user-input wait step.
- Flow JSON supports a dedicated user-input wait step.
- The user-input wait step includes a custom message shown to the user so they know what content to enter.
- When a command or flow reaches the user-input wait step, no later step starts until the user has submitted content through the canonical resume path.
- The canonical resume path is REST.
- Websocket emits live events so the UI can learn that the run is waiting for input and later that it has resumed.
- Waiting-for-input state is persisted in conversation flags so it survives page refresh and can be recovered after reconnect.
- The persisted waiting state records enough information to resume deterministically, including:
  - the paused run surface;
  - the paused conversation;
  - the location to resume from;
  - the custom user-facing prompt message.
- If the user reloads the page while the run is waiting, the application can recover and show that the conversation is still waiting for input.
- When the user submits content, that content is captured as raw text and made available to the resumed workflow without trimming or line rewriting.
- After the user submits content successfully, the waiting state is cleared and the command or flow resumes from the next correct execution point.
- Existing stop/cancel behavior remains coherent while a run is waiting for input.
- A command or flow cannot accidentally resume from the wrong conversation or the wrong paused step.
- This story does not require websocket to be the canonical resume submission mechanism.
- This story does not depend on an in-memory-only waiting-state store.

### Out Of Scope

- Folding user-input waiting into the existing `llm` step type.
- Free-form websocket-only resume submission as the canonical resume contract.
- Leaving paused workflow state in memory only.
- Adding unrelated new command or flow step types.
- Solving every possible future paused-run feature such as arbitrary branching UIs, multi-user approvals, or complex forms.
- Reworking unrelated chat, command, or flow schemas beyond what is needed for the dedicated wait step.

### Questions

1. What exactly should the submitted user content do once the user resumes a paused command or flow?
Why this is important:
This is the defining behavioral question for the whole story. Without answering it, the server and client cannot agree on what “resume” means. The submitted text could be treated as a plain data capture, as the prompt for an AI step, or as input for a future variable-substitution system. Each option implies different schema shapes, stored-state requirements, resume behavior, and testing.
Best answer:
Treat the wait step as a human-supplied `llm` step:
  - the workflow pauses when it reaches the step;
  - the user submits raw content;
  - that content becomes the instruction for the paused step;
  - the agent executes that step using the submitted content;
  - the workflow then continues normally to the next step.
Why this is the best answer:
It is the cleanest fit with the current product. It does not require a general-purpose variable system, it keeps the user-input step concept easy for a junior developer to understand, and it maps naturally onto the existing idea of “a workflow step produces an instruction that the agent runs.” It also keeps Story 0000047 focused on paused/resumed execution instead of expanding into a broader workflow-language feature set.

## Implementation Ideas

- Introduce a dedicated step type such as `userInput` in both command and flow schemas instead of overloading `llm`.
- Add a persisted waiting-state shape under conversation flags so the server can recover paused runs after refresh or reconnect.
- Define one REST endpoint for submitting user content and resuming the paused run.
- Publish websocket events that announce:
  - the run has entered waiting-for-input state;
  - the run has resumed;
  - the waiting state was cleared by cancellation or completion.
- Reuse existing conversation lock and run-identity concepts so a paused run cannot be resumed by the wrong conversation or by a later replacement run.
- For flows, store enough step-path information to resume deterministically.
- For commands, store enough step-index information to resume deterministically.
- Keep the user-entered content raw, matching the raw-input policy used elsewhere in the product.
- Add tests for:
  - command wait-step pause and resume;
  - flow wait-step pause and resume;
  - waiting state recovery after refresh/reload;
  - wrong-conversation or stale-run resume rejection;
  - websocket waiting/resumed events;
  - stop/cancel while waiting.
