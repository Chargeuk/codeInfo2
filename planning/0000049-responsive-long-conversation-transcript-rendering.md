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
- The existing shared sidebar component `client/src/components/chat/ConversationList.tsx` should remain the sidebar entry point and must not be absorbed into the new transcript layer.
- The existing chat-only `client/src/components/chat/CodexFlagsPanel.tsx` should remain outside the new shared transcript layer and continue to be owned by `client/src/pages/ChatPage.tsx`.
- The implementation should continue to use the existing message and hydration sources in `client/src/hooks/useChatStream.ts`, `client/src/hooks/useConversationTurns.ts`, and any related websocket helpers, rather than inventing a second conversation model just for the virtualized transcript.
- The shared transcript layer is not optional cleanup. Repository inspection shows there is currently no dedicated shared transcript component, only page-local transcript render loops plus shared sidebar and flags components. Completing this story therefore requires introducing a real shared transcript rendering layer rather than only applying page-local memoization.
- A junior developer should be able to look at the final client structure and answer two simple questions without guessing:
  - which files own page-specific controls;
  - which shared transcript files own transcript rendering and performance behavior.

### Surface-By-Surface Done Looks Like

- Chat page:
  - provider and model selection, sidebar behavior, and other page-level chat controls still live in `ChatPage.tsx`;
  - the transcript itself is rendered through the shared transcript path rather than an inline page-local bubble loop;
  - the existing chat transcript states still work, including loading history, turns-error warning, empty transcript copy, markdown content, tool sections, and citations where tools are available.
- Agents page:
  - the instruction input, working-folder controls, command controls, and page shell still live in `AgentsPage.tsx`;
  - typing into the `Instruction` field stays responsive even when a long transcript is visible;
  - the transcript itself is rendered through the shared transcript path rather than an inline page-local bubble loop;
  - the existing agent transcript behaviors still work, including loading history, turns-error warning, empty transcript copy, streamed assistant output, tool sections, and citations.
- Flows page:
  - flow selection, flow run controls, and page-level flow metadata still live in `FlowsPage.tsx`;
  - the transcript itself is rendered through the shared transcript path rather than an inline page-local bubble loop;
  - the existing flow transcript states still work, including loading flows, empty-flow messaging, loading history, turns-error warning, streamed assistant output, and the extra flow metadata line that is currently derived from `buildFlowMetaLine(...)`;
  - the shared transcript does not introduce citation accordions on Flows, because that surface does not render citations today.

### Acceptance Criteria

- The front end remains responsive when the visible conversation transcript is long, including on the Agents page while typing into the `Instruction` field.
- Typing into the Agents `Instruction` input no longer rerenders the entire rich transcript tree on every keystroke.
- The client transcript rendering path for long conversations is refactored into reusable components or helpers shared across the relevant transcript pages.
- The reusable transcript rendering approach is applied consistently to the Chat page, Agents page, and Flows page where their conversation UIs overlap.
- `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/FlowsPage.tsx` no longer each own a separate inline `messages.map(...)` or equivalent full bubble-render implementation for the main transcript area; instead, they delegate transcript rendering to shared code under `client/src/components/chat/`.
- The shared transcript preserves the current visible message order contract across Chat, Agents, and Flows, so the newest visible transcript content still appears in the same reading position it does today after each page reverses its message array for display.
- The transcript rendering path no longer mounts and reconciles every message row in a long conversation when only a small visible portion is needed on screen.
- Rich transcript features continue to work after the refactor, including markdown rendering, status metadata, tool sections, citations, and thought-process sections where those features already exist.
- Citation rendering remains page-configured rather than forced on globally, so Chat and Agents keep citation accordions where they already exist and Flows does not gain new citation UI as part of this story.
- The client-side history hydration and transcript update path avoids unnecessary whole-transcript replacement work during ordinary UI interactions such as typing.
- The optimized transcript continues to consume the existing message and hydration sources rather than introducing a second parallel transcript data model just for rendering.
- Any client-side virtualization or render-windowing choice supports variable-height transcript rows rather than assuming every message has the same fixed height.
- Any client-side virtualization or render-windowing choice uses stable row keys derived from `message.id`, measures dynamic row height after render, and uses a bounded overscan strategy that avoids obvious blank gaps during fast scrolling without reintroducing most of the transcript DOM at once.
- When the user is already at or near the bottom of the transcript, new content remains pinned to the newest visible content; when the user has scrolled upward, new content does not force the transcript to jump them back to the bottom.
- The transcript correctly remeasures row height after streaming growth and after expandable sections such as tool details, citations, and thought-process areas open or close, without clipping, overlapping, or leaving stale spacing.
- User-controlled rich-row expansion state survives virtual row unmount and remount, including tool details, tool errors, thought-process visibility, and citation expansion state once citations are moved into the shared transcript layer.
- The shared transcript layer owns the reusable transcript rendering path, while provider and model controls, agent-specific controls, and flow-specific controls remain page-specific and outside that shared transcript subtree.
- The shared transcript owns the real scroll and anchor behavior needed for the story instead of relying on the current empty `handleTranscriptScroll` placeholders in Chat and Agents or the current absence of any transcript scroll handler on Flows, which means the finished implementation makes bottom-pinned versus manual-scroll-away behavior explicit in shared code.
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

### Validation Proof Path Must Be Runnable

Each proof route in this story must only be used after its prerequisites exist in the branch. The validation plan for Story 49 is therefore staged, not all available on day one.

- Client typecheck and client build proof:
  - These are already runnable through the existing wrappers `npm run typecheck:summary:client` and `npm run build:summary:client`.
  - They become meaningful for Story 49 as soon as the shared transcript files and any new client dependency imports exist.
  - If the implementation takes the preferred virtualization path, `@tanstack/react-virtual` must be added to `client/package.json` before this proof step can pass.
- Client Jest and React Testing Library proof:
  - This is already runnable through `npm run test:summary:client`, backed by `client/jest.config.cjs`, `client/src/test/setupTests.ts`, and the existing transcript harness in `client/src/test/support/mockChatWs.ts`.
  - The current harness already supports transcript rendering, websocket updates, and layout-sensitive DOM mocking, so no new test runner is required first.
  - If the shared transcript adds explicit `ResizeObserver`, virtual measurement, or scroll-anchor assertions that the current helpers cannot express cleanly, the story must first add focused support helpers under `client/src/test/support/` before claiming those proof cases are runnable.
- Manual long-transcript proof:
  - This becomes runnable once the shared transcript path is wired into Chat, Agents, and Flows and the app can be started with the existing stack wrappers.
  - The story should use the existing runtime path rather than inventing a new one: either an already running repo stack or `npm run compose:build` followed by `npm run compose:up`.
  - This proof is not realistic before the shared transcript layer exists, because the scenario explicitly validates shared behavior across the three transcript surfaces.
- Browser-level Playwright or e2e proof:
  - This is already runnable through the existing Playwright wrapper `npm run test:summary:e2e`, which uses the repo's `e2e/` suite.
  - If transcript behavior needs a running browser stack, the prerequisite runtime path already exists and should remain the existing Compose e2e flow: `npm run compose:e2e:build` and `npm run compose:e2e:up`.
  - Story 49 does not need a new browser harness, but any new transcript-specific browser assertions must be added to the existing e2e specs rather than assumed to exist automatically.
