# Story 0000058 - Users can use the redesigned transcript-first GUI

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

When tasks are later added to this story, use this section contract:

- `Subtasks` are for implementation and proof-authoring work that can be completed before formal proof runs.
- `Testing` is for automated proof execution only.
- `Manual Testing Guidance` is optional, non-blocking guidance for the manual testing agent and must not contain checkboxes.
- Outside `Additional Repositories`, use repository-relative paths, repository aliases, commands, environment-variable names, or other portable lookup directions instead of absolute filesystem paths.
- End each task's `Subtasks` section with separate lint and prettier or format-check subtasks in that order, and end each `Testing` section with separate lint and prettier or format-check steps in that order.
- Keep test-enablement seams such as auth bypasses, seeded identities, mocked providers, or alternate login helpers in test-only harnesses, fixtures, or test configuration rather than in shipped production behavior.
- Prefer the unmodified human Docker stack for manual testing whenever repository evidence shows it is runnable, and only fall back to minimal test-only enablement when the normal stack is not enough.
- Keep automated screenshots and similar generated proof artifacts in ignored artifact locations rather than tracked repository files.
- For any task, put manual-testing screenshots, logs, and similar proof artifacts in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and do not commit them.
- If manual testing for the story will write task-level proof artifacts into `codeInfoTmp/` and `.gitignore` does not already ignore that scratch path, add or update that ignore rule before later proof depends on it.
- For story closeout, state that a later promotion step curates durable final proof into `codeInfoStatus/manual-proof/<story-number>/`.
- When Manual Testing Guidance mentions Playwright MCP screenshots, state that screenshots are captured in the Playwright output directory first and then transferred into the target repository task-scoped scratch destination. `CODEINFO_ROOT` is the harness root and may expose staging paths such as `$CODEINFO_ROOT/playwright-output-local`, but it is not the target artifact root unless the active plan is in the harness repository.
- When useful, recommend deterministic manual-proof basenames such as `proof-01-<slug>.png`, `support-console.txt`, `support-network.json`, and `support-<slug>.log` so later closeout can promote artifacts without guesswork.

### Description

CodeInfo2 already exposes the right product areas for repository-grounded AI work, but the current frontend spends too much vertical space on top navigation and page-specific chrome. That makes `Chat`, `Agents`, and `Flows` feel more like separate admin pages than like focused transcript workspaces, especially on smaller screens and longer conversations.

This story redesigns the GUI around the shared layout system already prepared under `planning/layout-ideas/plan/final-designs`. The redesign should make the transcript the center of gravity of the product, move the active composer to the bottom of workspace pages, and make the newest messages feel naturally anchored at the bottom while preserving the current virtualized transcript behavior. The desktop experience should replace the top navigation with a left app rail and a persistent conversations pane, while the mobile experience should use a full-screen conversations view from the left and a full-screen app menu from the right.

For transcript behavior, the product rule is now explicit: if a user has scrolled up to read older messages, new activity must keep their current reading position rather than snapping them back to the bottom. Automatic bottom-follow behavior should happen only when the user was already near the bottom. This same rule should apply consistently across `Chat`, `Agents`, and `Flows`.

The redesign is intentionally a frontend-first story. It should reuse existing backend capabilities and keep visible behavior within contracts that already exist today, including provider selection, auth and logon actions, ingest status, logs browsing, conversation history, transcript streaming, and flow or agent controls. Backend changes are allowed only if the frontend cannot honestly realize the approved design using current APIs and runtime data.

The biggest user-facing goal is to reclaim vertical transcript space and make `Chat`, `Agents`, and `Flows` feel like one shared family of workspaces. Those pages should share one desktop shell, one responsive mobile behavior model, one conversation-pane design language, and one bottom-composer model. The page-specific behavior should stay in the composer footer controls and the data being shown, not in completely separate layout systems.

