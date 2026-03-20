# Title

Users can work with long conversation transcripts without the app slowing down

# Acceptance

1. Chat users can view long conversations without the transcript making the page feel sluggish.
2. Agents users can type into the `Instruction` field while a long transcript is visible without noticeable input lag.
3. Flows users can read long run transcripts without losing the current flow-specific transcript details they already rely on.
4. Users can still expand and read rich transcript content such as tools, reasoning, and citations where those features already exist.
5. Users can scroll back through older transcript content without the app forcing them back to the bottom when new content appears.
6. Users can return to the bottom of the transcript and continue following new content as it arrives.
7. Users keep the same visible transcript order and page-specific transcript behaviour on Chat, Agents, and Flows after the change.
8. Support, QA, and product reviewers can confirm the improved transcript behaviour through browser checks, screenshots, and the planned proof logs.
9. The improvement is delivered as a front-end change and does not require a server or data-contract change for users to benefit from it.

# Description

This story improves the experience of reading and using long conversations in the product. Today, very large transcripts can make the interface feel slow, especially on the Agents page while someone is typing a new instruction. When this story is complete, Chat, Agents, and Flows will all use a shared, more efficient transcript renderer so users can keep working with long conversations smoothly while still seeing the rich transcript details they already expect.

# Tasks

1. Create the first shared transcript for Chat.

- Move the Chat transcript UI out of `client/src/pages/ChatPage.tsx`.
- Add shared transcript files under `client/src/components/chat/`.

2. Isolate the Agents composer from the transcript.

- Extract `AgentsComposerPanel.tsx` and `AgentsTranscriptPane.tsx`.
- Keep `agent-input`, send, and stop controls working with the same test ids.

3. Move Agents onto the shared transcript renderer.

- Replace the page-local Agents transcript loop with shared transcript components.
- Preserve Agents warning states, stopped markers, tools, reasoning, and citations.

4. Move Flows onto the shared transcript renderer.

- Replace the page-local Flows transcript loop with shared transcript components.
- Keep `buildFlowMetaLine(...)`, retained-assistant behaviour, and no citation UI on Flows.

5. Add transcript measurement test support.

- Create `client/src/test/support/transcriptMeasurementHarness.ts`.
- Prove the harness works from client transcript tests before later scroll and virtualization work uses it.

6. Centralise shared transcript row state.

- Add `client/src/components/chat/useSharedTranscriptState.ts`.
- Move transcript expansion state out of page-local components and reset it correctly on conversation change.

7. Add one shared scroll contract.

- Put shared bottom-pinned and scroll-away behaviour into `client/src/components/chat/SharedTranscript.tsx`.
- Add shared scroll-anchor handling before virtualization lands.

8. Add virtualization for long transcripts.

- Add `@tanstack/react-virtual` in `client/package.json`.
- Create `client/src/components/chat/VirtualizedTranscript.tsx` for shared transcript windowing.

9. Finish dynamic measurement and regression coverage.

- Update shared transcript measurement so growing rows stay positioned correctly.
- Extend client tests for row growth, hydration, retained assistant behaviour, and rich-row state.

10. Run final validation and close out the story.

- Update `design.md`, `projectStructure.md`, and the story notes with the final implementation shape.
- Run the wrapper-based checks and capture final GUI evidence under `playwright-output-local/`.
