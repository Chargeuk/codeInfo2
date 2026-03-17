# Story 0000049 – Responsive Long Conversation Transcript Rendering

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Users have started reporting that the front end becomes very slow once the visible chat or conversation transcript gets long. The most obvious symptom is in the Agents page: when a long transcript is visible, typing into the `Instruction` field becomes sluggish enough that people notice input lag. This makes the product feel unreliable even when the underlying server work is still functioning correctly.

Repository inspection shows that this is currently a client-side rendering problem rather than a server-side throughput problem. The main transcript pages all keep the full conversation in React state, reverse the whole message array, and render every visible row in one large tree. Those rows are not lightweight. They include markdown rendering, status chips, metadata, tool-call sections, citation accordions, and thought-process sections. As conversations grow, the amount of DOM and React work grows with them.

The biggest current hotspot is on the Agents page because the `Instruction` input and the transcript live in the same component tree. Each keystroke updates local input state, which rerenders the same page component that also renders the full transcript. Even if the transcript content has not changed, React still has to walk and reconcile that large message tree during typing. When there are many rendered messages, users experience that as a slow input box.

This is not isolated to one page. The Chat page, Agents page, and Flows page all share the same broad rendering pattern:

- keep a full `messages` array in client state;
- derive a reversed display array from it;
- render the whole transcript as a non-virtualized list;
- render rich per-message content with markdown and expandable sections.

That means a narrow one-page fix would leave the same scaling problem in the other conversation surfaces. The story should therefore introduce reusable client-side transcript rendering pieces so that performance fixes are applied consistently across the transcript pages instead of being copied three times.

The user has fixed one important scope boundary for this story: solutions should be strictly client-side. This story should not depend on changing server APIs, streaming contracts, persistence formats, websocket payloads, or back-end batching behavior. The job here is to make the existing client experience feel responsive even when the conversation is long.

The user also wants the performance work to be reusable and maintainable. That means this story is not just about adding memoization in one place. It should reshape the transcript UI into shared components and helpers that isolate rerenders, reduce repeated work, and make long-transcript performance a first-class concern across the client.

### Acceptance Criteria

- The front end remains responsive when the visible conversation transcript is long, including on the Agents page while typing into the `Instruction` field.
- Typing into the Agents `Instruction` input no longer rerenders the entire rich transcript tree on every keystroke.
- The client transcript rendering path for long conversations is refactored into reusable components or helpers shared across the relevant transcript pages.
- The reusable transcript rendering approach is applied consistently to the Chat page, Agents page, and Flows page where their conversation UIs overlap.
- The transcript rendering path no longer mounts and reconciles every message row in a long conversation when only a small visible portion is needed on screen.
- Rich transcript features continue to work after the refactor, including markdown rendering, status metadata, tool sections, citations, and thought-process sections where those features already exist.
- The client-side history hydration and transcript update path avoids unnecessary whole-transcript replacement work during ordinary UI interactions such as typing.
- Any client-side virtualization or render-windowing choice supports variable-height transcript rows rather than assuming every message has the same fixed height.
- This story is implemented entirely on the client side and does not require server API, websocket contract, or persistence-schema changes.
- The resulting client structure is easier to tune later because transcript rendering logic is centralized rather than duplicated across multiple pages.

### Out Of Scope

- Changing server-side chat, flow, or agent APIs.
- Changing websocket payload schemas or stream event formats.
- Reworking conversation persistence or storage models on the server.
- Changing how turns are stored in Mongo or any other persistence layer.
- Redesigning the overall visual style of the chat, agent, or flow pages beyond what is needed to support the performance improvements.
- Removing existing transcript features such as citations, tool details, or markdown support just to make rendering cheaper.
- Introducing unrelated product features in the transcript area while this performance fix is being implemented.
- General server-performance or model-latency work.

## Implementation Ideas

- Start from the current hotspot in `client/src/pages/AgentsPage.tsx`, where the `Instruction` field and the full transcript are rendered inside the same page component. Extract the instruction/composer area into its own memoized child so `setInput(...)` does not force the transcript tree to rerender on every keystroke.
- Introduce a shared transcript component layer under `client/src/components/chat/` rather than leaving transcript rendering inline in each page. Likely helper files and their purpose:
  - `TranscriptList.tsx` or `VirtualTranscriptList.tsx` to own scrolling, virtualization, and visible-row rendering. This would reduce mounted DOM and React work for long conversations.
  - `TranscriptMessageBubble.tsx` to render one message row behind a memo boundary so unchanged messages can skip rerender work.
  - `TranscriptMessageBody.tsx` or `TranscriptMarkdownBlock.tsx` to isolate markdown-heavy rendering from page-level state updates.
  - `TranscriptToolSection.tsx` and `TranscriptCitationsSection.tsx` to isolate the heavier expandable subsections behind their own memo boundaries.
  - `useVirtualTranscript.ts` or similar to hold the virtualization and measurement logic in one shared hook rather than duplicating it per page.
- Reuse those shared transcript pieces across `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` so the performance fix is applied consistently anywhere the client displays long conversations.
- Keep page-specific controls separate from the shared transcript. For example:
  - Chat-page provider/model controls remain in `ChatPage.tsx`;
  - Agents-page instruction and command controls remain in `AgentsPage.tsx`;
  - Flows-page run controls and flow metadata remain in `FlowsPage.tsx`.
  This separation is important because it lets transcript rendering stay stable while page-specific controls update.