- Surface-parity proof across Chat, Agents, and Flows:
  - This proof only becomes runnable after all three pages are moved onto the shared transcript path.
  - It is not realistic to close the story using an Agents-only proof run, because the story scope already requires reuse across all three transcript surfaces.

Because of these constraints, the realistic proof order for Story 49 is:

1. add the shared transcript layer and any required virtualization dependency;
2. add the dedicated client transcript test-support helpers needed for measurement-sensitive assertions and prove that harness with its own focused test;
3. run `npm run typecheck:summary:client` and `npm run build:summary:client`;
4. run `npm run test:summary:client`;
5. run the manual long-transcript validation scenario against the existing runtime stack;
6. run `npm run test:summary:e2e` only after the transcript behavior being asserted is actually represented in the existing or updated browser specs.

### Runtime And Repo Prerequisites

Repository research shows that this story does not depend on new server infrastructure, new HTTP routes, new readiness endpoints, new environment-variable injection paths, or new Docker Compose services. The story is client-only, and the repo already contains the runtime seams and local-stack plumbing it needs. The planning document should therefore be read with two important distinctions in mind:

- Existing infrastructure that already exists and should be reused:
  - client build, typecheck, lint, format, and test wrappers already exist in the root `package.json`, including `npm run build:summary:client`, `npm run typecheck:summary:client`, and `npm run test:summary:client`;
  - browser-level regression wrappers already exist in the root `package.json`, including `npm run test:summary:e2e`, `npm run compose:e2e:build`, and `npm run compose:e2e:up`;
  - the server already exposes `/health`, `/version`, and `/info`, and Docker Compose already uses `service_healthy` checks against the existing health endpoints;
  - client runtime configuration already resolves from `globalThis.__CODEINFO_CONFIG__` and `import.meta.env` in `client/src/config/runtimeConfig.ts`, so no new runtime config loader should be invented for this story;
  - the existing Compose wrappers already inject the repo's env files and ports for local and e2e workflows through `scripts/docker-compose-with-env.sh`, `docker-compose.yml`, and `docker-compose.e2e.yml`.
- Missing prerequisites that are genuinely part of this story:
  - there is currently no shared transcript rendering component layer under `client/src/components/chat/`;
  - the preferred virtualization dependency, `@tanstack/react-virtual`, is not currently present in `client/package.json`, so adding it is part of the story if that implementation path is used.
  - Story 49 also requires focused transcript test-support helpers under `client/src/test/support/` for `ResizeObserver`, row-measurement, and scroll-anchor assertions before the virtualization-sensitive proof steps are treated as runnable.

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
7. Finish by making the proof path runnable in order, not by jumping straight to the final validation step. After the shared transcript layer and any required dependency or test-support helpers exist, run `npm run typecheck:summary:client`, `npm run build:summary:client`, `npm run test:summary:client`, the manual long-transcript scenario on the existing runtime stack, and then `npm run test:summary:e2e` if browser-level assertions were added or changed. The final pass should prove that the transcript still renders correctly across Chat, Agents, and Flows, that typing stays responsive on Agents, and that Docker/client build paths still work with the client code copied into images and built there.

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

## Edge Cases and Failure Modes

- Agents input rerender coupling:
  - The current hotspot is that `AgentsPage.tsx` owns both the controlled `Instruction` input and the full transcript tree. The implementation must avoid a failure mode where the shared transcript still sits on the same per-keystroke rerender path, because that would preserve the user-visible typing lag even if virtualization is added later.
- Scroll pinned versus scrolled-away behavior:
  - Chat and Agents currently expose empty `handleTranscriptScroll` placeholders, while Flows currently has no transcript scroll handler at all, so the shared transcript must introduce the real pinned-state logic itself. A failure mode here is always forcing auto-scroll to the newest row even after the user has intentionally scrolled upward to read older content.
- Dynamic row height changes after first render:
  - Assistant rows can grow after mount because streamed markdown expands, tool details open, citations expand, or thought-process sections are toggled. The shared transcript must remeasure those rows and preserve the reader's visible position; otherwise rows can overlap, leave stale whitespace, or yank the user to a different scroll position.
- Stable row identity during hydration and streaming:
  - `useChatStream.ts` and the three page render loops currently rely on stable `message.id` keys while inflight assistant rows are updated in place. The implementation must treat index keys or unstable virtual-row keys as a failure mode because they would break expansion state retention, remount assistant rows unnecessarily, and risk incorrect inflight merge behavior.
- Inflight overlay and hidden-run rehydration:
  - `useConversationTurns.ts` may surface an inflight snapshot when persisted assistant turns are not yet present, and `useChatStream.ts` also ignores stale inflight replays for older runs. The shared transcript must tolerate the newest assistant row coming from inflight overlay data rather than assuming every visible row is backed by a stored turn.
- Conversation switching while transcript state exists:
  - The current pages clear or rehydrate state when the active conversation changes. The shared transcript must not leak row expansion state, measurement caches, or scroll anchors from one conversation into another, especially on Agents and Flows where conversations can switch while transcript history reloads.
- Virtual unmount and remount of rich row state:
  - Tool details, tool error expansion, citations, and thought-process sections already use keyed local open-state maps. A failure mode is keeping those toggles inside transient row instances so they reset when a row leaves the virtual window and later re-enters it.
- Fast scrolling with low overscan:
  - If virtualization is added with an undersized overscan buffer or poor initial size estimates, the user may see blank gaps or obvious jumpiness during fast scrolling. Story 49 should treat visible empty holes, unstable scroll restoration, or repeated row pop-in as regressions rather than acceptable tradeoffs.
- Surface-specific metadata loss:
  - The shared transcript path must still preserve page-specific transcript details such as `liveStoppedMarker` status handling on Agents and `buildFlowMetaLine(...)` output on Flows. A failure mode is centralizing transcript rendering in a way that accidentally drops these surface-specific metadata lines or badge states.
- Existing transcript states per surface:
  - The current pages have distinct empty, loading, and warning states such as `turnsError`, empty transcript copy, flow-loading copy, and websocket/persistence banners. The refactor must not collapse these into one generic transcript state that loses important page-specific feedback.
- Test and automation hook regressions:
  - Existing Jest and browser tests already query transcript DOM hooks like `chat-transcript`, `chat-bubble`, `tool-toggle`, `citations-toggle`, `think-toggle`, `bubble-flow-meta`, and related stateful sections. The implementation must either preserve these hooks or deliberately update the affected tests, because silent DOM-contract drift would create brittle regressions without obvious product-level failures.
- Large unbroken or metadata-heavy content:
  - Transcript rows can contain long markdown blocks, tool payloads, citation chunks, and user text with preserved whitespace. The shared renderer must continue to handle very tall or unusually wide content without breaking measurement, clipping content, or causing horizontal overflow that destabilizes the transcript container.

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

### 1. Shared Chat Transcript Foundation

- Already existing capabilities:
  - `client/src/pages/ChatPage.tsx` already contains the full transcript container, duplicated formatter helpers, tool and citation UI, thought-process UI, and the `chat-transcript` DOM hook that the shared layer can extract.
  - `client/src/components/chat/` already exists as the right home for the new shared transcript files, while `ConversationList.tsx` and `CodexFlagsPanel.tsx` already define the shared sidebar and Chat-only flags boundaries that must remain outside the new transcript layer.
