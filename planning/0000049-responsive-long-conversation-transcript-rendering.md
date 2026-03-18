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

The transcript behavior contract is now also fixed for scrolling and dynamic row size. The optimized transcript should preserve the browser-like reading experience that the current pages implicitly have today: keep the view pinned to the newest content only while the user is already at or near the bottom, stop forcing auto-scroll once the user has scrolled away, and preserve the visible reading position when rows above the viewport change height because of streaming content or expandable sections.

The rich-row state contract is also fixed. Important user-controlled transcript state must survive virtualization rather than resetting whenever a row leaves and re-enters the render window. That includes not only existing thought-process and tool-detail toggles, but also citation expansion state once the shared transcript layer takes ownership of that UI. Because rows can grow after initial render, the shared transcript must explicitly remeasure rows when streaming markdown expands or when citations, tool details, or thought-process sections open and close.

The ownership boundary for the shared transcript is now fixed as well. The shared layer should own the transcript container, virtualization, message-row rendering, and the reusable rich transcript subsections. It should not absorb page-specific controls such as provider and model selectors, agent instruction and command controls, or flow selection and run controls. Those remain in their respective pages so page-shell updates do not ripple through the transcript tree.

The story must also preserve the existing client hydration and in-flight merge behavior. Transcript optimization should continue to rely on stable message identity, update in-flight assistant rows in place rather than replacing them with unrelated rows, and keep the current Flows-page retained-assistant behavior during certain in-flight transitions so users do not see transcript flicker or missing output while runs advance.

The current repo also has one important normalization contract that the story must make explicit: the three pages all derive their visible transcript rows by reversing the `messages` array before rendering, but they do so with different local names such as `orderedMessages` and `displayMessages`. The shared transcript layer must preserve the same visible newest-last reading order instead of accidentally flipping the transcript direction while refactoring.

The validation approach should also be explicit. The story should not close on a vague claim that the UI "feels faster"; it should define a reproducible long-transcript client scenario that reviewers can run to confirm typing remains responsive and rich transcript features still work after the refactor.

### Concrete Output For This Story

To count as complete, this story should leave the client with one shared transcript rendering path that the three transcript surfaces call into, rather than three separate pages each owning their own inline bubble-render loop. The implementation does not need to use the exact file names listed below, but the finished code should have the same ownership split and should be easy for another developer to find and maintain.

- `client/src/pages/AgentsPage.tsx` should keep agent-specific page controls such as the instruction input, working-folder controls, command controls, and page layout, but should stop owning the full transcript bubble renderer inline.
- `client/src/pages/ChatPage.tsx` should keep chat-page controls such as model/provider selection and chat-page layout, but should stop owning its own separate inline transcript bubble renderer.
- `client/src/pages/FlowsPage.tsx` should keep flow-run controls, flow metadata, and page-specific layout, but should stop owning its own separate inline transcript bubble renderer.
- Shared transcript rendering code should live under `client/src/components/chat/` and should own the scroll container, visible-row rendering, shared bubble layout, markdown/body rendering, and reusable rich subsections such as tool details and citations.
- The implementation should continue to use the existing message and hydration sources in `client/src/hooks/useChatStream.ts`, `client/src/hooks/useConversationTurns.ts`, and any related websocket helpers, rather than inventing a second conversation model just for the virtualized transcript.
- The shared transcript layer is not optional cleanup. Repository inspection shows there is currently no dedicated shared transcript component, only page-local transcript render loops plus shared sidebar and flags components. Completing this story therefore requires introducing a real shared transcript rendering layer rather than only applying page-local memoization.
- A junior developer should be able to look at the final client structure and answer two simple questions without guessing:
  - which files own page-specific controls;
  - which shared transcript files own transcript rendering and performance behavior.

### Acceptance Criteria

- The front end remains responsive when the visible conversation transcript is long, including on the Agents page while typing into the `Instruction` field.
- Typing into the Agents `Instruction` input no longer rerenders the entire rich transcript tree on every keystroke.
- The client transcript rendering path for long conversations is refactored into reusable components or helpers shared across the relevant transcript pages.
- The reusable transcript rendering approach is applied consistently to the Chat page, Agents page, and Flows page where their conversation UIs overlap.
- `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` no longer each own a separate inline `messages.map(...)` or equivalent full bubble-render implementation for the main transcript area; instead, they delegate transcript rendering to shared code under `client/src/components/chat/`.
- The shared transcript preserves the current visible message order contract across Chat, Agents, and Flows, so the newest visible transcript content still appears in the same reading position it does today after each page reverses its message array for display.
- The transcript rendering path no longer mounts and reconciles every message row in a long conversation when only a small visible portion is needed on screen.
- Rich transcript features continue to work after the refactor, including markdown rendering, status metadata, tool sections, citations, and thought-process sections where those features already exist.
- The client-side history hydration and transcript update path avoids unnecessary whole-transcript replacement work during ordinary UI interactions such as typing.
- The optimized transcript continues to consume the existing message and hydration sources rather than introducing a second parallel transcript data model just for rendering.
- Any client-side virtualization or render-windowing choice supports variable-height transcript rows rather than assuming every message has the same fixed height.
- Any client-side virtualization or render-windowing choice uses stable row keys derived from `message.id`, measures dynamic row height after render, and uses a bounded overscan strategy that avoids obvious blank gaps during fast scrolling without reintroducing most of the transcript DOM at once.
- When the user is already at or near the bottom of the transcript, new content remains pinned to the newest visible content; when the user has scrolled upward, new content does not force the transcript to jump them back to the bottom.
- The transcript correctly remeasures row height after streaming growth and after expandable sections such as tool details, citations, and thought-process areas open or close, without clipping, overlapping, or leaving stale spacing.
- User-controlled rich-row expansion state survives virtual row unmount and remount, including tool details, tool errors, thought-process visibility, and citation expansion state once citations are moved into the shared transcript layer.
- The shared transcript layer owns the reusable transcript rendering path, while provider and model controls, agent-specific controls, and flow-specific controls remain page-specific and outside that shared transcript subtree.
- The shared transcript owns the real scroll and anchor behavior needed for the story instead of relying on the current page-local `handleTranscriptScroll` placeholders, which means the finished implementation makes bottom-pinned versus manual-scroll-away behavior explicit in shared code.
- The optimized transcript uses stable message identity rather than index-based row identity, preserves the current hydration and in-flight merge behavior, and does not regress the existing Flows-page retained-assistant transcript behavior during transitions.
- The story includes an explicit reproducible validation scenario for a long visible transcript so reviewers can confirm that typing into the Agents `Instruction` field remains responsive after the refactor.
- The same validation pass confirms that the shared transcript rendering path still behaves correctly on the Chat page and Flows page where their conversation UI overlaps with the optimized implementation.
- Existing transcript-facing tests can still target stable transcript containers and rich-row UI affordances after the refactor, even if implementation details move behind shared components.
- This story is implemented entirely on the client side and does not require server API, websocket contract, or persistence-schema changes.
- The resulting client structure is easier to tune later because transcript rendering logic is centralized rather than duplicated across multiple pages.

