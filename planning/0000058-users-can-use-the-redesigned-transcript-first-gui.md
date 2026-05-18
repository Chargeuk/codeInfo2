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

The redesign must preserve the current control semantics that already exist behind those pages. That includes `Chat` next-send provider and model switching plus working-folder lock behavior, `Agents` agent-to-command-to-step dependency resets and prompt-discovery invalidation rules, and `Flows` fresh-run versus resume distinctions such as custom titles only applying to new runs.

Where the redesign hides, disables, collapses, or moves stateful controls, it must keep the current state-transition rules explicit. Some state must be retained locally but excluded from submission, such as a dirty LM Studio draft field or `Chat` next-send-only provider/model changes against a locked resumed conversation. Other state must be cleared when its parent choice changes, such as an `Agents` command/step selection after the chosen agent changes. The redesign should not leave any mixed mode where the UI presents one state but a stale hidden value from another state still reaches payloads or persistence.

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
- The redesigned footer controls preserve current execution semantics: `Chat` provider and model changes remain next-send-only and do not mutate a locked resumed conversation, `Agents` agent changes still clear the selected command and reset the start step, and `Flows` custom titles still apply only to fresh runs and stay out of resume payloads.
- Desktop conversation-pane collapse and mobile conversations or app-menu overlays preserve current conversation selection, `Active` or `Archived` filter behavior, and row-level archive or restore actions instead of inventing new list semantics.
- Hidden, collapsed, disabled, or read-only controls do not leak stale state into payloads or persistence. State that is no longer valid for the active mode is either cleared immediately or retained locally but explicitly excluded from submission, depending on the current contract for that surface.
- `Home` becomes the global system-status page and absorbs LM Studio status plus provider logon state.
- Global auth and LM Studio concerns move out of `Chat` and into `Home`.
- `Home` reuses the current provider and LM Studio contracts rather than inventing new status semantics: passive provider state is derived from existing `available`, `toolsAvailable`, and `reason` fields, while auth actions still run through the shared device-auth dialog flow.
- The LM Studio controls moved onto `Home` preserve the current draft-versus-committed behavior: typing a new base URL changes only the local input until the user chooses `Check status` or `Reset to default`, and `Refresh models` reuses the currently committed base URL.
- `Ingest` and `Logs` adopt the new utility-shell design family without introducing backend-dependent new features.
- The dedicated LM Studio nav entry is removed.
- The old `/lmstudio` route redirects into `Home` instead of remaining a separate user-facing page.
- Direct navigation, browser refresh, and existing bookmarks for `/lmstudio` still land on `Home` with the LM Studio section visible.
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
- Adding a new query-string deep-link contract such as `/lmstudio?baseUrl=...` when the current frontend only supports stored and runtime-configured LM Studio base URLs.
- Expanding transcript copy behavior to include footer metadata or hidden diagnostics.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Use the approved assets under `planning/layout-ideas/plan/final-designs` as the visual proof reference during manual QA, with desktop and mobile screenshots compared against the final markdown and image deliverables for each shell family.
- Manual testers should explicitly exercise both larger desktop views and mobile views for every shell family touched by this story, rather than treating one screen size as representative of the other.
- Prefer validating the redesign in the checked-in main stack surfaces at `http://localhost:5001` and `http://localhost:5010` unless later tasking documents a narrower proof seam.
- Manual proof for auth-dependent provider state on `Home` may use the repository-owned skip rule from `codeinfo_markdown/repository_information.md` when the missing state would require human-controlled two-factor authentication; skip only the affected auth-dependent surface and keep the rest of the redesign proof active.
- When screenshots are needed, capture them first in the Playwright output directory and then transfer the chosen artifacts into `codeInfoTmp/manual-testing/0000058/<task-number>/` with deterministic names such as `proof-01-desktop-chat.png`, `proof-02-mobile-home.png`, and `support-console.txt`.
- Later tasking should include desktop and mobile proof across both shell families, with special attention on transcript height, bottom composer behavior, conversation-pane interactions, Home absorbing LM Studio and provider logon concerns, the `/lmstudio` redirect path, and the rule that message `Copy` actions copy only message content while scroll-away transcript reading keeps its place during new activity.

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

- Design-reference seam
  - Treat the approved assets under `planning/layout-ideas/plan/final-designs` as the visual source of truth for the real implementation.
  - Use the matching markdown and PNG references for shell and composer intent, and use the initial SVGs under `planning/layout-ideas/plan/initial-layout` only when implementation geometry or spacing is easier to read there.