- Missing prerequisite capabilities:
  - there is no shared transcript container, row renderer, formatter helper module, or reusable transcript subsection component in `client/src/components/chat/` today.
- Assumptions that are currently invalid:
  - it is false to assume Chat already consumes a shared transcript renderer; the page still owns the full inline bubble loop today.
  - it is also false to assume the current collapsed MUI Accordions are cheap enough to leave as-is; in MUI 6, accordion details stay mounted unless the shared transcript explicitly sets `slotProps.transition.unmountOnExit`.

### 2. Agents Composer Isolation

- Already existing capabilities:
  - `client/src/pages/AgentsPage.tsx` already contains a clear composer boundary candidate: the agent selection, command row, working-folder controls, multiline `agent-input`, and action slot currently live in one page-local section.
- Missing prerequisite capabilities:
  - there is no existing isolated composer component or render-isolation regression test proving typing does not rerender the transcript subtree.
- Assumptions that are currently invalid:
  - it is false to assume the current Agents page already isolates per-keystroke input work from transcript rendering; both still live in the same page component.
  - it is also false to assume `startTransition` or `useDeferredValue` can be used as the primary fix for the controlled `agent-input` value itself; React still treats text input updates as urgent, so render isolation must come from the component boundary first.

### 3. Agents Shared Transcript Adoption

- Already existing capabilities:
  - the Agents page already exposes every behavior the shared transcript must preserve, including `agent-turns-error`, `liveStoppedMarker`-driven status chips, tool toggles, citation accordions, thought-process sections, and existing transcript test ids.
  - Task 1 is expected to create the shared transcript files this task can adopt.
- Missing prerequisite capabilities:
  - the shared transcript foundation from Task 1 must exist before Agents can move off its page-local `displayMessages.map(...)` loop.
- Assumptions that are currently invalid:
  - it is false to assume Agents already uses the shared transcript path; its full transcript renderer is still page-local today.

### 4. Flows Shared Transcript Adoption

- Already existing capabilities:
  - the Flows page already exposes the flow-specific behaviors the shared transcript must preserve, including `flows-transcript`, `flows-turns-error`, `buildFlowMetaLine(...)`, retained-assistant behavior, and the current absence of citation UI.
  - Task 1 is expected to create the shared transcript files this task can adopt.
- Missing prerequisite capabilities:
  - the shared transcript foundation from Task 1 must exist before Flows can move off its page-local `displayMessages.map(...)` loop.
- Assumptions that are currently invalid:
  - it is false to assume Flows already uses the shared transcript path or supports citation UI today.

### 5. Transcript Test Harness Support

- Already existing capabilities:
  - Jest/RTL client tests, `client/src/test/setupTests.ts`, `setupChatWsHarness` in `client/src/test/support/mockChatWs.ts`, `setupFlowsRunHarness` in `client/src/test/flowsPage.run.test.tsx`, Codex helper `ensureCodexFlagsPanelExpanded.ts`, and existing layout mock patterns already provide the correct base harnesses for this story.
- Missing prerequisite capabilities:
  - reusable measurement-specific helpers for `ResizeObserver`, row measurement, and scroll-anchor assertions still need to be added under `client/src/test/support/` before the later scroll and virtualization tasks can rely on deterministic measurement behavior.
- Assumptions that are currently invalid:
  - it is false to assume the current tests already cover scroll-anchor behavior, row measurement, or virtual remount state retention.
  - it is also false to assume this story needs a separate virtualization-only harness; the existing harnesses should be extended instead.

### 6. Shared Transcript State Ownership

- Already existing capabilities:
  - after Tasks 1 through 4, the shared transcript path will exist across Chat, Agents, and Flows, and each current page already exposes the state that must move into shared ownership (`toolOpen`, `toolErrorOpen`, `thinkOpen`, citations, and transcript containers).
- Missing prerequisite capabilities:
  - shared conversation-scoped expansion state and conversation-change reset behavior do not exist yet.
- Assumptions that are currently invalid:
  - it is false to assume the current page-local state maps are sufficient for the final shared transcript contract once the rows live in shared components and later virtualized containers.

### 7. Shared Transcript Scroll Contract

- Already existing capabilities:
  - by the time this task starts, the shared transcript path and shared conversation-scoped row state from Tasks 1 through 6 should already exist.
  - the transcript test harness from Task 5 will already provide the measurement helpers needed to prove scroll behavior and anchor preservation.
- Missing prerequisite capabilities:
  - real shared bottom-pinned versus scrolled-away logic and non-virtualized scroll-anchor preservation do not exist yet.
- Assumptions that are currently invalid:
  - it is false to assume the page-local `handleTranscriptScroll` placeholders in Chat and Agents, the current absence of any Flow transcript scroll handler, or the current page-local scroll behavior are sufficient for the final shared transcript contract.

### 8. Transcript Virtualization Foundation

- Already existing capabilities:
  - by the time this task starts, the shared transcript path, shared state ownership, shared scroll contract, and measurement harness from Tasks 1 through 7 should all exist.
  - the current hooks already expose stable `message.id` values, hydration or inflight contracts, and scrollable containers suitable for a virtualizer.
- Missing prerequisite capabilities:
  - `@tanstack/react-virtual` is not yet in `client/package.json`.
  - there is no existing shared virtualizer wrapper or list-windowing layer in the repo today.
- Assumptions that are currently invalid:
  - it is false to assume virtualization support already exists in the client codebase.
  - it is also false to assume virtualization can land safely before the shared transcript, state, scroll, and harness prerequisites are in place.

### 9. Dynamic Measurement Regression Coverage

- Already existing capabilities:
  - by the time this task starts, the virtualizer wrapper from Task 8, the shared scroll contract from Task 7, and the measurement harness from Task 5 should all exist.
- Missing prerequisite capabilities:
  - there is no existing shared row-remeasurement path for streamed growth or rich-section expansion, and the current broad regression suites do not yet prove virtualized row growth behavior.
- Assumptions that are currently invalid:
  - it is false to assume TanStack Virtual can infer dynamic row measurement without the required measured row wrapper details; the shared row wrapper must provide `data-index`, a stable `getItemKey`, and one consistent sizing path instead of mixing `measureElement` and `resizeItem` on the same rows.

### 10. Final Validation and Review Closeout

- Already existing capabilities:
  - the current Dockerfiles, Compose stacks, runtime config path, health endpoints, screenshots folder convention, and client/server build or test wrappers already support client-only transcript changes.
- Missing prerequisite capabilities:
  - Tasks 1 through 9 must be complete before there is anything valid to build, screenshot, document, or regression-test end-to-end for this story.
- Assumptions that are currently invalid:
  - it is false to assume Story 49 is ready for final validation before the shared transcript, harness, scroll contract, and virtualization work have all landed.
  - it is also false to assume this story needs new runtime infrastructure, env-var injection, or Docker surfaces to complete validation.

## Tasks

Story 49 does not require new server message contracts, websocket payload changes, or storage-shape work. Because of that, no separate server-prerequisite implementation task is needed before the client work starts. The tasks below are ordered so each one delivers one testable client change and leaves the repo in a state the next task can build on safely.