`Home`, `Ingest`, and `Logs` should move into a second shared layout family for utility pages. `Home` becomes the global system-status page by absorbing LM Studio status and provider logon state, so users no longer need to treat `Chat` as the place for global runtime setup. The old top-level `LM Studio` route should become a compatibility redirect into `Home` rather than remaining a second user-facing destination. `Ingest` and `Logs` should adopt the new utility-page layout language without adding new backend-dependent functionality or changing ingest and logging semantics.

The design references for this story already exist and should be treated as the source of truth for visual direction, spacing priorities, and mobile or desktop interaction patterns. The most important references live in `planning/layout-ideas/plan/final-designs`, with source SVGs and earlier exploration notes under `planning/layout-ideas/plan/initial-layout`. This story is about implementing that approved design system into the real product shell while preserving current supported behaviors. That includes the new transcript `Copy` affordance, which should copy only the visible message content and not footer metadata such as timing, status, provider, or diagnostics.

### Acceptance Criteria

- `Chat`, `Agents`, and `Flows` share one workspace-shell family on desktop and one responsive mobile behavior model.
- The top tab bar is removed and replaced with the new desktop app rail and mobile app-menu pattern.
- Workspace pages reclaim vertical space so the transcript area is visibly prioritized over navigation and non-essential chrome.
- The active composer is bottom-anchored on workspace pages.
- The visible transcript reading flow is updated so the newest messages appear at the bottom while preserving the existing virtualized transcript path and pinned-bottom behavior.
- If a user is reading older messages away from the bottom, new transcript activity keeps their place instead of snapping them back to the bottom.
- If a user is already near the bottom, new transcript activity keeps following the newest messages automatically.
- Assistant output and user bubbles adopt the new shared transcript style defined by the approved design references.
- The shared conversations pane matches the new design language and works consistently on both desktop and mobile.
- Mobile workspace behavior supports a full-screen conversations surface from the left and a full-screen app menu from the right.
- `Chat`, `Agents`, and `Flows` keep their existing supported page behaviors while moving into the shared shell.
- Page-specific workspace controls are retained through a common composer shell with page-specific footer controls for `Chat`, `Agents`, and `Flows`.
- `Home` becomes the global system-status page and absorbs LM Studio status plus provider logon state.
- Global auth and LM Studio concerns move out of `Chat` and into `Home`.
- `Ingest` and `Logs` adopt the new utility-shell design family without introducing backend-dependent new features.
- The dedicated LM Studio nav entry is removed.
- The old `/lmstudio` route redirects into `Home` instead of remaining a separate user-facing page.
- Message `Copy` actions copy only the message content and do not include timing, status, provider, or other footer metadata.
- Existing supported behaviors such as conversation selection, transcript streaming, flow and agent controls, copy interactions, and current frontend-only UI affordances continue to work after the redesign.
- The redesign is implemented entirely in the frontend unless a backend change is proven necessary to expose already-existing product state to the new UI.

### Out Of Scope

- New backend APIs created purely to satisfy the redesign when the required behavior can be achieved in the frontend.
- New provider-auth capabilities beyond relocating existing UI entry points.
- New ingest, logging, chat, agent, or flow semantics that are not already supported today.
- A separate execution-history redesign for workspace pages.
- Reworking core server orchestration, provider runtime selection, or persistence rules unless a minimal backend adjustment is truly unavoidable.
- Treating the layout-ideas assets as a new speculative design phase instead of implementing the already approved visual direction.
- Keeping `LM Studio` as a second visible top-level destination alongside the new `Home` status page.
- Expanding transcript copy behavior to include footer metadata or hidden diagnostics.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Use the approved assets under `planning/layout-ideas/plan/final-designs` as the visual proof reference during manual QA, with desktop and mobile screenshots compared against the final markdown and image deliverables for each shell family.
- Prefer validating the redesign in the checked-in main stack surfaces at `http://localhost:5001` and `http://localhost:5010` unless later tasking documents a narrower proof seam.
- Manual proof for auth-dependent provider state on `Home` may use the repository-owned skip rule from `codeinfo_markdown/repository_information.md` when the missing state would require human-controlled two-factor authentication; skip only the affected auth-dependent surface and keep the rest of the redesign proof active.
- When screenshots are needed, capture them first in the Playwright output directory and then transfer the chosen artifacts into `codeInfoTmp/manual-testing/0000058/<task-number>/` with deterministic names such as `proof-01-desktop-chat.png`, `proof-02-mobile-home.png`, and `support-console.txt`.
- Later tasking should include desktop and mobile proof across both shell families, with special attention on transcript height, bottom composer behavior, conversation-pane interactions, Home absorbing LM Studio and provider logon concerns, the `/lmstudio` redirect path, and the rule that message `Copy` actions copy only message content while scroll-away transcript reading keeps its place during new activity.