- Shared transcript visual seam
  - Rework `client/src/components/chat/SharedTranscript.tsx` and `client/src/components/chat/SharedTranscriptMessageRow.tsx` so assistant and user rows match the approved transcript-first visual language without changing the underlying transcript data model.
  - Keep this seam focused on row presentation, footer layout, `Info` affordances, and the message-level `Copy` action that extracts only visible message body content.
- Shared transcript scroll and follow seam
  - Keep the transcript behavior contract in one dedicated seam: bottom-follow only when the user was already near the bottom, preserved reading position when the user has scrolled away, and stable scroll anchors when row heights change during streaming or tool expansion.
  - Keep this seam grounded in the existing shared transcript path rather than page-local overrides so `Chat`, `Agents`, and `Flows` continue to share one behavior model.
- Shared desktop workspace-shell seam
  - Replace the top-tab layout with one reusable desktop shell that owns the app rail, the persistent conversations pane, and the main transcript/composer frame.
  - This seam should own shared desktop structure and layout rules only, not page-specific footer controls or provider/agent/flow behavior.
- Shared mobile navigation-shell seam
  - Build one reusable mobile shell that owns the right-side app menu, the left-side full-screen conversations view, and the return-to-workspace behavior after either overlay closes.
  - Keep this seam focused on mobile navigation structure and dismissal/state retention, not on the specific controls rendered by each workspace page.
- Shared conversation-pane seam
  - Rework `client/src/components/chat/ConversationList.tsx` inside the new shared shell so the list presentation matches the approved design while preserving current filter, archive/restore, and conversation-selection semantics.
  - Keep conversation-pane layout and row treatment separate from transcript rendering so later proof can isolate list behavior from transcript behavior.
- Chat page-adapter seam
  - Adapt `client/src/pages/ChatPage.tsx` into the shared shell and shared composer frame while preserving next-send-only provider/model changes, working-folder behavior, and the current conversation-resume rules.
  - Keep Chat-specific footer controls and Chat-only submission rules inside this seam rather than inside the shared shell primitives.
- Agents page-adapter seam
  - Adapt `client/src/pages/AgentsPage.tsx` into the shared shell and shared composer frame while preserving agent-to-command-to-step reset behavior, prompt discovery invalidation, and current persistence-disabled behavior.
  - Keep Agents-specific footer controls and dependent-selector clearing inside this seam rather than embedding them into the shared shell.
- Flows page-adapter seam
  - Adapt `client/src/pages/FlowsPage.tsx` into the shared shell and shared composer frame while preserving fresh-run versus resume behavior, custom-title submission rules, and current flow conversation semantics.
  - Keep Flow-specific footer controls and resume-state handling inside this seam rather than inside the shared shell.
- Utility-shell seam
  - Build a second shared layout family for non-workspace pages and apply it to `client/src/pages/HomePage.tsx`, `client/src/pages/IngestPage.tsx`, `client/src/pages/LogsPage.tsx`, and any supporting utility-page components that need shell alignment such as `client/src/components/ingest/RootDetailsDrawer.tsx`.
  - Keep this seam about shared utility-page structure and styling rather than about moving LM Studio or auth contracts.
- Home status-composition seam
  - Rework `client/src/pages/HomePage.tsx` into the real system-status surface by combining version information, passive provider readiness derived from `useChatModel`, and provider-auth entry points that still use the existing shared device-auth dialog flow.
  - Keep this seam separate from route migration so later proof can validate status composition without depending on redirect behavior.
- LM Studio control-migration seam
  - Move the existing LM Studio status and model-list controls from `client/src/pages/LmStudioPage.tsx` into the new `Home` surface by reusing `useLmStudioStatus` and the existing `localStorage['lmstudio.baseUrl']` ownership model.
  - Keep the current draft-versus-committed lifecycle intact: editing the field stays local, `Check status` and `Reset to default` commit, and `Refresh models` uses the last committed value.
  - Do not invent a new route-query contract or a second persistence key in this seam.
- Stateful transition seam
  - Keep the high-risk state transitions explicit across the migrated UI: retained-local-versus-cleared state, fresh-versus-resume behavior, active-versus-archived filtering, overlay-hidden-versus-submittable controls, and invalidated dependent selections after reload.
  - Later tasking should treat these as distinct state rules rather than as one generic “preserve existing behavior” bucket, because some surfaces must clear stale values while others must keep local drafts but exclude them from payloads and persistence.
