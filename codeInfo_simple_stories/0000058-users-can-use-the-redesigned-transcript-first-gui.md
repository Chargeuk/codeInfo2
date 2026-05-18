# Users can use the redesigned transcript-first GUI

# Acceptance

1. Users can work in `Chat`, `Agents`, and `Flows` through one shared desktop workspace shell and one shared mobile behavior model instead of three noticeably different page layouts.
2. Users can rely on a bottom-anchored composer and a larger transcript area, with new activity staying pinned to the bottom only when they were already near the bottom.
3. Users can scroll up to read older transcript content without being snapped back to the newest message when new activity arrives.
4. Users can use message `Copy` actions that copy only visible message content and do not include timing, provider, status, or diagnostic footer metadata.
5. Users can keep the current `Chat`, `Agents`, and `Flows` behavior they already know, including resumed-conversation rules, selector resets, and fresh-run versus resume distinctions.
6. Users can use `Home` as the single system-status destination for provider state, auth entry points, and LM Studio controls.
7. Users can still open old `/lmstudio` bookmarks and land in `Home` with the LM Studio section visible, even though `LM Studio` is no longer a separate visible navigation destination.
8. Users can use `Ingest` and `Logs` through the new utility-page layout without changing the existing ingest or logging behavior.
9. Support and engineering reviewers can trust the rollout because the story closes with wrapper-first client, browser, and compose-backed validation plus a final reviewer summary.

# Description

This story reshapes the CodeInfo2 frontend around a transcript-first workspace so the main conversation surfaces feel like one coherent product family instead of separate admin-style pages. It gives users more room to read and work in long conversations, keeps the right stateful behavior for chat, agents, and flows, moves global runtime setup into `Home`, and keeps older LM Studio links working through a compatibility redirect. The result is a cleaner frontend that is easier to use on both desktop and mobile without changing the supported backend product behavior.

# Tasks

1. [codeInfo2] - Restyle shared transcript rows and isolate copy payloads

- Update the shared transcript row and metadata components so all workspace pages reuse one transcript presentation.
- Add the visible-text copy helper and proof so clipboard output excludes footer metadata and keeps scroll behavior honest.

2. [codeInfo2] - Build the shared workspace shell and conversation pane chrome

- Create the reusable desktop and mobile workspace shell components, including the app rail and conversation-pane wrappers.
- Prove shell structure, transcript-height reclaim, and state retention before page adapters start using the new shell.

3. [codeInfo2] - Adapt Chat to the shared workspace shell and bottom composer

- Move `ChatPage` onto the shared shell and bottom composer without forking the transcript path.
- Preserve resumed identity, next-send-only provider and model changes, and working-folder ownership through targeted unit and browser proof.

4. [codeInfo2] - Adapt Agents to the shared workspace shell while preserving selector resets

- Move `AgentsPage` and `AgentsComposerPanel` into the shared shell and bottom-composer pattern.
- Keep agent, command, and step reset rules plus stale prompt-discovery rejection explicit in the proof plan.

5. [codeInfo2] - Adapt Flows to the shared workspace shell while preserving resume semantics

- Move `FlowsPage` into the shared shell and bottom composer while keeping fresh-run and resume behavior separate.
- Prove that custom-title drafts can stay local but never leak into resume payloads.

6. [codeInfo2] - Build the utility status shell and move LM Studio into Home

- Create the shared utility-page shell and migrate provider status, auth entry points, and LM Studio controls into `Home`.
- Preserve the committed-versus-draft LM Studio base-URL lifecycle and keep `LmStudioPage` as a thin compatibility surface until route work lands.

7. [codeInfo2] - Apply the utility shell to Ingest and Logs

- Move `Ingest` and `Logs` into the shared utility-page layout without changing ingest or logging semantics.
- Keep the existing visible alerts, filters, model-lock, active-run, and log-list surfaces intact through layout and hook-level proof.

8. [codeInfo2] - Replace top tabs with the shared navigation model and `/lmstudio` compatibility redirect

- Remove the old top-tab navigation and switch the visible route chrome to the shared app-navigation model.
- Redirect `/lmstudio` into `Home` and prove direct navigation, refresh, and bookmarks still reach the LM Studio section.

9. [codeInfo2] - Run final Story 58 validation and close out the redesign

- Re-run the full wrapper-first build, client, browser, and main-stack validation path for the complete redesign.
- Refresh the reviewer-facing PR summary and final traceability notes so the story closes with honest proof ownership.