### Questions

None at this time.

## Decisions

1. Transcript scroll-away behavior
   - The question being addressed: If someone scrolls up to read older messages, should new activity keep their place or jump them back to the bottom?
   - Why the question matters: This sets one shared transcript rule for `Chat`, `Agents`, and `Flows`, and it directly affects whether long-running workspaces feel stable.
   - What the answer is: Keep the user's place when they are reading older messages, and only auto-follow new activity when they were already near the bottom.
   - Where the answer came from: User answer in this planning session, plus repo evidence from `client/src/components/chat/SharedTranscript.tsx` and `client/src/components/chat/VirtualizedTranscript.tsx`, supported by TanStack Virtual guidance on scroll adjustment during dynamic size changes.
   - Why it is the best answer: It matches the current shared transcript architecture, preserves virtualization stability, and fits the transcript-first product goal without surprising jumps.
2. LM Studio route handoff
   - The question being addressed: After the redesign, should the old LM Studio page redirect to Home, or stay as a separate page?
   - Why the question matters: The plan moves LM Studio and provider status into `Home`, so the routing contract must stay clear for navigation, bookmarks, tests, and later cleanup.
   - What the answer is: Redirect the old `/lmstudio` route to `Home` and remove `LM Studio` from the visible navigation.
   - Where the answer came from: User answer in this planning session, repo evidence from `client/src/routes/router.tsx`, `client/src/pages/HomePage.tsx`, `client/src/pages/LmStudioPage.tsx`, and design evidence from `planning/layout-ideas/plan/final-designs/home-page-final.md` and `planning/layout-ideas/plan/initial-layout/utility-page-shell.md`.
   - Why it is the best answer: It keeps old links working while making `Home` the single user-facing system-status destination, which is what the approved design direction already says.
3. Transcript copy behavior
   - The question being addressed: When a user presses `Copy` on a message, should it copy only the message text, or also include timing and status details?
   - Why the question matters: The redesign adds visible message-level `Copy` actions across workspace pages, so the clipboard output must be predictable and consistent.
   - What the answer is: Copy only the message content, not timing, status, provider, or other footer metadata.
   - Where the answer came from: User answer in this planning session, design evidence from `planning/layout-ideas/plan/final-designs/desktop-workspace-shell-final.md`, local UI evidence from `client/src/components/chat/SharedTranscriptMessageRow.tsx`, and existing copy-action precedent in `planning/0000031-codex-device-auth-relogin.md`.
   - Why it is the best answer: It matches the design separation between `Info` and `Copy`, keeps the feature easy to understand, and avoids mixing reusable content with transient diagnostics.

## Implementation Ideas

- Follow the recommended delivery order from the approved brief:
  - update shared transcript and composer behavior first;
  - build the shared desktop workspace shell;
  - build the shared mobile workspace shell;
  - add page-specific composer footers for `Chat`, `Agents`, and `Flows`;
  - move `Home` to the new system-status design;
  - move `Ingest` and `Logs` to the utility-shell family;
  - remove the dedicated LM Studio nav entry and fold its content into `Home`.