- Route and visible-navigation seam
  - Rework `client/src/routes/router.tsx` and `client/src/components/NavBar.tsx` so the visible top-level navigation removes `LM Studio`, the workspace and utility destinations match the new shell families, and `/lmstudio` becomes a compatibility redirect to `Home`.
  - Keep this seam separate from Home composition so redirect correctness, bookmark compatibility, and nav presentation can be proven independently.
- Proof-authoring seam for transcript mechanics
  - Keep transcript proof work separate from shell work by extending the existing transcript-focused unit-test surfaces under `client/src/test/sharedTranscript*.test.tsx`.
  - Later tasking should treat scroll-follow behavior, row-growth stability, and copy-extraction behavior as separate proof invariants rather than one bundled transcript test update.
- Proof-authoring seam for routing and Home migration
  - Keep routing and status-surface proof separate from transcript proof by extending `client/src/test/router.test.tsx`, `client/src/test/lmstudio.test.tsx`, and `e2e/lmstudio.spec.ts`.
  - Later tasking should prove at least three distinct invariants here: `/lmstudio` redirect behavior, `Home` rendering the LM Studio section, and preservation of the committed LM Studio base-URL lifecycle after the migration.
- Proof-authoring seam for workspace-shell regressions
  - Keep workspace-shell proof separate from utility-page proof by extending the existing page-level unit and e2e surfaces for `Chat`, `Agents`, and `Flows`.
  - Later tasking should map desktop layout, mobile overlay behavior, and page-specific footer semantics onto separate proof updates rather than a single generic “update UI tests” step.
- Proof-authoring seam for default-path reachability
  - Keep default-path reachability separate from component-level rendering proof by checking the redesign through the normal router, the checked-in main Compose stack, and the checked-in e2e stack rather than only through direct component mounts or targeted test harness routes.
  - Later tasking should prove that the redesigned `Home`, the `/lmstudio` redirect, and the shared shell family remain reachable through the repository’s default startup paths before treating narrower unit or browser proofs as sufficient.
- Wrapper-first validation seam
  - Keep final automated validation on the repository’s existing wrapper-first path: `npm run build:summary:client`, `npm run test:summary:client`, `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, and `npm run compose:down`.
  - This seam is about running the standard proof path after implementation seams are complete, not about introducing a new harness or a new startup path.

## Feasibility Proof Pass

### 1. Shared transcript behavior and message rendering

- Already existing capabilities:
  - `client/src/components/chat/SharedTranscript.tsx`, `VirtualizedTranscript.tsx`, and `useSharedTranscriptState.ts` already centralize shared transcript rendering for `Chat`, `Agents`, and `Flows`.
  - Existing client tests in `client/src/test/sharedTranscript.scrollBehavior.test.tsx` and `client/src/test/sharedTranscript.proofContract.test.tsx` already prove scroll-mode transitions and anchor-preserving row growth.
- Missing prerequisite capabilities:
  - The redesign still needs a shared visual shell for assistant and user slices plus footer `Info` and `Copy` affordances that fit the new layouts without breaking the current transcript data path.
- Assumptions currently invalid:
  - The current transcript is not yet styled like the approved desktop and mobile document-style slices, and the current footer treatment does not yet match the approved designs.
- Feasibility and sequencing note:
  - This seam is feasible entirely in the frontend because the shared transcript abstraction and proof hooks already exist; it should be updated before page-shell work so later shells can plug into one stable transcript surface.

### 2. Workspace shell, conversations pane, and mobile overlays

- Already existing capabilities:
  - `client/src/pages/ChatPage.tsx`, `AgentsPage.tsx`, and `FlowsPage.tsx` already use MUI drawers, `ConversationList`, working-folder persistence, and conversation hydration.
  - `client/src/components/chat/ConversationList.tsx` already owns the shared conversation metadata model, active or archived filters, archive or restore actions, and bulk-selection behaviors.
- Missing prerequisite capabilities:
  - The repository does not yet have one reusable desktop app rail, one reusable desktop conversation-pane shell, one mobile conversations view, or one mobile app-menu surface shared across the workspace pages.
- Assumptions currently invalid:
  - The current top tab bar in `client/src/components/NavBar.tsx` and the page-local drawer layouts are not the approved shared shell and cannot be treated as final structure.
- Feasibility and sequencing note:
  - This seam is frontend-only and should be split into shared shell primitives first, then page adapters, so the later tasking pass can assign one ownership seam per reusable shell surface.

### 3. Home status migration and LM Studio route compatibility

- Already existing capabilities:
  - `client/src/pages/HomePage.tsx` already loads client/server version data.
  - `client/src/pages/LmStudioPage.tsx` plus `client/src/hooks/useLmStudioStatus.ts` already implement LM Studio status, base-URL persistence, and model listing.
  - `client/src/hooks/useChatModel.ts` and the existing device-auth dialog seams already expose provider availability and auth actions used by `Chat` and `Agents`.
- Missing prerequisite capabilities:
  - The repo still needs one shared `Home` status composition that combines version data, provider readiness wording, provider actions, and LM Studio controls without leaving provider auth stranded inside workspace pages.
- Assumptions currently invalid:
  - The current dedicated `/lmstudio` page and current `HomePage` placeholder cannot be treated as the final utility-page status model.
- Feasibility and sequencing note:
  - The migration is feasible without a new backend because the current frontend already has the required data sources; the main design risk is composition and conservative wording, not API coverage.

### 4. Automated proof and manual-proof path

- Already existing capabilities:
  - The repo already has wrapper-first client build and test commands in `package.json` and `AGENTS.md`.
  - The checked-in main Docker stack in `docker-compose.yml` already publishes the supported human-proof surfaces on `http://localhost:5001` and `http://localhost:5010`, and the server/container readiness contract already hangs off `/health`.
  - The checked-in e2e stack in `docker-compose.e2e.yml` already publishes the automated-proof surfaces on `http://host.docker.internal:6001` and `http://host.docker.internal:6010`.
  - Playwright coverage already exists for `chat`, `agents`, `flows`, `ingest`, `logs`, and `lmstudio` under `e2e/**`, and `playwright.config.ts` already writes screenshots to ignored artifact locations.
  - `.gitignore` already ignores `codeInfoTmp/`, `playwright-output/`, and `playwright-output-local/`.