### 1. Shared Chat Transcript Foundation

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Create the first shared transcript rendering path under `client/src/components/chat/` and move the Chat page onto it without adding virtualization yet. This task is intentionally limited to the Chat page so a junior developer can prove the shared renderer works in one surface before Agents and Flows depend on it.

#### Documentation Locations

- React docs via Context7 `/reactjs/react.dev` because this task extracts a large transcript subtree into shared components and must preserve component identity, props, and keyed state during the refactor.
- MUI docs via MUI MCP `https://llms.mui.com/material-ui/6.4.12/components/accordion.md` and `https://llms.mui.com/material-ui/6.4.12/components/transitions.md` because the shared transcript keeps heavy tool/citation UI on `Accordion`/transition components and needs the documented `slotProps.transition` behavior.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because the task updates React tests and should keep assertions on visible behavior instead of implementation details.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the last subtask runs workspace linting and the task may introduce new shared component files that need the repo's existing command path.
- Prettier CLI docs `https://prettier.io/docs/cli` because the last subtask runs formatting checks after component and test extraction and needs the official `--check` command behavior.

#### Subtasks

1. [ ] In `client/src/pages/ChatPage.tsx`, locate the current inline transcript render path built around `orderedMessages.map(...)` and move that subtree into new shared files under `client/src/components/chat/`. Copy the current `chat-transcript` container shape, `Stack`/`Paper` bubble layout, timestamp or usage or timing or step metadata, status/warning chips, tool UI, citations accordion, and thought-process collapse exactly before making behavior changes. Docs to re-open while doing this step: Context7 `/reactjs/react.dev`; MUI MCP `https://llms.mui.com/material-ui/6.4.12/components/accordion.md`; MUI MCP `https://llms.mui.com/material-ui/6.4.12/components/transitions.md`.
2. [ ] Create the first shared non-virtualized transcript files in `client/src/components/chat/`. Prefer explicit single-purpose files such as `SharedTranscript.tsx`, `SharedTranscriptMessageRow.tsx`, and one or more rich-section files for tools, citations, and thought-process content. Move `formatBubbleTimestamp`, `buildUsageLine`, `buildTimingLine`, `buildStepLine`, and the shared `renderToolContent(...)` behavior out of `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx`; keep `client/src/components/Markdown.tsx` as the markdown renderer; keep `client/src/components/chat/ConversationList.tsx` and `client/src/components/chat/CodexFlagsPanel.tsx` page-owned; and when using MUI `Accordion`, set `slotProps={{ transition: { unmountOnExit: true } }}` so collapsed heavy content is not kept mounted. Docs: Context7 `/reactjs/react.dev`; MUI MCP accordion/transitions docs above.
3. [ ] Back in `client/src/pages/ChatPage.tsx`, replace the old inline transcript loop with the new shared transcript component and pass the existing Chat-specific inputs into it: `orderedMessages`, empty/loading/warning state, toggle state/handlers, and the current page-owned shell UI. Preserve the exact DOM contract for `data-testid="chat-transcript"`, `chat-bubble`, `tool-toggle`, `citations-toggle`, and `think-toggle`, and do not move `ConversationList` or `CodexFlagsPanel` out of the page layout. Docs: Context7 `/reactjs/react.dev`; local files `client/src/pages/ChatPage.tsx`, `client/src/components/chat/ConversationList.tsx`, and `client/src/components/chat/CodexFlagsPanel.tsx`.
4. [ ] Update `client/src/test/chatPage.toolDetails.test.tsx`, `client/src/test/chatPage.citations.test.tsx`, `client/src/test/chatPage.reasoning.test.tsx`, and `client/src/test/chatPage.stream.test.tsx` so they still prove the same Chat behavior after the shared extraction. Keep the assertions focused on existing visible behavior and existing `data-testid` hooks rather than on the old page-local implementation details. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
5. [ ] Update `projectStructure.md` if this task adds tracked shared transcript files, and add an Implementation Notes entry in this story file naming the new shared files and the Chat behavior intentionally left page-owned. The local docs to update are `projectStructure.md` and this plan file `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the code and docs above are finished. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.toolDetails.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.citations.test.tsx`
5. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.reasoning.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.stream.test.tsx`

#### Implementation notes

- None yet.

---

### 2. Agents Composer Isolation

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Isolate the Agents instruction/composer controls from the transcript subtree so typing into `agent-input` no longer rerenders the full transcript tree on every keystroke. This task is only about the page boundary and input responsiveness; it does not yet move the Agents transcript onto the shared renderer.

#### Documentation Locations

- React docs via Context7 `/reactjs/react.dev` because this task is about component-boundary extraction, controlled input urgency, and keeping typing responsive without breaking React state flow.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task adds an input-isolation regression test and should assert user-visible typing behavior rather than internal rerender details where possible.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task adds a new component and test file and finishes with workspace linting through the repo command wrappers.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after component and test creation and needs the official `--check` behavior.

#### Subtasks

1. [ ] In `client/src/pages/AgentsPage.tsx`, extract the current composer/instruction area into a dedicated child component named `AgentsComposerPanel`. Put it in `client/src/components/agents/AgentsComposerPanel.tsx` unless the repo already has a better existing page-component location. Move the current agent selection, command selection and execute row, working-folder controls, the multiline `agent-input`, `agent-send`, `agent-stop`, and the fixed-width `agent-action-slot` into that component. Docs: Context7 `/reactjs/react.dev`; local file `client/src/pages/AgentsPage.tsx`.
2. [ ] Keep the new `client/src/components/agents/AgentsComposerPanel.tsx` narrowly focused. Its props should only include composer-owned state and callbacks already present in `client/src/pages/AgentsPage.tsx`, such as `selectedAgentName`, `selectedCommandKey`, `startStep`, `agentModelId`, `input`, submit/stop handlers, working-folder state, and disabled/running flags. Preserve the existing `data-testid` values and button behavior exactly so later tests still find `agent-input`, `agent-send`, and `agent-stop`. Docs: Context7 `/reactjs/react.dev`; local file `client/src/pages/AgentsPage.tsx`.
3. [ ] Update `client/src/pages/AgentsPage.tsx` so the new composer boundary receives only the props above and the transcript subtree is no longer recreated from the same per-keystroke state path. Do not route the controlled `agent-input` value through `startTransition` or `useDeferredValue`; React treats text input updates as urgent, so the first fix must be the component boundary itself. Docs: Context7 `/reactjs/react.dev`; local file `client/src/pages/AgentsPage.tsx`.
4. [ ] Create `client/src/test/agentsPage.inputIsolation.test.tsx` and prove that typing into `agent-input` does not cause repeated rerenders of the transcript child when transcript data is unchanged. Reuse the existing Agents test harness from `client/src/test/agentsPage.run.test.tsx` and `client/src/test/agentsPage.layoutWrap.test.tsx`, and mock or spy on the shared transcript child instead of building a second websocket harness. Docs: Context7 `/testing-library/react-testing-library`; local test files just listed.
5. [ ] Update `projectStructure.md` if this task adds `client/src/components/agents/AgentsComposerPanel.tsx` or the new test file, and add an Implementation Notes entry in this plan describing the final boundary and how the render-isolation proof works. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the component, page, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.inputIsolation.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.run.test.tsx`

#### Implementation notes

- None yet.

---