### Reproducible Validation Scenario

Use one conversation per page surface that is long enough for the transcript container to scroll and that includes at least the kinds of rich content this story must preserve: plain markdown text, at least one tool section, and at least one citation-bearing assistant response where that page already supports citations today.

1. On the Agents page, open the long conversation so the transcript is visibly scrollable and the `Instruction` input is on screen at the same time as the transcript.
2. Type a multi-sentence instruction at normal speed into the `Instruction` input while the long transcript remains visible.
3. Confirm the input text appears without obvious lag, dropped characters, or pauses caused by transcript rerender work. The transcript should not visibly flash, reset scroll position, or rebuild the whole visible list while the user is only typing.
4. While the conversation is still long, expand and collapse the rich transcript sections that already exist on that surface, including tool details, tool errors, thought-process sections, and citations where available. Confirm expansion state behaves normally and the transcript remeasures correctly instead of leaving clipped content, overlapping rows, or stale blank space.
5. Scroll upward so the user is no longer near the bottom, then allow new content to arrive or otherwise trigger transcript height changes above and within the viewport. Confirm the transcript does not force the user back to the bottom and that the visible reading position remains stable.
6. Return to the bottom and confirm that new content once again stays pinned to the newest visible transcript content.
7. Repeat the same transcript-behavior checks on the Chat page and Flows page. The exact page controls differ, but the shared transcript behavior should remain consistent across all three surfaces.

### Runtime And Repo Prerequisites

Repository research shows that this story does not depend on new server infrastructure, new HTTP routes, new readiness endpoints, new environment-variable injection paths, or new Docker Compose services. The story is client-only, and the repo already contains the runtime seams and local-stack plumbing it needs. The planning document should therefore be read with two important distinctions in mind:

- Existing infrastructure that already exists and should be reused:
  - client build, typecheck, lint, format, and test wrappers already exist in the root `package.json`, including `npm run build:summary:client`, `npm run typecheck:summary:client`, and `npm run test:summary:client`;
  - the server already exposes `/health`, `/version`, and `/info`, and Docker Compose already uses `service_healthy` checks against the existing health endpoints;
  - client runtime configuration already resolves from `globalThis.__CODEINFO_CONFIG__` and `import.meta.env` in `client/src/config/runtimeConfig.ts`, so no new runtime config loader should be invented for this story;
  - the existing Compose wrappers already inject the repo's env files and ports for local and e2e workflows through `scripts/docker-compose-with-env.sh`, `docker-compose.yml`, and `docker-compose.e2e.yml`.
- Missing prerequisites that are genuinely part of this story:
  - there is currently no shared transcript rendering component layer under `client/src/components/chat/`;
  - the preferred virtualization dependency, `@tanstack/react-virtual`, is not currently present in `client/package.json`, so adding it is part of the story if that implementation path is used.

Because the repo already has the required runtime and deployment plumbing, Story 49 should not add a new server listener, a new health endpoint, a new env-var injection path, a new compose service, or a new deployment mapping just to support transcript rendering. If local or e2e validation is needed, it should ride on the existing wrappers, env files, healthchecks, and port mappings instead.

### Docker And Compose Constraints

Repository inspection shows that the current Docker paths already follow the correct shape for application code:

- `client/Dockerfile` and `server/Dockerfile` copy repository source into image build stages and build the app from inside the image. The runtime containers then run built artifacts copied from those build stages.
- The Compose files do not mount the client or server source tree into the running containers with a broad `.:/app` style bind. Existing mounts are for logs, Codex/workflow directories, certs, Docker socket access in the local stack, fixtures, and other runtime data concerns.

Story 49 should preserve that model explicitly:

- do not plan or introduce a host source bind mount for client or server application code in Docker or Compose;
- if Docker-related validation is touched, application code should still be copied into the image and built there;
- if the story adds or removes Docker-visible files that affect build context size or correctness, update the relevant ignore file (`.dockerignore`, `client/.dockerignore`, and/or `server/.dockerignore`) so only required files are sent to the build context;
- do not assume generated `dist/`, `node_modules/`, test output, or local env files should be copied from the host into the image build context.