- Missing prerequisite capabilities:
  - No new harness is required before tasking, but later tasks must add targeted proof for the redesigned `Home` surface, the `/lmstudio` redirect, desktop/mobile shell behavior, and the new message `Copy` affordance.
- Assumptions currently invalid:
  - Existing route and page tests do not yet prove the redesigned shell family or `Home` absorbing LM Studio and provider-logon concerns.
  - Existing `lmstudio`-focused proofs in `e2e/lmstudio.spec.ts`, `client/src/test/router.test.tsx`, and `client/src/test/lmstudio.test.tsx` still assume a visible `LM Studio` navigation destination and a standalone page, so they cannot be reused unchanged once the redirect-to-`Home` contract lands.
- Feasibility and sequencing note:
  - Proof can stay inside the existing client-unit, Playwright, and wrapper ecosystem; later tasking must extend those surfaces rather than planning a fresh harness.
  - Later tasking should distinguish story-owned failures from shared-baseline failures: if wrapper, Compose, or shared runtime startup fails before the redesigned UI is reachable, that is a harness or baseline blocker to isolate first rather than evidence that the redesign seam itself is wrong.

## Message Contracts And Storage Shapes

- No new backend API or persistence shape is expected for this story unless frontend implementation proves a concrete blocker. The redesign should keep using the current frontend contracts already exposed by:
  - `ChatMessage` transcript content, stream status, usage, timing, and tool metadata consumed by `SharedTranscript`.
  - conversation list rows and flags consumed by `ConversationList`, including title, provider, model, transport chip, archive state, agent or flow identity, and flow execution markers.
  - provider and model availability data returned through `useChatModel`.
  - LM Studio status and model-list data returned through `useLmStudioStatus`.