### 3. Agents Shared Transcript Adoption

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Move the Agents transcript itself onto the shared transcript renderer created earlier, while preserving Agents-specific transcript behavior such as `liveStoppedMarker`, tool sections, citations, thought-process toggles, and page-specific empty/loading/warning states. This task is only about adopting the shared renderer on the Agents surface; it should not add virtualization yet.

#### Documentation Locations

- React docs via Context7 `/reactjs/react.dev` because this task composes the shared transcript back into Agents and must preserve state ownership, prop flow, and list identity.
- MUI docs via MUI MCP `https://llms.mui.com/material-ui/6.4.12/components/accordion.md` and `https://llms.mui.com/material-ui/6.4.12/components/transitions.md` because the adopted shared transcript still renders MUI accordion/transition-based tool and citation UI on Agents.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task rewrites multiple Agents tests and should keep them centered on visible transcript behavior.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task edits page code, shared components, and tests before running lint through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after the shared-transcript adoption work and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] In `client/src/pages/AgentsPage.tsx`, replace the current page-local transcript bubble loop with the shared transcript API created in Task 1. Preserve the existing Agents-only behavior for `data-testid="chat-transcript"`, the `agent-turns-error` warning, empty-state copy, `liveStoppedMarker`-driven status chips, tool toggles, citation accordion rendering, and thought-process toggle rendering. Docs: Context7 `/reactjs/react.dev`; local files `client/src/pages/AgentsPage.tsx` and `client/src/components/chat/SharedTranscript.tsx` (or the shared transcript file created in Task 1).
2. [ ] Update the shared transcript component API in `client/src/components/chat/` so Agents can pass its page-specific state and metadata without recreating a page-local `displayMessages.map(...)` loop in `client/src/pages/AgentsPage.tsx`. Reuse the shared formatter helpers and tool-detail pieces extracted in Task 1, and keep agent-only command-label or run-state logic page-owned. Docs: Context7 `/reactjs/react.dev`; local files `client/src/components/chat/*` and `client/src/pages/AgentsPage.tsx`.
3. [ ] Back in `client/src/pages/AgentsPage.tsx`, wire the current `displayMessages` array, assistant/user styling flags, status-chip rules, and the existing `data-testid` contract into the shared transcript component. Do not change the visible order or rename existing selectors that the tests already use. Docs: local file `client/src/pages/AgentsPage.tsx`; local tests listed in the next subtask.
4. [ ] Update `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.streaming.test.tsx`, `client/src/test/agentsPage.citations.test.tsx`, `client/src/test/agentsPage.reasoning.test.tsx`, and `client/src/test/agentsPage.toolsUi.test.tsx` so they prove the shared transcript still handles realtime events, streamed output, citations, thought-process toggles, and rich-row tool sections on Agents. Keep the assertions on visible behavior and current selectors, not on internal component names. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
5. [ ] Update `projectStructure.md` if this task adds or removes tracked shared transcript files, and add an Implementation Notes entry in this plan naming the Agents-specific behavior that remained page-configured after the move. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the code, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.run.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.streaming.test.tsx`
5. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.citations.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.reasoning.test.tsx`
7. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.toolsUi.test.tsx`

#### Implementation notes

- None yet.

---

### 4. Flows Shared Transcript Adoption

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Move the Flows transcript onto the shared transcript renderer while preserving Flow-specific transcript behavior such as `buildFlowMetaLine(...)`, flow-loading copy, the existing flow transcript warnings, the current retained-assistant display during in-flight transitions, and the current absence of citation accordions on that surface. This task is only about the Flows surface and should not add virtualization or new message contracts.

#### Documentation Locations

- React docs via Context7 `/reactjs/react.dev` because this task composes the shared transcript into Flows and must preserve prop flow, keyed row identity, and surface-specific rendering behavior.
- MUI docs via MUI MCP `https://llms.mui.com/material-ui/6.4.12/components/chips.md` and `https://llms.mui.com/material-ui/6.4.12/components/tooltips.md` because Flows keeps chip and tooltip behavior around transcript metadata, and the component guides cover the interaction and accessibility rules a junior developer will need more directly than the bare API tables.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task updates Flow transcript tests and should keep assertions on visible output and existing selectors.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task edits page code, shared components, and tests before running lint through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after the shared-transcript adoption work and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] In `client/src/pages/FlowsPage.tsx`, replace the current page-local transcript bubble loop with the shared transcript API while preserving the current Flows-only configuration points: `data-testid="flows-transcript"`, loading/empty-flow copy, the `flows-turns-error` warning, `bubble-flow-meta` output from `buildFlowMetaLine(...)`, retained-assistant behavior during step transitions, and the current absence of citation UI on Flows. Docs: Context7 `/reactjs/react.dev`; local files `client/src/pages/FlowsPage.tsx` and the shared transcript files under `client/src/components/chat/`.
2. [ ] Extend the shared transcript component API only where Flows genuinely needs it. Keep `buildFlowMetaLine(...)` inside `client/src/pages/FlowsPage.tsx`, pass its output into the shared transcript as a per-message metadata value, and make citation rendering an explicit per-surface option so Flows continues to omit citation accordions while Chat and Agents keep them. Docs: Context7 `/reactjs/react.dev`; local files `client/src/pages/FlowsPage.tsx` and `client/src/components/chat/*`.
3. [ ] Back in `client/src/pages/FlowsPage.tsx`, wire the existing `displayMessages` order, flow metadata line, status chip behavior, and current selectors such as `flows-transcript`, `chat-bubble`, and `bubble-flow-meta` into the shared transcript component. Do not change retained-assistant behavior or add new citation UI. Docs: local file `client/src/pages/FlowsPage.tsx`.
4. [ ] Update `client/src/test/flowsPage.test.tsx` and `client/src/test/flowsPage.run.test.tsx` so they prove the shared transcript still handles flow selection state, transcript rendering, streamed assistant output, retained-assistant transitions, and the extra flow metadata line. Keep the tests focused on visible behavior and the existing selectors. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
5. [ ] Update `projectStructure.md` if this task adds or removes tracked shared transcript files, and add an Implementation Notes entry in this plan explaining how the shared transcript accepts flow-specific metadata without adding Flow citations. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the code, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.run.test.tsx`

#### Implementation notes

- None yet.

---

### 5. Transcript Test Harness Support

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Create the client test-support harness pieces that Story 49 needs before the shared transcript scroll behavior and later virtualization work depend on deterministic measurement assertions. This task is only for test infrastructure under `client/src/test/support/` plus proof that the harness can run and surface errors clearly; it must not introduce production transcript behavior changes.

#### Documentation Locations

- Jest docs via Context7 `/jestjs/jest` and the official configuration page `https://jestjs.io/docs/configuration` because this task adds a reusable helper, a proof test, and may need setup/config changes in the client Jest environment.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because the helper is consumed by React-facing tests and should support DOM-visible assertions rather than implementation-detail checks.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task adds new support files and test files before running lint through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after support-file changes and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] Create one small transcript measurement helper surface in `client/src/test/support/transcriptMeasurementHarness.ts` for Story 49. Keep it limited to controllable `ResizeObserver` behavior, scroll-container sizing hooks, row-height/measurement triggers, and one explicit misuse error path for invalid container or row targets. Docs: Context7 `/jestjs/jest`; Context7 `/testing-library/react-testing-library`; local file `client/src/test/setupTests.ts`.
2. [ ] Wire `client/src/test/support/transcriptMeasurementHarness.ts` into the existing test support instead of inventing a second harness. Reuse `client/src/test/support/mockChatWs.ts`, the `setupFlowsRunHarness` pattern in `client/src/test/flowsPage.run.test.tsx`, and `client/src/test/support/ensureCodexFlagsPanelExpanded.ts`; only touch `client/src/test/setupTests.ts` if a global setup hook is genuinely required. Docs: local files just listed plus Context7 `/jestjs/jest`.
3. [ ] Add `client/src/test/transcriptTestHarness.test.ts` and prove the new harness can run in Jest, can drive at least one transcript-style measurement or scroll update, and can raise the checked misuse error path instead of failing silently when the container or measured row target is missing. The purpose of this file is to prove the harness itself, not product behavior. Docs: Context7 `/jestjs/jest`; local file `client/src/test/transcriptTestHarness.test.ts`.
4. [ ] Update one real transcript-facing test to use the new harness, preferably `client/src/test/chatPage.layoutHeight.test.tsx` or `client/src/test/agentsPage.layoutWrap.test.tsx`, so the helper is proven in real use and not just in the isolated harness proof file. Keep the existing product assertions and swap only the measurement setup to the shared helper, then add one assertion that a late measurement callback against an already-removed row target does not crash the rendered transcript test path. Docs: Context7 `/testing-library/react-testing-library`; local tests listed in this subtask.
5. [ ] Update `projectStructure.md` if this task adds `client/src/test/support/transcriptMeasurementHarness.ts` or the proof test, and add an Implementation Notes entry in this plan naming the harness file and the real test that adopted it. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the harness, proof test, adopted real test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/transcriptTestHarness.test.ts`
4. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.layoutHeight.test.tsx`