No new Docker or Compose surface is currently expected for this story. Because of that, the plan should treat the existing host-port allocations as reserved and unchanged:

- default Compose stack already uses host ports `5001`, `5010`, `5011`, `5012`, `27517`, `8000`, `4317`, `4318`, and `9411`;
- local Compose stack already uses host ports `5501`, `5510`, `5511`, `5512`, `9222`, `27417`, `8200`, `4917`, `4918`, `9711`, and `8931`;
- e2e Compose stack already uses host ports `6001`, `6010`, `6011`, `6012`, `27617`, `8800`, `4417`, `4418`, and `9511`.

If a future change somehow makes a new container surface unavoidable, the story must define the exact host and container ports up front after checking against those existing allocations. This Story 49 plan, however, should proceed on the assumption that no new Docker/Compose port surface is needed.

If any container-generated artifacts need persistence as part of validation, prefer Docker-managed volumes for that generated output rather than bind mounting a source tree. The only planned exception remains log visibility on the host.

## Message Contracts And Storage Shapes

Story 49 does not require a new websocket message contract, a new REST payload shape, or a new persisted storage shape. The virtualization and transcript-refactor work should operate on the existing client-side transcript contracts and storage normalization that already exist in the repository.

The existing contract owners that must remain authoritative are:

- `client/src/hooks/useChatStream.ts`
  - `ChatMessage`
  - `ChatSegment`
  - `ToolCall`
- `client/src/hooks/useConversationTurns.ts`
  - `StoredTurn`
  - `InflightSnapshot`
  - `TurnCommandMetadata`

What this means for the story:

- the shared transcript layer should continue to consume the existing `messages` array produced by `useChatStream`;
- virtualization should continue to key rows from the existing stable `message.id` identity rather than inventing alternate row IDs;
- persisted turns and inflight snapshots should continue to flow through `useConversationTurns` plus `hydrateHistory(...)` and `hydrateInflightSnapshot(...)`;
- page-specific metadata such as citations, tools, usage, timing, and flow command labels should continue to come from the existing message or command fields rather than from a new transcript-specific transport shape.

The only new shapes that are acceptable in this story are client-local implementation details that do not become a cross-boundary contract. For example, the shared transcript may introduce ephemeral UI state maps keyed by existing `message.id` or tool identifiers for:

- expansion state;
- row measurement cache keys;
- scroll-anchor bookkeeping;
- virtualization helper state.

Those client-local shapes must not become new websocket payloads, REST payloads, database records, or persisted conversation-turn fields.

### Out Of Scope

- Changing server-side chat, flow, or agent APIs.
- Changing websocket payload schemas or stream event formats.
- Reworking conversation persistence or storage models on the server.
- Changing how turns are stored in Mongo or any other persistence layer.
- Redesigning the overall visual style of the chat, agent, or flow pages beyond what is needed to support the performance improvements.
- Removing existing transcript features such as citations, tool details, or markdown support just to make rendering cheaper.
- Introducing unrelated product features in the transcript area while this performance fix is being implemented.
- Adding unrelated new client dependencies outside the focused transcript-virtualization or rendering-optimization need for this story.
- Moving provider and model controls, agent instruction or command controls, or flow run controls into the shared transcript layer.
- Changing the current hydration or retained-assistant behavior semantics beyond what is required to preserve them under the optimized rendering path.
- Forcing always-on auto-scroll that overrides a user's manual reading position in a long transcript.
- General server-performance or model-latency work.
- Adding a new server listener, new health endpoint, new runtime-config injection path, new compose service, or new deployment mapping for the sake of this client-rendering story.
- Introducing a host source bind mount for client or server application code into a running container.
- Introducing a new transcript websocket message contract, REST payload shape, or persisted storage shape for this story.

## Implementation Ideas

### Rough Implementation Sequence

1. Start by isolating the transcript problem at the page boundary before adding virtualization. The first concrete change should be to stop the Agents instruction input from sharing a rerender path with the full transcript tree. In practice, that means extracting the Agents composer or control area into its own child boundary and preparing the transcript area to accept a shared renderer.
2. Introduce one shared transcript rendering layer under `client/src/components/chat/` before changing page-specific metadata or controls. The first pass should centralize the common transcript container, message-row layout, markdown/body rendering, tool sections, citation rendering, and shared empty/loading states that are duplicated today in `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx`.
3. Normalize the transcript input contract before wiring all three pages into the new shared layer. The shared code should make one explicit choice about whether it accepts chronological `messages` and handles display ordering internally or whether each page passes already ordered display rows. That choice should be applied consistently so Chat, Agents, and Flows all preserve the current newest-last reading order without each page making its own hidden reversal decision.
4. Add virtualization only after the shared non-virtualized renderer is in place and producing the same transcript output as today. Once the shared renderer is stable, wrap the transcript list in a shared virtualization hook or component that owns `count`, `getScrollElement`, `getItemKey`, `estimateSize`, `measureElement`, overscan, and scroll-size-change adjustment behavior.
5. Reattach page-specific metadata only after the shared transcript path is working. Chat still needs its provider/tool-aware citation behavior, Agents still needs its run-specific metadata and tool count interactions, and Flows still needs `buildFlowMetaLine(...)`. Those page-level differences should be passed into the shared transcript as explicit props or render helpers rather than reintroducing full page-local bubble renderers.
6. Keep hydration and inflight semantics stable while the shared transcript is being swapped in. `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, and `client/src/hooks/useConversationTurns.ts` should remain the source of truth for transcript data, message identity, inflight snapshots, and websocket updates. The implementation should wrap around those hooks, not replace them.
7. Finish by updating regression tests and client build/runtime validation around the new structure. The final pass should prove that the transcript still renders correctly across Chat, Agents, and Flows, that typing stays responsive on Agents, and that Docker/client build paths still work with the client code copied into images and built there.

### Candidate File Groups

- Page entry points that currently own transcript rendering:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/pages/FlowsPage.tsx`
- Shared transcript layer that likely needs to be added or expanded under `client/src/components/chat/`:
  - a transcript list/container component;
  - message bubble/body components;
  - tool and citation subsections;
  - a virtualization hook or adapter;
  - any shared empty/loading transcript state helpers.