- `Home` should treat provider readiness as the `GET /chat/providers` contract, not as a custom status model. The shared provider rows are `ChatProviderInfo` objects with `id`, `label`, `available`, `toolsAvailable`, optional `reason`, optional `defaultModel`, optional `warnings`, optional `agentFlags`, and optional `compatibility`. Passive `Home` status should be derived from those existing fields only.
- Provider-auth actions on `Home` should keep using the existing device-auth contract instead of inventing a new readiness shape. The current shared response states are `verification_ready`, `completion_pending`, `completed`, `already_authenticated`, `failed`, and `unavailable_before_start`, with optional `detectedAuthState` values of `already_authenticated` or `unauthenticated`. Those detailed states belong to the auth dialog flow; the passive `Home` surface should stay conservative and avoid inventing stronger login claims than the current provider contracts prove.
- LM Studio status should keep using the existing `LmStudioStatusResponse` union:
  - success: `{ status: 'ok', baseUrl, models }`, where each model row exposes `modelKey`, `displayName`, `type`, and optional metadata such as `format`, `path`, `sizeBytes`, `architecture`, `paramsString`, `maxContextLength`, `vision`, and `trainedForToolUse`;
  - failure transport body: `{ status: 'error', baseUrl, error }`.
- The server-side LM Studio route accepts only `http://`, `https://`, `ws://`, or `wss://` base URLs. A blank or missing `baseUrl` query falls back to `CODEINFO_LMSTUDIO_BASE_URL`; a whitespace-only or otherwise malformed explicit value is treated as invalid and returns the existing error contract instead of silently normalizing.
- The current frontend LM Studio source order is already fixed by repo code and should stay the same during the redesign: `localStorage['lmstudio.baseUrl']` first, then runtime/env `VITE_CODEINFO_LMSTUDIO_URL`, then the default `http://host.docker.internal:1234`. The current `LmStudioPage` does not read route query params, so the `/lmstudio` compatibility redirect should keep using stored/runtime base-URL sources rather than inventing a new `?baseUrl=` navigation contract.
- No new persisted artifact should be introduced for this migration. The redesign should keep using the existing `localStorage['lmstudio.baseUrl']` key, and it should not add a storage migration, cleanup pass, or duplicate status cache unless a concrete frontend blocker is discovered.
- The current persisted LM Studio value has one writer/reader model and should keep that ownership during the redesign:
  - writer: the shared LM Studio status hook commits the single `localStorage['lmstudio.baseUrl']` string when the user chooses `Check status`, `Reset to default`, or another explicit committed refresh path;
  - readers: the same hook and any page that reuses it, including the migrated `Home` surface;
  - write shape: one browser-local string key replaced in place rather than a multi-record cache or a multi-step persisted transaction;
  - partial-state handling: there is no multi-record partial write to reconcile, so later tasking should preserve the single-key ownership model instead of introducing a second cache layer;
  - cleanup owner: the user clears stale values by resetting to default or committing a replacement value, and the redesign should not add a background cleanup routine for this key.
- The current frontend helper path throws on non-2xx LM Studio responses, so structured server errors are available on the thrown response body but the existing hook currently surfaces only the generic HTTP-status message. If the redesigned `Home` needs richer LM Studio failure text, that should be solved in the frontend hook/helper layer without changing the server contract.
- `Home` should report provider state using the current observable frontend contract only. If the repo only proves availability, missing auth, or unknown state, the redesign must use conservative wording such as `Available`, `Authentication required`, `Unavailable`, or `Unknown` rather than inventing stronger login claims.
- Transcript `Copy` actions must extract only the visible message body content. They must not include footer metadata, timing, provider/model labels, execution diagnostics, hidden tool payloads, or `Info` popup content.
- `Flows` custom-title behavior stays contract-compatible with the existing run payload:
  - custom titles are included only for fresh runs;
  - resume payloads omit custom titles;
  - resume step-path behavior remains the server-facing source of truth for resumed runs.

## Log Or Proof Markers

- Shared transcript scroll-preservation proof should keep using the current observable proof markers from the Story 49 transcript work unless an equivalent marker is introduced deliberately:
  - `DEV-0000049:T08:shared_transcript_scroll_mode_changed`
  - `DEV-0000049:T10:virtualized_row_growth_settled`
- Router compatibility proof for this story should include a browser-visible check that direct navigation to `/lmstudio` lands on `Home` and renders the LM Studio section rather than a standalone LM Studio page.
- Later tasking should map the major proof paths onto the existing proof homes instead of inventing new file locations:
  - transcript anchor and virtualization behavior: `client/src/test/sharedTranscript.scrollBehavior.test.tsx` and `client/src/test/sharedTranscript.proofContract.test.tsx`;
  - router and utility-page migration: `client/src/test/router.test.tsx`, `client/src/test/lmstudio.test.tsx`, and `e2e/lmstudio.spec.ts`;
  - workspace-page shell regressions: `client/src/test/chatPage.layoutHeight.test.tsx`, `client/src/test/chatPage.layoutWrap.test.tsx`, `client/src/test/agentsPage.layoutWrap.test.tsx`, and the existing `flowsPage` unit-test surface under `client/src/test/flowsPage*.test.tsx`;
  - browser-visible end-to-end workspace behavior: `e2e/chat.spec.ts`, `e2e/agents.spec.ts`, `e2e/flows-execution-runs.spec.ts`, `e2e/ingest.spec.ts`, and `e2e/logs.spec.ts`.
