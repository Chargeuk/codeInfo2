# Title

Users can choose GitHub Copilot as a chat provider

# Acceptance

1. Chat users can choose GitHub Copilot alongside Codex and LM Studio on the existing chat page.
2. Chat users can see when GitHub Copilot is unavailable and why, instead of the option disappearing.
3. Chat users can load Copilot models and send chat messages through Copilot from the current product UI.
4. Chat users can authenticate GitHub Copilot from the shared authentication dialog without changing the existing Codex flow.
5. Chat users continue to see current Codex and LM Studio behaviour without regression, including existing provider-specific controls where they still apply.
6. Support and engineering users can verify the new Copilot path through automated tests, Docker-backed flows, logs, and manual browser checks.

# Description

This story adds GitHub Copilot as a new chat provider in the existing product. When complete, users will be able to pick Copilot in the same chat experience they already use for Codex and LM Studio, authenticate it when needed, and continue conversations through the normal transcript and history flow. This is useful because it expands the available AI options without changing the separate agent and flow features, so the team can add value in chat first and keep the wider platform stable.

# Tasks

1. [codeInfo2] - Extend the shared chat contracts to include Copilot.
- Update shared provider types and defaults in `common` and server request contracts.
- Keep provider order consistent as `codex`, `copilot`, then `lmstudio`.

2. [codeInfo2] - Add one reusable Copilot runtime setup path.
- Create the shared server seam that starts Copilot sessions and reads Copilot runtime config.
- Keep the implementation aligned with the existing Codex runtime pattern where possible.

3. [codeInfo2] - Add a fake Copilot SDK harness for server-side proof.
- Add a controllable fake SDK path for unit and integration testing.
- Reuse the repository’s existing mock and test-support style for server harnesses.

4. [codeInfo2] - Add a fake Copilot device-auth harness for server-side proof.
- Add a controllable fake auth flow for login-related testing.
- Keep the fake auth path separate from the main SDK fake so failures are easier to test.

5. [codeInfo2] - Expose Copilot readiness in the chat provider APIs.
- Update server provider readiness logic and provider-list responses.
- Return stable availability reasons so the client can show a clear message.

6. [codeInfo2] - Expose Copilot model listing through the current chat API.
- Map Copilot model data into the existing `/chat/models` response shape.
- Preserve useful reasoning metadata only where the runtime really provides it.

7. [codeInfo2] - Add Copilot chat execution, streaming, and persistence.
- Extend the existing chat route and event bridge to run Copilot turns.
- Persist Copilot conversations and reuse conversation identity across turns.

8. [codeInfo2] - Generalise the shared authentication contract.
- Update shared auth messages so the client and server can talk about more than one provider.
- Keep existing Codex auth behaviour working while the contract becomes provider-aware.

9. [codeInfo2] - Add the Copilot device-auth backend route.
- Add the server route that starts Copilot device login and returns verification details early.
- Persist Copilot auth state under the repository’s Copilot home path.

10. [codeInfo2] - Extend the client auth test fixtures for shared-provider auth.
- Update client-side mocks and fixtures so they can represent Codex and Copilot auth states.
- Keep the fixtures reusable for dialog, page, and regression tests.

11. [codeInfo2] - Update chat provider and model selection for three providers.
- Update `client/src/pages/ChatPage.tsx` and `client/src/hooks/useChatModel.ts`.
- Keep Copilot visible when unavailable and keep Codex-only controls out of Copilot requests.

12. [codeInfo2] - Replace the Codex-only dialog with a shared authentication dialog.
- Update the existing dialog component to show `Codex Auth` and `Copilot Auth`.
- Reuse the current MUI dialog structure and keep existing agents-page Codex usage stable.

13. [codeInfo2] - Make transcript metadata safe for partial Copilot values.
- Update transcript formatting so missing timing or token values are omitted cleanly.
- Avoid changing the current Codex and LM Studio transcript presentation.

14. [codeInfo2] - Add Copilot runtime environment configuration.
- Wire `CODEINFO_COPILOT_HOME` and optional Copilot CLI path settings into startup config.
- Keep `/health` as a process-only check instead of a provider-readiness check.

15. [codeInfo2] - Add Copilot Docker delivery and persistent runtime storage.
- Update Docker and compose configuration so Copilot runtime files work in containers.
- Persist Copilot auth and config data using the planned container path and volume pattern.

16. [codeInfo2] - Extend higher-level boot paths for fake Copilot scenarios.
- Update integration, Cucumber, and e2e startup paths to select named fake Copilot scenarios.
- Keep browser and server proof paths mock-backed instead of depending on live Copilot access.

17. [codeInfo2] - Add Cucumber proof for the Copilot chat story.
- Extend server feature coverage for provider readiness, auth, and chat behaviour.
- Use the fake Copilot scenarios to cover happy-path and failure-path behaviour.

18. [codeInfo2] - Add Playwright proof for the Copilot chat story.
- Extend browser coverage for provider selection, auth dialog, and chat usage.
- Keep screenshots and manual browser checks aligned with the visible UI changes.

19. [codeInfo2] - Run final validation and close out the story.
- Re-check acceptance, scope boundaries, docs, and repository structure after implementation.
- Run the wrapper-based proof path and capture final manual browser evidence for the story.