- Existing data and streaming hooks that must remain the data source:
  - `client/src/hooks/useChatStream.ts`
  - `client/src/hooks/useChatWs.ts`
  - `client/src/hooks/useConversationTurns.ts`

- Start from the current hotspot in `client/src/pages/AgentsPage.tsx`, where the `Instruction` field and the full transcript are rendered inside the same page component. Extract the instruction/composer area into its own memoized child so `setInput(...)` does not force the transcript tree to rerender on every keystroke.
- Introduce a shared transcript component layer under `client/src/components/chat/` rather than leaving transcript rendering inline in each page. Likely helper files and their purpose:
  - `TranscriptList.tsx` or `VirtualTranscriptList.tsx` to own scrolling, virtualization, and visible-row rendering. This would reduce mounted DOM and React work for long conversations.
  - `TranscriptMessageBubble.tsx` to render one message row behind a memo boundary so unchanged messages can skip rerender work.
  - `TranscriptMessageBody.tsx` or `TranscriptMarkdownBlock.tsx` to isolate markdown-heavy rendering from page-level state updates.
  - `TranscriptToolSection.tsx` and `TranscriptCitationsSection.tsx` to isolate the heavier expandable subsections behind their own memo boundaries.
  - `useVirtualTranscript.ts` or similar to hold the virtualization and measurement logic in one shared hook rather than duplicating it per page.
- Reuse those shared transcript pieces across `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` so the performance fix is applied consistently anywhere the client displays long conversations.
- Normalize the current display-order contract in one place. Today Chat, Agents, and Flows each reverse `messages` for display using local `orderedMessages` or `displayMessages` variables. The shared transcript should make one explicit choice about whether it accepts chronological `messages` and reverses internally or accepts already ordered display rows from all pages consistently, but it must not leave that choice implicit per page.
- Keep page-specific controls separate from the shared transcript. For example:
  - Chat-page provider/model controls remain in `ChatPage.tsx`;
  - Agents-page instruction and command controls remain in `AgentsPage.tsx`;
  - Flows-page run controls and flow metadata remain in `FlowsPage.tsx`.
  This separation is important because it lets transcript rendering stay stable while page-specific controls update.
- Add list virtualization or windowing for transcript rows. Repository analysis shows the current pages reverse the entire message list and render every row with rich content. For long conversations, the biggest speed win will likely come from only mounting the visible subset plus an overscan buffer.
- When using `@tanstack/react-virtual`, make the core mechanics explicit instead of leaving them as implementation trivia:
  - use `getItemKey` backed by stable `message.id` values rather than indexes;
  - provide a reasonable `estimateSize` for rich transcript rows;
  - call `measureElement` so variable-height rows can be remeasured after render;
  - use a conservative overscan value so fast scrolling does not show obvious empty gaps;
  - use size-change scroll adjustment behavior so rows above the viewport can grow without yanking the reader away from their place.
- Make the scroll contract explicit in the shared transcript hook or list component:
  - stay pinned to the latest content only while the user is already at or near the bottom;
  - stop auto-scrolling when the user scrolls upward;
  - preserve visible content position when rows above the viewport change height.
- Do not rely on the current page-local `handleTranscriptScroll` functions to provide this behavior. Repository inspection shows those handlers are placeholders today, so the shared transcript must introduce the actual bottom-pinned versus scrolled-away logic itself.
- Prefer a virtualization solution that supports variable-height rows. Chat messages in this product can vary significantly in height because of markdown, tool details, citations, and collapsible sections. A fixed-row-height solution would be brittle here.
- The preferred virtualization library is `@tanstack/react-virtual`. Research shows it supports React list virtualization with dynamic measurement via `measureElement`, which fits the variable-height transcript problem better than a simpler fixed-height-only list helper.
- Because `@tanstack/react-virtual` is not currently listed in `client/package.json`, adding that dependency is part of the implementation if the story follows the preferred virtualization path.
- Use stable row identity from the message model, not list indexes, so virtualization, hydration, and in-flight merge behavior all point at the same message rows over time.
- Move citation expansion into the same keyed shared-state model as tool and thought-process toggles so user-controlled row state survives virtual unmount and remount.
- Trigger row remeasurement whenever streaming text grows or expandable transcript sections open or close so variable-height rows stay correctly positioned.
- React 19 itself should also be used more deliberately in this story:
  - `React.memo` around transcript rows and subsections;
  - stable props and callbacks so memoization actually holds;
  - `startTransition` for non-urgent transcript/history sync work where it helps;
  - `useDeferredValue` only for derived non-input views where deferring work improves perceived responsiveness.