#### Implementation notes

- None yet.

---

### 6. Shared Transcript State Ownership

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Implement shared transcript ownership for conversation-scoped rich-row UI state before scroll work or virtualization depend on it. This task is specifically about who owns expansion state and when it resets; it does not yet introduce the shared scroll contract or the virtualizer.

#### Documentation Locations

- React docs via Context7 `/reactjs/react.dev` because this task centralizes row state ownership, relies on stable keys, and must reset state correctly when conversation identity changes.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task updates citation/thought-process tests and should prove the new shared state through visible behavior.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task may add shared state files before running lint through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after shared-state changes and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] In the shared transcript files under `client/src/components/chat/`, replace the current page-local transcript UI state with one shared transcript-owned state model. Keep that state in `SharedTranscript.tsx` unless the file becomes hard to read, in which case extract it to `client/src/components/chat/useSharedTranscriptState.ts`. Move the current `toolOpen`, `toolErrorOpen`, `thinkOpen`, and citation expansion state into that one conversation-scoped owner keyed by existing message and tool identities. Docs: Context7 `/reactjs/react.dev`; local files `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/pages/FlowsPage.tsx`, and the shared transcript files under `client/src/components/chat/`.
2. [ ] Make the shared row state reset correctly when the active conversation changes so one conversation cannot leak citation, tool-detail, tool-error, or thought-process expansion state into another. Use the existing conversation identity already available to the page/shared transcript boundary; do not invent a new persisted key or transport field. Docs: local shared transcript files and hook contracts in `client/src/hooks/useChatStream.ts` and `client/src/hooks/useConversationTurns.ts`.
3. [ ] Update `client/src/test/chatPage.citations.test.tsx`, `client/src/test/chatPage.reasoning.test.tsx`, `client/src/test/agentsPage.citations.test.tsx`, `client/src/test/agentsPage.reasoning.test.tsx`, and `client/src/test/flowsPage.test.tsx` so they prove citation toggles and thought-process toggles are now backed by shared conversation-scoped state, that switching to a different conversation clears the previous expansion state, and that Flows still omits citation UI while keeping `bubble-flow-meta`. Keep the assertions on visible behavior and current selectors. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
4. [ ] Update `projectStructure.md` if this task adds `client/src/components/chat/useSharedTranscriptState.ts` or any other tracked state file, and add an Implementation Notes entry in this plan describing which transcript state moved into shared ownership and how conversation-change reset is handled. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the code, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.citations.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.reasoning.test.tsx`
5. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.citations.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.reasoning.test.tsx`
7. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.test.tsx`

#### Implementation notes

- None yet.

---

### 7. Shared Transcript Scroll Contract

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Implement the shared transcript scroll behavior that all three surfaces need before virtualization: bottom-pinned versus scrolled-away handling and scroll-anchor preservation for non-virtualized shared rows. This task is specifically about shared scroll behavior, not about adding the virtualizer itself.

#### Documentation Locations

- React docs via Context7 `/reactjs/react.dev` because this task changes scroll-sensitive shared UI behavior and must keep update ordering predictable while the user is typing or reading.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task adds and updates scroll/layout tests that should assert observable scroll behavior rather than implementation details.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task may add shared scroll logic before running lint through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after scroll-contract changes and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] In the shared transcript container file under `client/src/components/chat/` (keep it inside `SharedTranscript.tsx` unless that file becomes unreadable), replace the page-local `handleTranscriptScroll` placeholders in Chat and Agents plus the current no-handler Flows behavior with one shared bottom-pinned versus scrolled-away model. Use one shared near-bottom threshold constant for Chat, Agents, and Flows instead of per-page tuning. Docs: Context7 `/reactjs/react.dev`; local files `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/pages/FlowsPage.tsx`, and the shared transcript container file.
2. [ ] Still in the shared transcript container, implement scroll-anchor preservation for height changes caused by streaming text or rich-section expansion on the existing non-virtualized shared transcript. Reuse the helper from `client/src/test/support/transcriptMeasurementHarness.ts` created in Task 5 and prefer one transcript-container-level scroll-preservation calculation instead of item-by-item bookkeeping before virtualization exists. Docs: local shared transcript files; local test helper `client/src/test/support/transcriptMeasurementHarness.ts`.
3. [ ] Create `client/src/test/sharedTranscript.scrollBehavior.test.tsx` and prove that the shared transcript stops auto-scrolling when the user scrolls away from the bottom, preserves reading position during row growth, re-pins only after the user returns near the bottom, and degrades safely when the measurement helper reports a missing row target after unmount instead of crashing the transcript. This file is the source of truth for the shared scroll contract. Docs: Context7 `/testing-library/react-testing-library`; local helper `client/src/test/support/transcriptMeasurementHarness.ts`.
4. [ ] Update `client/src/test/chatPage.layoutWrap.test.tsx`, `client/src/test/chatPage.layoutHeight.test.tsx`, `client/src/test/agentsPage.layoutWrap.test.tsx`, and `client/src/test/flowsPage.test.tsx` so they prove the new shared transcript scroll behavior instead of the old page-local placeholders or missing Flow handler. Keep the existing layout assertions and selectors, swap the setup/behavior expectations to the shared transcript contract, and include one regression where row growth happens after an off-screen row has already been removed from the DOM. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
5. [ ] Update `projectStructure.md` if this task adds a tracked scroll helper file, and add an Implementation Notes entry in this plan describing the final pinned-bottom rule and how scroll-anchor preservation is implemented before virtualization. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the code, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.layoutHeight.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/sharedTranscript.scrollBehavior.test.tsx`
5. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.layoutWrap.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.layoutWrap.test.tsx`
7. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.test.tsx`