- Later tasking should keep the likely ordering-sensitive proofs explicit rather than implicit:
  - prove that direct `/lmstudio` navigation redirects before the `Home` LM Studio section assertion is evaluated;
  - prove that a dirty LM Studio draft field does not change the committed refresh target until the user chooses a committing action;
  - prove negative assertions such as “no standalone LM Studio page remains” through stable route/UI boundaries rather than arbitrary delays.
- Later tasking should keep the stale-state and mixed-state proofs explicit rather than bundling them into one UI regression step:
  - prove which surfaces clear stale state immediately, such as invalid dependent `Agents` command/step selections;
  - prove which surfaces retain local draft state but exclude it from submission, such as LM Studio draft base URLs and `Flows` custom titles while the UI is in resume mode;
  - prove that hidden or collapsed navigation surfaces preserve user context without causing hidden values to leak into unrelated submissions.
- Desktop and mobile manual-proof artifacts should continue to use the story-level scratch location and deterministic naming described in `### Story Manual Testing Guidance`, with later tasking mapping exact shell-family screenshots to specific proof steps.

## Edge Cases And Failure Modes

- When a user is reading older transcript content, new assistant output, tool expansion, or dynamic row growth above the viewport must preserve the visible scroll anchor instead of snapping to the bottom. When the user is already near the bottom, the transcript should continue following the newest content automatically.
- The redesigned workspace shell must preserve existing page-specific control semantics:
  - `Chat` provider/model changes create a fresh next-send context and must not mutate a locked resumed conversation.
  - `Agents` agent changes clear dependent command selection and reset the step selector to `1`; command changes also reset the step selector to `1`.
  - `Flows` custom titles remain new-run-only, and resume selections continue to disable title submission.
- Mixed-mode state must not survive only because the control moved or became hidden:
  - if the UI is in a resume path, stale fresh-run-only values such as `Flows` custom titles must be excluded from payloads;
  - if a parent selection invalidates a dependent one, the dependent state must be cleared rather than merely hidden;
  - if a control is read-only for the active mode, any alternate draft state may remain local only when the current contract already treats it as next-send-only or otherwise non-persistent.
- Overlay navigation must not create hidden stale state:
  - desktop conversation-pane collapse must not clear the selected conversation or current `Active`/`Archived` filter state;
  - mobile conversations and app-menu layers must dismiss back to the active workspace without dropping the current draft, working-folder selection, or selected conversation.
- If a provider, model, agent, command, or flow option becomes invalid after data reload, the redesigned footer must clear only the invalid dependent selection and must never submit stale hidden values.
- `Home` provider wording must stay conservative when the current frontend contract does not prove an exact login truth. The repository-owned manual-testing skip rule for provider auth that requires human-controlled 2FA still applies only to the affected auth-dependent proof surface.
- LM Studio input handling must preserve the current value-domain behavior unless the story deliberately improves it in the frontend:
  - empty-string reset behavior falls back to the runtime/server default LM Studio base URL;
  - whitespace-only explicit input is currently treated as invalid rather than as a silent reset;
  - malformed explicit values must remain failures, not hidden clamps.
- Moving LM Studio controls into `Home` must not change the current control lifecycle:
  - editing the field alone must not trigger a fetch or overwrite the committed `localStorage['lmstudio.baseUrl']` value;
  - `Check status` and `Reset to default` may commit a new value;
  - `Refresh models` must keep using the last committed value even if the draft field is dirty.
- If a previously committed LM Studio base URL is stale or invalid, the redesign must keep the ownership boundary explicit:
  - the stored key remains the committed source until the user resets or overwrites it;
  - the UI should surface the existing failure contract instead of silently switching to a different source;
  - later tasking should not invent background cleanup or automatic stale-value deletion for this browser-local key.
- The `/lmstudio` compatibility route must avoid redirect loops and must stay correct for direct navigation, refresh, and bookmarked entry, even after the visible nav destination is removed.

## Questions

- No Further Questions