- If `useDeferredValue` is used to keep the instruction input responsive, the deferred transcript subtree still needs a memo boundary around the expensive list content; otherwise the deferred value will not buy much because the heavy list will keep rerendering with the parent anyway.
- Review the client hydration path, especially where transcript history is rebuilt from stored turns. Current client code replaces or rebuilds large message arrays too broadly. Narrow that work so it happens when the conversation or turn snapshot actually changes, not during ordinary typing or unrelated local UI updates.
- Keep the transcript data shape compatible with existing page behavior where possible. The point is to centralize and optimize rendering, not to invent a second conversation model on the client.
- Consider whether some expensive per-message decorations can be derived lazily inside the row component instead of all at once in the page render loop, especially when the row is off-screen or collapsed.
- Add client tests around the shared transcript components so future regressions do not reintroduce whole-page rerender coupling. This should stay client-only and focus on rendering behavior, row visibility, feature preservation, and page integration.
- Likely client test files to extend for this story include:
  - `client/src/test/chatPage.layoutWrap.test.tsx`
  - `client/src/test/chatPage.stream.test.tsx`
  - `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`
  - `client/src/test/chatPage.citations.test.tsx`
  - `client/src/test/agentsPage.streaming.test.tsx`
  - `client/src/test/agentsPage.turnHydration.test.tsx`
  - `client/src/test/agentsPage.citations.test.tsx`
  - `client/src/test/flowsPage.test.tsx`
  - `client/src/test/flowsPage.run.test.tsx`
  - `client/src/test/useChatStream.inflightMismatch.test.tsx`
  - `client/src/test/useChatStream.toolPayloads.test.tsx`
  - `client/src/test/useChatWs.test.ts`
- Treat the implementation as one shared-client story across all three transcript pages, even if the first development slice targets the Agents page hotspot before applying the same transcript layer to Chat and Flows.
- Define a repeatable long-transcript validation workflow for final review instead of relying on a subjective statement that the UI feels faster. That validation should cover input responsiveness on Agents plus feature-preserving transcript behavior on Chat and Flows.

## Test Harnesses

No brand-new test harness, test runner, or fixture framework needs to be created for Story 49. Repository inspection and library research indicate that the current client and e2e harnesses are already capable of covering this story if they are extended carefully.

- Reuse the existing client Jest/React Testing Library harness defined by `client/jest.config.cjs` and `client/src/test/setupTests.ts`.
- Reuse the existing websocket and fetch transcript harness in `client/src/test/support/mockChatWs.ts`, which already drives chat transcript tests through the same `/chat` start request plus websocket event stream used by the app.
- Reuse and extend the existing layout and measurement mocks in files such as `client/src/test/chatPage.layoutWrap.test.tsx` and `client/src/test/chatPage.layoutHeight.test.tsx`, which already stub `getBoundingClientRect`, `scrollWidth`, and related transcript layout values.
- Reuse the existing Playwright/e2e harness under `e2e/` plus the repo wrappers `npm run test:summary:e2e`, `npm run compose:e2e:build`, and `npm run compose:e2e:up` for browser-level regression checks.

If Story 49 needs reusable helpers for virtualization-specific measurement behavior, they should be added inside the existing client test-support area, not as a new harness. The most likely place is `client/src/test/support/`, either by extending `mockChatWs.ts` or by adding a focused helper for transcript measurement or `ResizeObserver` mocking that existing Jest/RTL tests can share.

The planning assumption should therefore be:

- extend existing Jest/RTL transcript tests for virtualization behavior;
- extend existing layout mocks if the virtualized transcript needs explicit `ResizeObserver`, scroll-offset, or item-size simulation;
- extend existing Playwright coverage for browser-level long-transcript behavior;
- do not create a separate virtualization-only harness unless implementation work proves the current harnesses cannot be extended, which repository and library research does not currently suggest.

## Feasibility Proof

### 1. Shared transcript component layer

- Already existing capabilities:
  - `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` already expose the current transcript inputs, containers, and page-specific metadata that a shared layer can wrap.
  - `client/src/components/chat/` already exists as the right home for shared chat-facing UI.
- Missing prerequisite capabilities:
  - there is no shared transcript container, row renderer, virtualization hook, or reusable transcript subsection component in `client/src/components/chat/` today.
- Assumptions that are currently invalid:
  - it is false to assume the repo already has a shared transcript renderer that only needs light tuning; this capability still has to be created.

### 2. Agents input or composer isolation

- Already existing capabilities:
  - the Agents page already has a distinct instruction input, local input state, and transcript subtree inside one page component, so there is a clear refactor seam.
- Missing prerequisite capabilities:
  - there is no existing memoized or isolated composer boundary that prevents the full transcript tree from participating in per-keystroke rerenders.
- Assumptions that are currently invalid:
  - it is false to assume the Agents input is already separated from transcript rendering work; the current page still owns both in the same component.

### 3. Variable-height transcript virtualization

- Already existing capabilities:
  - the pages already expose stable `message.id` values, scrollable transcript containers, and React 19 component boundaries that a virtualization layer can build on.
- Missing prerequisite capabilities:
  - the preferred virtualization dependency `@tanstack/react-virtual` is not yet in `client/package.json`;
  - there is no existing shared virtualizer wrapper, `measureElement` wiring, or row-measurement helper in the repo today.
- Assumptions that are currently invalid:
  - it is false to assume virtualization support or dynamic row measurement already exists in the client codebase.

### 4. Hydration and inflight transcript contracts