- Add list virtualization or windowing for transcript rows. Repository analysis shows the current pages reverse the entire message list and render every row with rich content. For long conversations, the biggest speed win will likely come from only mounting the visible subset plus an overscan buffer.
- Prefer a virtualization solution that supports variable-height rows. Chat messages in this product can vary significantly in height because of markdown, tool details, citations, and collapsible sections. A fixed-row-height solution would be brittle here.
- A strong candidate library is `@tanstack/react-virtual`. Research shows it supports React list virtualization with dynamic measurement via `measureElement`, which fits the variable-height transcript problem better than a simpler fixed-height-only list helper.
- React 19 itself should also be used more deliberately in this story:
  - `React.memo` around transcript rows and subsections;
  - stable props and callbacks so memoization actually holds;
  - `startTransition` for non-urgent transcript/history sync work where it helps;
  - `useDeferredValue` only for derived non-input views where deferring work improves perceived responsiveness.
- Review the client hydration path, especially where transcript history is rebuilt from stored turns. Current client code replaces or rebuilds large message arrays too broadly. Narrow that work so it happens when the conversation or turn snapshot actually changes, not during ordinary typing or unrelated local UI updates.
- Keep the transcript data shape compatible with existing page behavior where possible. The point is to centralize and optimize rendering, not to invent a second conversation model on the client.
- Consider whether some expensive per-message decorations can be derived lazily inside the row component instead of all at once in the page render loop, especially when the row is off-screen or collapsed.
- Add client tests around the shared transcript components so future regressions do not reintroduce whole-page rerender coupling. This should stay client-only and focus on rendering behavior, row visibility, feature preservation, and page integration.

## Questions

1. Should Story 49 require the first implementation to ship across the Chat page, Agents page, and Flows page in one story, or is it acceptable to make `AgentsPage` fast first and then roll the same transcript layer onto the other pages later?
   - Why this is important: this determines whether the story is treated as one shared client refactor or as an urgent page-specific fix, which affects task sequencing, risk, and whether we can rely on one reusable transcript implementation instead of maintaining multiple partially-optimized versions.
   - Recommended answer based on research: keep the story scoped to all three pages, but sequence the work so `AgentsPage` gets the first concrete responsiveness win while the shared transcript components are then applied to `ChatPage` and `FlowsPage` before the story is considered complete.
   - Why this looks correct and where it came from: the local repo already uses shared chat UI building blocks such as [ConversationList.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/components/chat/ConversationList.tsx) across [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/pages/AgentsPage.tsx), [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/pages/ChatPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/pages/FlowsPage.tsx), which is a strong repo-specific precedent for shared components rather than one-off page fixes. The current story description and acceptance criteria also already frame this as a shared transcript problem. That matches the `code_info` findings for this repository and the broader React guidance from official docs and community practice that performance fixes are strongest when they reduce repeated rendering work at the shared component boundary instead of being patched separately in each page.

2. Should this story allow a new client dependency for virtualization, or should it prefer a React-only solution unless profiling proves that a library is necessary?
   - Why this is important: this locks whether the implementation can use a purpose-built virtualization layer for long variable-height transcripts or whether it must rely only on memoization, transitions, and page-level restructuring, which would materially change the task design and expected performance ceiling.
   - Recommended answer based on research: allow one focused new client dependency for transcript virtualization, with `@tanstack/react-virtual` as the preferred choice, while still using React 19 tools such as `React.memo`, `startTransition`, and `useDeferredValue` to reduce unnecessary work around it.
   - Why this looks correct and where it came from: local repo inspection and `code_info` both show that [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/package.json) does not currently include any virtualization library, so this would be a deliberate addition rather than something already standardized. Context7 documentation for `/tanstack/virtual` shows first-class support for large React lists with overscan and dynamic height measurement through `measureElement`, which is especially relevant for this product's markdown-heavy, expandable transcript rows. React’s official docs, surfaced through Context7 and web results from [react.dev](https://react.dev/reference/react/useDeferredValue), support combining urgent input updates with deferred non-urgent list work, while web.dev’s guidance on virtualizing long lists shows that windowing is a standard solution once list size itself becomes the bottleneck. DeepWiki’s React guidance also points toward prioritizing input responsiveness and preventing unnecessary rerenders, which fits using React features plus a focused virtualization helper rather than React-only rendering of the entire transcript.

3. Should the acceptance criteria require an explicit performance-proof target, or is a qualitative statement like “typing feels responsive again” enough?
   - Why this is important: this decides whether the story can be closed on subjective feel alone or whether it needs a reproducible validation shape that future implementers and reviewers can run to prove the slowdown was actually addressed and has not regressed.
   - Recommended answer based on research: require explicit reproducible proof steps, but not a hard millisecond SLA. The story should define a concrete long-transcript validation scenario for the client, confirm that typing into the Agents `Instruction` field stays responsive in that scenario, and verify that the shared transcript path works on the other conversation pages without regressing transcript features.
   - Why this looks correct and where it came from: the repo’s planning style already tends to use concrete validation workflows and wrapper-backed evidence rather than abstract “feels faster” wording, and Story 49’s current acceptance criteria are already written as specific observable outcomes rather than loose aspiration. React’s official guidance and the DeepWiki summary both point toward profiling and targeted validation of slow interactions, while Chrome DevTools guidance and web.dev articles treat long-list performance as something to measure with a repeatable interaction rather than guess at informally. A reproducible manual proof is therefore a better fit for this repo than a vague qualitative statement, but a hard numeric SLA would be an invented standard that this codebase does not currently use in planning documents.