#### Implementation notes

- None yet.

---

### 8. Transcript Virtualization Foundation

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Add the first shared virtualization layer to the shared transcript so long transcripts stop mounting the full rich message tree at once. This task is specifically about adding the virtualizer seam and proving baseline transcript rendering still works across Chat, Agents, and Flows; it does not yet finish the dynamic row-growth regressions.

#### Documentation Locations

- TanStack Virtual docs via Context7 `/tanstack/virtual` because this task introduces the library itself and needs the documented `useVirtualizer`, `count`, `getScrollElement`, `getItemKey`, `estimateSize`, and `overscan` APIs.
- React docs via Context7 `/reactjs/react.dev` because virtualization still depends on stable component identity, keyed rows, and clean parent/child boundaries.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task updates cross-surface transcript tests after introducing virtualization and should keep them user-visible.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task adds new virtualization files and updates page/shared components before linting through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after virtualization setup changes and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] Add `@tanstack/react-virtual` to `client/package.json` and update `package-lock.json` in the same commit. Do not add any second virtualization library. Docs: Context7 `/tanstack/virtual`; local files `client/package.json` and `package-lock.json`.
2. [ ] Add the first virtualized transcript seam in `client/src/components/chat/VirtualizedTranscript.tsx` (preferred) or keep it inside the existing shared transcript container if that remains small. Use the shared transcript scroll container as the single virtualizer scroll element, and keep `ConversationList`, `CodexFlagsPanel`, and other page shell UI outside the virtualized subtree. Docs: Context7 `/tanstack/virtual`; local shared transcript files under `client/src/components/chat/`.
3. [ ] In `client/src/components/chat/VirtualizedTranscript.tsx`, use stable row keys with the shape `getItemKey: (index) => messages[index].id`, one conservative shared `overscan` rule, and a reasonable `estimateSize`. Do not split this work into both a new hook and a new wrapper unless the code clearly becomes unreadable. Keep the measured row wrapper ready for the later dynamic-measurement task, but do not add broad row-growth handling here. Docs: Context7 `/tanstack/virtual`; Context7 `/reactjs/react.dev`.
4. [ ] Update `client/src/test/chatPage.stream.test.tsx`, `client/src/test/agentsPage.run.test.tsx`, and `client/src/test/flowsPage.run.test.tsx` so they prove the shared virtualized transcript still handles baseline transcript rendering, streamed output, and a transient empty transcript state during conversation switch or refresh on the three surfaces before the later dynamic-measurement refinements land. Keep the assertions on visible behavior and existing selectors, and explicitly prove that stale virtual rows are not left mounted when `messages` briefly becomes empty. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
5. [ ] Update `projectStructure.md` if this task adds `client/src/components/chat/VirtualizedTranscript.tsx` or other tracked files, and add an Implementation Notes entry in this plan describing the virtualizer seam, the `getItemKey` rule, and the shared overscan rule. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the dependency, code, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.stream.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.run.test.tsx`
5. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.run.test.tsx`

#### Implementation notes

- None yet.

---

### 9. Dynamic Measurement Regression Coverage

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Finish the virtualized transcript behavior that depends on dynamic row measurement and row-growth handling. This task is specifically about remeasurement, size-change correction, and the broader regression coverage that proves virtualization did not break rich transcript behavior.

#### Documentation Locations

- TanStack Virtual docs via Context7 `/tanstack/virtual` because this task depends on the documented `measureElement`, variable-height row measurement, and size-change adjustment behavior.
- React docs via Context7 `/reactjs/react.dev` because this task must preserve user-controlled row state across rerenders and virtual unmount/remount cycles.
- Testing Library docs via Context7 `/testing-library/testing-library-docs` because this task updates broad regression coverage and those tests should keep asserting user-visible behavior rather than internals.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the task adds measurement logic and touches many tests before linting through the repo's workspace command.
- Prettier CLI docs `https://prettier.io/docs/cli` because the task ends with formatting checks after dynamic-measurement changes and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] In `client/src/components/chat/VirtualizedTranscript.tsx` (or the shared transcript file that owns virtualization), add row remeasurement and size-change handling so streaming markdown, tool-detail expansion, citation expansion, and thought-process expansion keep rows correctly positioned without losing the reader's place. Use one measured message-row wrapper with the pattern `data-index={virtualRow.index}` and `ref={virtualizer.measureElement}`, and wire scroll-size-change correction through TanStack Virtual's built-in adjustment path rather than ad-hoc row math or per-subsection measurement registries. Docs: Context7 `/tanstack/virtual`; local shared transcript files under `client/src/components/chat/`.
2. [ ] Preserve conversation-scoped UI state across virtual unmount and remount while doing the row-growth work above, and do not mix `measureElement` and `resizeItem` on the same measured rows. The state source of truth should stay in the shared transcript state owner from Task 6 rather than moving back into row-local component state. Docs: Context7 `/reactjs/react.dev`; local file `client/src/components/chat/useSharedTranscriptState.ts` if it exists, otherwise the shared transcript container/state file.
3. [ ] Update `client/src/test/chatPage.layoutHeight.test.tsx`, `client/src/test/sharedTranscript.scrollBehavior.test.tsx`, `client/src/test/chatPage.reasoning.test.tsx`, `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`, `client/src/test/agentsPage.layoutWrap.test.tsx`, `client/src/test/agentsPage.reasoning.test.tsx`, `client/src/test/flowsPage.test.tsx`, `client/src/test/flowsPage.run.test.tsx`, `client/src/test/useConversationTurns.refresh.test.ts`, `client/src/test/useConversationTurns.commandMetadata.test.ts`, and `client/src/test/useChatStream.inflightMismatch.test.tsx` so they prove virtualization did not break hydration, retained-assistant behavior, citation/thought state persistence, scroll-anchor behavior, layout-sensitive behavior, transient empty-transcript refresh states, or in-flight replacement cases where only one visible assistant row should survive after the `message.id`-based merge settles. Prefer adapting current assertions over inventing new broad synthetic scenarios. Docs: Context7 `/testing-library/react-testing-library`; local test files listed in this subtask.
4. [ ] Update `projectStructure.md` if this task adds tracked virtualization or measurement files, and add an Implementation Notes entry in this plan describing the dynamic-measurement seam, the measured row wrapper contract, and any measurement helper used. Local docs to update: `projectStructure.md` and `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after the code, test, and docs updates are complete. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run typecheck:summary:client`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.layoutHeight.test.tsx`
4. [ ] `npm run test:summary:client -- --file client/src/test/sharedTranscript.scrollBehavior.test.tsx`
5. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.reasoning.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`
7. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.layoutWrap.test.tsx`
8. [ ] `npm run test:summary:client -- --file client/src/test/agentsPage.reasoning.test.tsx`
9. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.test.tsx`
10. [ ] `npm run test:summary:client -- --file client/src/test/flowsPage.run.test.tsx`
11. [ ] `npm run test:summary:client -- --file client/src/test/useConversationTurns.refresh.test.ts`
12. [ ] `npm run test:summary:client -- --file client/src/test/useConversationTurns.commandMetadata.test.ts`
13. [ ] `npm run test:summary:client -- --file client/src/test/useChatStream.inflightMismatch.test.tsx`