- Already existing capabilities:
  - `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, and `client/src/hooks/useConversationTurns.ts` already provide the transcript's live websocket, persisted turn hydration, inflight snapshot merge, and `message.id` stability contracts.
- Missing prerequisite capabilities:
  - none at the transport or data-contract level for this story; the required hooks already exist and should be reused.
- Assumptions that are currently invalid:
  - it is false to assume this story should introduce a second transcript data model or bypass the current hydration/inflight hooks.

### 5. Scroll anchoring and measurement behavior

- Already existing capabilities:
  - all three transcript surfaces already have scrollable containers, transcript refs, and stable DOM targets (`chat-transcript` / `flows-transcript`) that a shared transcript can take over.
- Missing prerequisite capabilities:
  - there is no real shared scroll-anchor behavior today, and the page-local `handleTranscriptScroll` functions are placeholders;
  - there is no explicit shared measurement policy for growing rows, expandable sections, or virtual window anchor preservation.
- Assumptions that are currently invalid:
  - it is false to assume the current repo already has working bottom-pinned versus scrolled-away logic that can simply be reused unchanged.

### 6. Test support for virtualization-sensitive behavior

- Already existing capabilities:
  - Jest/RTL client tests, `setupChatWsHarness`, layout-bound mocks, and Playwright/e2e suites already exist and are the correct base harnesses for this story.
- Missing prerequisite capabilities:
  - reusable virtualization-specific support helpers may still need to be added under `client/src/test/support/` for `ResizeObserver`, item measurement, or scroll-anchor assertions if the implementation makes those patterns repetitive.
- Assumptions that are currently invalid:
  - it is false to assume the current tests already assert overscan, row measurement, virtual unmount/remount state retention, or scroll-anchor behavior; those scenarios still need to be added even though the underlying harness already exists.

### 7. Docker, build, and runtime support

- Already existing capabilities:
  - the current Dockerfiles, Compose stacks, runtime config path, health endpoints, and client build/test wrappers already support client-only transcript changes;
  - application code is already copied into images and built there, and the story can reuse that model unchanged.
- Missing prerequisite capabilities:
  - none at the runtime or deployment-infrastructure level for this story.
- Assumptions that are currently invalid:
  - it is false to assume Story 49 needs a new listener, env-var path, Docker surface, port mapping, or host source bind mount to be feasible.

## Questions

- No Further Questions

## Decisions

1. Shared story scope across transcript pages
   - The question being addressed: should the story ship across Chat, Agents, and Flows in one shared implementation story, or only fix the Agents page first and leave the others for later?
   - Why the question matters: this determines whether the work produces one reusable transcript rendering path or a narrower page-specific optimization that would leave the same scalability risk in the other conversation surfaces.
   - What the answer is: keep the story scoped to all three pages. The implementation can land its first concrete win on the Agents page, but the story is only complete once the shared transcript approach is applied across Chat, Agents, and Flows where their conversation UI overlaps.
   - Where the answer came from: the answer came directly from the user, and it also matches the existing repo evidence in [ConversationList.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/components/chat/ConversationList.tsx), [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/FlowsPage.tsx), plus the earlier `code_info` review that identified shared transcript patterns across those pages.
   - Why it is the best answer to the question: it solves the reported performance problem where it appears today without creating three separate rendering strategies, and it keeps future tuning work centralized in shared client components instead of re-solving the same issue page by page.

2. Focused virtualization dependency is in scope
   - The question being addressed: should this story stay React-only, or should it allow a dedicated client dependency for virtualization if that gives a cleaner long-transcript solution?
   - Why the question matters: this controls whether the implementation can use purpose-built windowing for long variable-height transcripts, which has a major effect on how much DOM and React work the client must do when many messages are visible.
   - What the answer is: go with the researched recommendation and allow one focused client dependency for virtualization, with `@tanstack/react-virtual` as the preferred choice, alongside React 19 tools such as memoization and deferred or transition-based updates where they help.
   - Where the answer came from: the user approved the recommendation, and the recommendation was grounded in local repo inspection of [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/package.json), the earlier `code_info` findings that the client does not already use a virtualization library, Context7 documentation for `/tanstack/virtual`, DeepWiki guidance about React responsiveness, and supporting web documentation from React and web.dev on handling expensive list updates.
   - Why it is the best answer to the question: the transcript rows in this product are variable-height and content-heavy, so allowing a focused virtualization helper gives the implementation a proven way to reduce mounted work while still keeping the rest of the solution aligned with the repo’s existing React patterns.

3. Use explicit reproducible performance proof
   - The question being addressed: should the story accept a subjective claim that typing feels responsive again, or should it require a defined proof shape for review?
   - Why the question matters: this determines whether future reviewers can reliably verify the fix and whether regressions will be obvious, especially for a problem that users experience through interaction quality rather than through a single visible functional failure.
   - What the answer is: go with the researched recommendation and require explicit reproducible proof steps, but not a hard millisecond SLA. The story should define a long-transcript validation scenario that confirms responsive typing on the Agents page and no transcript-feature regressions on the shared Chat and Flows rendering path.
   - Where the answer came from: the user approved the recommendation, and the recommendation was based on the repo’s planning style, the current acceptance structure in this story, the earlier `code_info` findings, React guidance surfaced through Context7 and DeepWiki, and external web guidance that treats long-list performance as something to validate with repeatable interaction scenarios.
   - Why it is the best answer to the question: it gives the team a concrete way to prove the fix without inventing a timing SLA that this repo does not currently use, which keeps the acceptance practical, repeatable, and aligned with the way other stories in this repository are reviewed.

4. Preserve browser-like bottom-pinned scroll behavior without overriding manual reading position
   - The question being addressed: should the shared virtualized transcript keep the current browser-like scroll behavior, where the view stays pinned to the newest content only while the user is already at or near the bottom, but preserves the user's relative scroll position once they have scrolled upward?
   - Why the question matters: virtualization changes scroll math and row positioning, so the story needs an explicit contract to avoid jumpy scroll, forced auto-scroll, or lost reading position during long streaming conversations.
   - What the answer is: preserve a bottom-pinned mode only while the user is already at or near the bottom, stop auto-scrolling once the user scrolls away from the bottom, and preserve the visible reading position when rows above the viewport change height.
   - Where the answer came from: the user approved the recommended answer, and that recommendation was grounded in local repo evidence from [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/FlowsPage.tsx), plus `code_info`, Context7 documentation for `/tanstack/virtual`, DeepWiki notes for `TanStack/virtual`, official TanStack Virtual docs, and web guidance from web.dev.
   - Why it is the best answer to the question: it keeps the optimized transcript aligned with the current reading experience users already have, while still making scroll behavior explicit enough for a virtualized variable-height list.

5. Preserve rich-row UI state across virtualization and remeasure dynamic-height rows
   - The question being addressed: should all user-controlled rich-row expansion state survive row unmount and remount under virtualization, and should the shared transcript explicitly remeasure rows after citations, tool details, thought-process sections, or streaming markdown change their height?
   - Why the question matters: virtualization will unmount off-screen rows, so uncontrolled expansion state can reset unexpectedly and stale measurements can clip or misplace variable-height transcript content.
   - What the answer is: keep important user-controlled expansion state above the virtualized row instances, keyed by stable message and tool identifiers, and remeasure rows whenever streaming text grows or expandable sections open or close. Citation expansion should move into the same keyed shared-state model rather than remaining uncontrolled row-local state.
   - Where the answer came from: the user approved the recommended answer, and that recommendation was grounded in local repo evidence from [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx) and [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), plus `code_info`, Context7 documentation for `/reactjs/react.dev` and `/tanstack/virtual`, DeepWiki notes for `facebook/react` and `TanStack/virtual`, and the official React and TanStack Virtual docs.
   - Why it is the best answer to the question: it avoids introducing new state-loss behavior just because rows are windowed, and it gives the shared transcript a reliable way to keep dynamic-height rows correctly measured as rich content changes over time.

6. Keep the shared transcript focused on transcript rendering while page controls remain local
   - The question being addressed: what exactly should the shared transcript layer own, and what must remain page-specific across Chat, Agents, and Flows?
   - Why the question matters: this determines whether the story centralizes the repeated transcript rendering work without drifting into an unnecessary rewrite of page-specific controls and workflow chrome.
   - What the answer is: the shared layer should own the transcript container, virtualization, message-row rendering, and reusable rich transcript subsections, while each page keeps its own provider and model controls, agent instruction and command controls, flow selection and run controls, and other page-shell concerns.
   - Where the answer came from: the user approved the recommended answer, and that recommendation was grounded in local repo evidence from [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/FlowsPage.tsx), plus `code_info`, Context7 documentation for `/reactjs/react.dev`, DeepWiki notes for `facebook/react`, and the official React docs.
   - Why it is the best answer to the question: it centralizes the expensive repeated transcript UI where the performance win actually lives, while keeping unrelated page-level state and controls from churning the shared transcript subtree.

7. Preserve stable message identity and the current hydration and in-flight merge semantics
   - The question being addressed: what streaming and hydration behavior must the shared transcript preserve when conversation history is rehydrated from stored turns and active in-flight assistant rows are updated, replaced, or temporarily retained?
   - Why the question matters: virtualization can accidentally duplicate rows, regenerate keys, or drop transitional assistant output if the story does not explicitly protect the current hydration and in-flight merge behavior.
   - What the answer is: preserve stable `message.id` identity across history hydration and live updates, update existing in-flight rows in place instead of recreating them, and keep the current Flows-page retained-assistant behavior until the next in-flight output is visibly established.
   - Where the answer came from: the user approved the recommended answer, and that recommendation was grounded in local repo evidence from [useChatStream.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatStream.ts), [useConversationTurns.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useConversationTurns.ts), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/FlowsPage.tsx), plus `code_info`, Context7 documentation for `/reactjs/react.dev` and `/tanstack/virtual`, DeepWiki notes for `facebook/react` and `TanStack/virtual`, and the official React and TanStack Virtual docs.
   - Why it is the best answer to the question: it preserves the existing client-side transcript semantics users already rely on, while ensuring the virtualized transcript continues to cooperate with the repo's current hydration, dedupe, and in-flight retention logic instead of fighting it.

8. Normalize display order and make shared scroll behavior explicit
   - The question being addressed: what existing page-level behavior must the shared transcript normalize instead of inheriting accidentally from three separate page implementations?
   - Why the question matters: Chat, Agents, and Flows each reverse the `messages` array locally for display and currently use page-local transcript containers with placeholder scroll handlers. Without an explicit shared contract, a refactor could silently flip transcript order or leave the new virtualized transcript with undefined scroll-anchor behavior.
   - What the answer is: the shared transcript must preserve the current visible newest-last reading order across all three pages, centralize the display-order decision in one place, and introduce real shared scroll-anchor logic instead of depending on the current empty `handleTranscriptScroll` stubs.
   - Where the answer came from: this answer came from fresh repository inspection of [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/FlowsPage.tsx), plus direct source review of the page-local transcript refs and display-order helpers.
   - Why it is the best answer to the question: it removes a subtle but important source of accidental regressions and makes the shared transcript responsible for behavior that is currently only implicit in the page implementations.

9. Make virtualizer mechanics and regression-test targets explicit
   - The question being addressed: are there implementation details that are important enough to plan explicitly because omitting them would likely cause a junior developer to guess wrong?
   - Why the question matters: dynamic-height transcript virtualization only works reliably when key mechanics such as stable row keys, measurement, overscan, and scroll-size-change handling are set up deliberately, and this story already has broad existing client tests that should guide the regression plan.
   - What the answer is: the plan should explicitly call for `message.id`-backed virtual row keys, `estimateSize`, `measureElement`, conservative overscan, and size-change scroll anchoring behavior, and it should name the existing Chat, Agents, Flows, `useChatStream`, and `useChatWs` tests that are likely to need updates or additions.
   - Where the answer came from: this answer came from repository inspection, `code_info` guidance on likely test files, DeepWiki guidance for `TanStack/virtual` and `facebook/react`, Context7 documentation for `/tanstack/virtual` and `/reactjs/react.dev`, and web documentation from TanStack, React, and web.dev.
   - Why it is the best answer to the question: it keeps the story simple while removing the most likely wrong assumptions about how to implement and validate virtualization in this codebase.

10. Reuse existing runtime and deployment infrastructure instead of inventing new support seams
   - The question being addressed: does Story 49 assume any runtime or deployment capability that does not yet exist in the repository?
   - Why the question matters: a junior developer could otherwise assume they need to add a new server endpoint, health route, env-var path, compose service, or startup command just to ship a client transcript refactor.
   - What the answer is: the repo already has the runtime and validation seams this story needs, including client build/test wrappers, server `/health` and related info endpoints, client runtime config resolution via `globalThis.__CODEINFO_CONFIG__` plus `import.meta.env`, and Compose/e2e stacks with existing healthchecks and env-file wiring. The actual missing prerequisites are limited to client-side work: the shared transcript rendering layer itself and, if chosen, the addition of `@tanstack/react-virtual` to `client/package.json`.
   - Where the answer came from: this answer came from repository inspection of [package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/package.json), [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/package.json), [client/src/config/runtimeConfig.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/config/runtimeConfig.ts), [server/src/index.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/index.ts), [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml), [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml), and [scripts/docker-compose-with-env.sh](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/docker-compose-with-env.sh), plus `code_info`, DeepWiki guidance for `vitejs/vite` and `TanStack/virtual`, Context7 documentation for `/vitejs/vite` and `/tanstack/virtual`, and web documentation from Vite and Docker.
   - Why it is the best answer to the question: it narrows the story to the real missing pieces, prevents unnecessary infrastructure work, and tells the implementer exactly which existing repo capabilities they should reuse instead of replacing.

11. Preserve the current Docker build model and avoid new bind-mounted app-code paths
   - The question being addressed: what Docker and Compose behavior must remain explicit so the story does not accidentally drift into a host-mounted development model or implicit port choices?
   - Why the question matters: the repository already builds application code into images and runs built artifacts from there. If a junior developer assumes this story can validate transcript work by bind mounting source trees, copying host build output into containers, or adding an ad hoc new port surface, they can create a container path that does not match the repo's established runtime model.
   - What the answer is: Story 49 should keep application code copied into Docker image build stages and built there, should update the relevant `.dockerignore` file if Docker-visible inputs change, should not introduce host source bind mounts for app code, should not add a new Compose surface or port binding for this story, and should prefer Docker-managed volumes for any new generated-output persistence other than logs.
   - Where the answer came from: this answer came from repository inspection of [client/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/Dockerfile), [server/Dockerfile](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/Dockerfile), [.dockerignore](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/.dockerignore), [client/.dockerignore](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/.dockerignore), [server/.dockerignore](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/.dockerignore), [docker-compose.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.yml), [docker-compose.local.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.local.yml), and [docker-compose.e2e.yml](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docker-compose.e2e.yml), plus `code_info` and direct inspection of the current port bindings and volume mounts.
   - Why it is the best answer to the question: it keeps the story aligned with the repo's existing container model, prevents hidden source-of-truth drift between host and container code, and makes the Docker expectations clear before any implementation work begins.

12. Preserve the existing transcript message and storage contracts
   - The question being addressed: does Story 49 need new message contracts or storage shapes in order to introduce a shared transcript layer and virtualization?
   - Why the question matters: if the story quietly introduces a new transcript payload shape, it stops being a client-only rendering story and becomes a transport or persistence contract story as well.
   - What the answer is: no new websocket, REST, or persisted storage shapes are needed. Story 49 should continue to rely on the existing `ChatMessage`, `ChatSegment`, and `ToolCall` shapes from `useChatStream.ts`, and the existing `StoredTurn`, `InflightSnapshot`, and `TurnCommandMetadata` shapes from `useConversationTurns.ts`. New shapes are acceptable only for client-local ephemeral UI state inside the shared transcript implementation.
   - Where the answer came from: this answer came from repository inspection of [useChatStream.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useChatStream.ts) and [useConversationTurns.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/hooks/useConversationTurns.ts), plus `code_info`, DeepWiki guidance for `TanStack/virtual` and `facebook/react`, and Context7 documentation for `/tanstack/virtual` and `/reactjs/react.dev`, all of which point toward preserving the existing item array and stable identities rather than inventing a new message/storage schema.
   - Why it is the best answer to the question: it keeps the story within its intended client-rendering scope, avoids unnecessary cross-boundary contract churn, and tells the implementer exactly which existing shapes they must preserve.