- Start with the transcript foundation in:
  - `client/src/components/chat/SharedTranscript.tsx`
  - `client/src/components/chat/SharedTranscriptMessageRow.tsx`
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/pages/FlowsPage.tsx`
- Treat the transcript-first foundation as the highest-risk frontend seam because it must preserve virtualization, pinned-bottom behavior, scroll-away reading stability, copy interactions, and page-specific transcript metadata while changing reading order and composer placement.
- Build a reusable workspace-shell abstraction for `Chat`, `Agents`, and `Flows` rather than reimplementing the same desktop and mobile structure independently in each page.
- Rework `client/src/components/NavBar.tsx`, `client/src/components/chat/ConversationList.tsx`, and `client/src/routes/router.tsx` so global navigation and shared conversation access align with the new desktop app rail and mobile app-menu model.
- Keep the current near-bottom follow behavior as the bottom-follow rule, and preserve scroll position when new rows stream in while the user is reading older content.
- Keep one common composer shell and swap only the footer controls:
  - `Chat` keeps provider, model, and options controls;
  - `Agents` keeps agent, command, and step controls;
  - `Flows` keeps flow and title controls.
- Use these design references as the primary shell and composer guidance:
  - `planning/layout-ideas/plan/final-designs/desktop-workspace-shell-final.png`
  - `planning/layout-ideas/plan/final-designs/desktop-workspace-shell-final.md`
  - `planning/layout-ideas/plan/final-designs/mobile-workspace-shell-main-final.png`
  - `planning/layout-ideas/plan/final-designs/mobile-workspace-shell-main-final.md`
  - `planning/layout-ideas/plan/final-designs/mobile-workspace-shell-conversations-final.png`
  - `planning/layout-ideas/plan/final-designs/mobile-workspace-shell-conversations-final.md`
  - `planning/layout-ideas/plan/final-designs/mobile-app-menu-final.png`
  - `planning/layout-ideas/plan/final-designs/mobile-app-menu-final.md`
  - `planning/layout-ideas/plan/final-designs/chat-composer-final.png`
  - `planning/layout-ideas/plan/final-designs/chat-composer-final.md`
  - `planning/layout-ideas/plan/final-designs/agents-composer-final.png`
  - `planning/layout-ideas/plan/final-designs/agents-composer-final.md`
  - `planning/layout-ideas/plan/final-designs/flows-composer-final.png`
  - `planning/layout-ideas/plan/final-designs/flows-composer-final.md`
- Use the initial SVGs as source geometry or spacing references where implementation detail is easier to read from vector assets:
  - `planning/layout-ideas/plan/initial-layout/desktop-workspace-shell.svg`
  - `planning/layout-ideas/plan/initial-layout/mobile-workspace-shell-main.svg`
- Move utility pages into a second shared layout family by reworking:
  - `client/src/pages/HomePage.tsx`
  - `client/src/pages/LmStudioPage.tsx`
  - `client/src/pages/IngestPage.tsx`
  - `client/src/pages/LogsPage.tsx`
  - `client/src/components/ingest/RootDetailsDrawer.tsx`
- Treat `Home` as the new global system-status page and migrate LM Studio plus provider-logon surfaces there without changing the underlying backend contracts they consume.
- Convert the old `/lmstudio` page into a compatibility redirect to `Home` rather than maintaining a second visible destination for the same system-status concerns.
- Keep `Ingest` and `Logs` visually aligned with the new utility-shell design while explicitly resisting scope creep into new ingest or logging features.
- Implement transcript `Copy` actions so they copy only the message body content and not footer metadata or hidden diagnostic details.
- When tasking this story up later, split work so transcript mechanics, shared shell primitives, page-specific composer adapters, and utility-page migration can be validated incrementally without reopening backend work unless a concrete frontend blocker is discovered.