#### Implementation notes

- None yet.

---

### 10. Final Validation and Review Closeout

- Task Status: `__to_do__`
- Git Commits: ``

#### Overview

Check the finished implementation against every acceptance criterion, run the full wrapper-based validation path, complete any remaining documentation updates, and leave behind the final review artifacts for the story. This task must not introduce new feature work; it is only for proving the completed story and documenting the result.

#### Documentation Locations

- Playwright docs via Context7 `/microsoft/playwright` and the official screenshots page `https://playwright.dev/docs/screenshots` because this task captures review screenshots and may need browser-level validation guidance.
- Docker docs `https://docs.docker.com/compose/compose-file/` and `https://docs.docker.com/reference/cli/docker/compose/` because this task runs wrapper-backed Compose build/up/down flows and needs both the Compose file semantics and the current `docker compose` CLI reference.
- Jest docs via Context7 `/jestjs/jest` and the official configuration page `https://jestjs.io/docs/configuration` because this task runs the full client test suite and may need the current runner/config reference when triaging failures.
- Cucumber guides `https://cucumber.io/docs/guides/continuous-integration/` because this task runs the server cucumber suite through wrapper commands, and that guide explicitly documents exit-code and CI execution behavior from the official guides section.
- Mermaid docs `https://mermaid.js.org/intro/syntax-reference` because this task may need final design/documentation diagram updates.
- ESLint CLI docs `https://eslint.org/docs/latest/use/command-line-interface` because the final subtask runs workspace linting across all touched files through the repo's established command path.
- Prettier CLI docs `https://prettier.io/docs/cli` because the final subtask runs workspace formatting checks across all touched files and needs the official CLI `--check` behavior.

#### Subtasks

1. [ ] Re-read the Acceptance Criteria section in this file and create a short pass/fail checklist in this task's `Implementation notes` before running final validation. That checklist must name Chat, Agents, and Flows separately and must explicitly mention hydration/in-flight merge behavior, retained-assistant behavior on Flows, citation-state persistence, pinned-bottom versus manual-scroll-away behavior, transient empty-transcript recovery, and the controlled measurement-failure path. Local source: this file `planning/0000049-responsive-long-conversation-transcript-rendering.md`.
2. [ ] Review `README.md`, `design.md`, and `projectStructure.md` after all code changes are complete. Update only the files genuinely changed by Story 49, and record in `Implementation notes` which docs changed and which intentionally stayed untouched. Docs/guides to re-open if needed: Context7 `/mermaid-js/mermaid` for any diagram edits; local docs `README.md`, `design.md`, and `projectStructure.md`.
3. [ ] Write a pull-request-ready summary covering every task in Story 49. If the repo already has a normal review-summary location, put it there; otherwise store the full text in this task's `Implementation notes`. The summary must mention shared transcript extraction, Agents composer isolation, Flows adoption, harness work, shared state, scroll contract, virtualization, dynamic measurement, and final validation results. Local source of truth: this plan file and the files changed across Tasks 1 through 9.
4. [ ] Save manual validation screenshots to `test-results/screenshots/` using the pattern `0000049-10-<short-name>.png`. Capture at least one screenshot each for Chat, Agents, and Flows after the shared transcript and virtualization changes are complete, and make sure the screenshots show the final rendered UI rather than an intermediate loading state. Docs: Context7 `/microsoft/playwright`; local output folder `test-results/screenshots/`.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces` from the repo root after all final code and docs edits are complete so the story closes with a clean workspace. Command reference: `README.md`; lint/format docs if needed: Context7 `/eslint/eslint` and `/prettier/prettier`.

#### Testing

Wrapper-first rule: use the repository wrappers below instead of raw build or test commands.

1. [ ] `npm run build:summary:server`
2. [ ] `npm run typecheck:summary:client`
3. [ ] `npm run build:summary:client`
4. [ ] `npm run test:summary:client`
5. [ ] `npm run test:summary:server:unit`
6. [ ] `npm run test:summary:server:cucumber`
7. [ ] `npm run compose:build:summary`
8. [ ] `npm run compose:up`
9. [ ] Perform the manual long-transcript validation scenario described earlier in this story against the running stack, then save the required screenshots under `test-results/screenshots/`
10. [ ] `npm run test:summary:e2e`
11. [ ] `npm run compose:down`

#### Implementation notes

- None yet.

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
   - What the answer is: go with the researched recommendation and allow one focused client dependency for virtualization, with `@tanstack/react-virtual` as the preferred choice. React 19 component-boundary isolation and stable props are the primary fix for the Agents typing hotspot; `startTransition` or deferred updates are optional follow-up tools only for derived non-input work, not for the controlled text input itself.
   - Where the answer came from: the user approved the recommendation, and the recommendation was grounded in local repo inspection of [client/package.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/package.json), the earlier `code_info` findings that the client does not already use a virtualization library, Context7 documentation for `/tanstack/virtual` and `/reactjs/react.dev`, DeepWiki guidance about React responsiveness, and supporting web documentation from React and web.dev on handling expensive list updates.
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
   - Why the question matters: Chat, Agents, and Flows each reverse the `messages` array locally for display, but only Chat and Agents expose empty transcript scroll handlers while Flows currently has no transcript scroll handler at all. Without an explicit shared contract, a refactor could silently flip transcript order or leave the new virtualized transcript with undefined scroll-anchor behavior.
   - What the answer is: the shared transcript must preserve the current visible newest-last reading order across all three pages, centralize the display-order decision in one place, and introduce real shared scroll-anchor logic instead of depending on the current empty Chat or Agents stubs or the current missing Flow handler.
   - Where the answer came from: this answer came from fresh repository inspection of [ChatPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/ChatPage.tsx), [AgentsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/AgentsPage.tsx), and [FlowsPage.tsx](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/client/src/pages/FlowsPage.tsx), plus direct source review of the page-local transcript refs and display-order helpers.
   - Why it is the best answer to the question: it removes a subtle but important source of accidental regressions and makes the shared transcript responsible for behavior that is currently only implicit in the page implementations.

9. Make virtualizer mechanics and regression-test targets explicit
   - The question being addressed: are there implementation details that are important enough to plan explicitly because omitting them would likely cause a junior developer to guess wrong?
   - Why the question matters: dynamic-height transcript virtualization only works reliably when key mechanics such as stable row keys, measurement, overscan, and scroll-size-change handling are set up deliberately, and this story already has broad existing client tests that should guide the regression plan.
   - What the answer is: the plan should explicitly call for `message.id`-backed virtual row keys, `estimateSize`, `measureElement`, `data-index` on measured row wrappers, conservative overscan, and size-change scroll anchoring behavior through TanStack Virtual's built-in adjustment path, and it should name the existing Chat, Agents, Flows, `useChatStream`, and `useChatWs` tests that are likely to need updates or additions. The plan should also make it explicit that the measured rows must not mix `measureElement` and `resizeItem`.
   - Where the answer came from: this answer came from repository inspection, `code_info` guidance on likely test files, DeepWiki guidance for `TanStack/virtual` and `facebook/react`, Context7 documentation for `/tanstack/virtual` and `/reactjs/react.dev`, MUI MCP documentation for Material UI 6 accordions and transitions, and web documentation from TanStack, React, and web.dev.
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
