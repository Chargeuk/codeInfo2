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

The story scope is now fixed across all three relevant transcript surfaces rather than treating the Agents page as a standalone patch. The implementation can be staged so the first visible win lands on the Agents page, but the story is not complete until the shared transcript path is also used where the Chat page and Flows page overlap with the same conversation-rendering problem.

The implementation approach may include one focused client dependency for transcript virtualization when that helps solve the problem cleanly. This is acceptable because the current client does not already have a virtualization layer, and the story is specifically about reducing the amount of mounted and reconciled transcript UI during long conversations without moving work onto the server.

The validation approach should also be explicit. The story should not close on a vague claim that the UI "feels faster"; it should define a reproducible long-transcript client scenario that reviewers can run to confirm typing remains responsive and rich transcript features still work after the refactor.

### Acceptance Criteria

- The front end remains responsive when the visible conversation transcript is long, including on the Agents page while typing into the `Instruction` field.
- Typing into the Agents `Instruction` input no longer rerenders the entire rich transcript tree on every keystroke.
- The client transcript rendering path for long conversations is refactored into reusable components or helpers shared across the relevant transcript pages.
- The reusable transcript rendering approach is applied consistently to the Chat page, Agents page, and Flows page where their conversation UIs overlap.
- The transcript rendering path no longer mounts and reconciles every message row in a long conversation when only a small visible portion is needed on screen.
- Rich transcript features continue to work after the refactor, including markdown rendering, status metadata, tool sections, citations, and thought-process sections where those features already exist.
- The client-side history hydration and transcript update path avoids unnecessary whole-transcript replacement work during ordinary UI interactions such as typing.
- Any client-side virtualization or render-windowing choice supports variable-height transcript rows rather than assuming every message has the same fixed height.
- The story includes an explicit reproducible validation scenario for a long visible transcript so reviewers can confirm that typing into the Agents `Instruction` field remains responsive after the refactor.
- The same validation pass confirms that the shared transcript rendering path still behaves correctly on the Chat page and Flows page where their conversation UI overlaps with the optimized implementation.
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
- Adding unrelated new client dependencies outside the focused transcript-virtualization or rendering-optimization need for this story.
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
- The preferred virtualization library is `@tanstack/react-virtual`. Research shows it supports React list virtualization with dynamic measurement via `measureElement`, which fits the variable-height transcript problem better than a simpler fixed-height-only list helper.
- React 19 itself should also be used more deliberately in this story:
  - `React.memo` around transcript rows and subsections;
  - stable props and callbacks so memoization actually holds;
  - `startTransition` for non-urgent transcript/history sync work where it helps;
  - `useDeferredValue` only for derived non-input views where deferring work improves perceived responsiveness.
- Review the client hydration path, especially where transcript history is rebuilt from stored turns. Current client code replaces or rebuilds large message arrays too broadly. Narrow that work so it happens when the conversation or turn snapshot actually changes, not during ordinary typing or unrelated local UI updates.
- Keep the transcript data shape compatible with existing page behavior where possible. The point is to centralize and optimize rendering, not to invent a second conversation model on the client.
- Consider whether some expensive per-message decorations can be derived lazily inside the row component instead of all at once in the page render loop, especially when the row is off-screen or collapsed.
- Add client tests around the shared transcript components so future regressions do not reintroduce whole-page rerender coupling. This should stay client-only and focus on rendering behavior, row visibility, feature preservation, and page integration.
- Treat the implementation as one shared-client story across all three transcript pages, even if the first development slice targets the Agents page hotspot before applying the same transcript layer to Chat and Flows.
- Define a repeatable long-transcript validation workflow for final review instead of relying on a subjective statement that the UI feels faster. That validation should cover input responsiveness on Agents plus feature-preserving transcript behavior on Chat and Flows.

## Questions

None currently. Answered questions are recorded in `## Decisions` below.

## Decisions

1. Shared story scope across transcript pages
   - The question being addressed: should the story ship across Chat, Agents, and Flows in one shared implementation story, or only fix the Agents page first and leave the others for later?
   - Why the question matters: this determines whether the work produces one reusable transcript rendering path or a narrower page-specific optimization that would leave the same scalability risk in the other conversation surfaces.
   - What the answer is: keep the story scoped to all three pages. The implementation can land its first concrete win on the Agents page, but the story is only complete once the shared transcript approach is applied across Chat, Agents, and Flows where their conversation UI overlaps.
   - Where the answer came from: the answer came directly from the user, and it also matches the existing repo evidence in [ConversationList.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/components/chat/ConversationList.tsx), [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/pages/AgentsPage.tsx), [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/pages/ChatPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/src/pages/FlowsPage.tsx), plus the earlier `code_info` review that identified shared transcript patterns across those pages.
   - Why it is the best answer to the question: it solves the reported performance problem where it appears today without creating three separate rendering strategies, and it keeps future tuning work centralized in shared client components instead of re-solving the same issue page by page.

2. Focused virtualization dependency is in scope
   - The question being addressed: should this story stay React-only, or should it allow a dedicated client dependency for virtualization if that gives a cleaner long-transcript solution?
   - Why the question matters: this controls whether the implementation can use purpose-built windowing for long variable-height transcripts, which has a major effect on how much DOM and React work the client must do when many messages are visible.
   - What the answer is: go with the researched recommendation and allow one focused client dependency for virtualization, with `@tanstack/react-virtual` as the preferred choice, alongside React 19 tools such as memoization and deferred or transition-based updates where they help.
   - Where the answer came from: the user approved the recommendation, and the recommendation was grounded in local repo inspection of [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2Planning/client/package.json), the earlier `code_info` findings that the client does not already use a virtualization library, Context7 documentation for `/tanstack/virtual`, DeepWiki guidance about React responsiveness, and supporting web documentation from React and web.dev on handling expensive list updates.
   - Why it is the best answer to the question: the transcript rows in this product are variable-height and content-heavy, so allowing a focused virtualization helper gives the implementation a proven way to reduce mounted work while still keeping the rest of the solution aligned with the repo’s existing React patterns.

3. Use explicit reproducible performance proof
   - The question being addressed: should the story accept a subjective claim that typing feels responsive again, or should it require a defined proof shape for review?
   - Why the question matters: this determines whether future reviewers can reliably verify the fix and whether regressions will be obvious, especially for a problem that users experience through interaction quality rather than through a single visible functional failure.
   - What the answer is: go with the researched recommendation and require explicit reproducible proof steps, but not a hard millisecond SLA. The story should define a long-transcript validation scenario that confirms responsive typing on the Agents page and no transcript-feature regressions on the shared Chat and Flows rendering path.
   - Where the answer came from: the user approved the recommendation, and the recommendation was based on the repo’s planning style, the current acceptance structure in this story, the earlier `code_info` findings, React guidance surfaced through Context7 and DeepWiki, and external web guidance that treats long-list performance as something to validate with repeatable interaction scenarios.
   - Why it is the best answer to the question: it gives the team a concrete way to prove the fix without inventing a timing SLA that this repo does not currently use, which keeps the acceptance practical, repeatable, and aligned with the way other stories in this repository are reviewed.
