# Future Ideas

- Rework Chat model-selection/runtime-config handling so switching to `gpt*` models does not inherit an incompatible `model_provider` from `codex/chat/config.toml`. The current Chat path appears to preserve `model_provider = "lmstudiospark"` even when the selected model is a Codex/OpenAI model, which can route requests through the wrong provider and cause provider errors.
- Investigate introducing a parallel wrapper-validation orchestrator so recent plan test runs do not spend so long executing the same summary wrappers serially.
  - Goal:
    - Reduce wall-clock time for the standard validation flow by splitting work into four explicit phases:
      1. Builds
      2. Automated tests
      3. Playwright tests
      4. Manual tests
  - Repository evidence so far:
    - Recent plans such as `planning/0000048-working-repo-first-reference-resolution-for-flows-and-commands.md` repeatedly reuse the same wrapper-first validation commands: `npm run build:summary:server`, `npm run build:summary:client`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, `npm run test:summary:e2e`, `npm run compose:build:summary`, `npm run compose:up`, and `npm run compose:down`.
    - The wrappers already expose a shared heartbeat/final-status protocol, so an orchestrator could launch multiple wrappers, wait for all of them, and then inspect only the failed outputs.
    - Run-specific artifacts are partially implemented already. The server and client test wrappers write timestamped files under `test-results/`, but several other wrappers still use fixed shared `*-latest.log` paths under `logs/test-summaries/`.
    - The current Playwright suite is configured with `workers: 1`, so there may also be speed available inside the Playwright phase if test isolation is good enough to increase workers safely.
  - Current blockers and risks:
    - Several wrappers are not parallel-safe today because they write to fixed shared `*-latest.log` files such as `logs/test-summaries/build-server-latest.log`, `build-client-latest.log`, `compose-build-latest.log`, and `e2e-tests-latest.log`.
    - `scripts/test-summary-server-unit.mjs` and `scripts/test-summary-server-cucumber.mjs` both run `npm run build --workspace server` first, so parallel execution would duplicate and potentially race over the same `server/dist` build output.
    - The current server test scripts do not appear to rebuild because of different build-time environment injection. The build step is `tsc -b`, while the differing environment variables are applied to the test runtime. That suggests a shared build prerequisite could be viable, but it still needs to be proven safely before refactoring.
    - Compose-backed validation should currently be treated as exclusive because `test:summary:e2e` performs compose build/up/test/down inside one wrapper, and the regular compose wrappers share Docker state, images, ports, networks, and teardown behavior.
    - Manual Playwright-MCP checks depend on shared runtime surfaces such as `host.docker.internal:5001`, so they should not be overlapped with other compose-backed runs unless those surfaces are isolated first.
    - Even when port clashes are avoided, heavy parallel Docker, Testcontainers, and Playwright work may still fight over CPU, memory, and disk I/O on smaller machines, so gains will depend on hardware.
  - Candidate implementation direction:
    - Add a higher-level orchestration wrapper that understands the four phases and launches only the safe parts of each phase in parallel.
    - Make wrapper artifact paths run-specific instead of relying on fixed `*-latest.log` files so concurrent runs cannot overwrite one another.
    - Refactor the server test wrappers so they can assume a prior successful server build, instead of each rebuilding the server independently.
    - Keep compose/e2e/manual checks serial at first, and only parallelize non-compose wrappers until Docker isolation is explicitly designed.
    - Investigate increasing Playwright workers above `1` once the suite is confirmed to be stable under parallel execution.
    - If needed later, consider explicit port or stack isolation between Playwright/e2e and manual-check phases, but do not make that the starting point.
  - Suggested future phase model:
    - Builds:
      - Run `npm run build:summary:server` and `npm run build:summary:client` in parallel.
    - Automated tests:
      - After the build phase passes, run `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run test:summary:client`, and `npm run test:summary:shell` in parallel, but only after the wrapper refactor removes duplicate server builds.
    - Playwright tests:
      - Run `npm run test:summary:e2e` after automated tests, and treat it as its own exclusive phase at first.
    - Manual tests:
      - Run `npm run compose:build:summary`, `npm run compose:up`, the manual Playwright-MCP checks, and `npm run compose:down` as the final serial phase.
  - Safe starting point if this is pursued incrementally:
    - First fix artifact-path isolation for wrappers that still write to shared `*-latest.log` files.
    - Then refactor the server test wrappers to reuse a prior build instead of rebuilding.
    - Then introduce parallel execution for the build phase and, separately, for the automated-test phase.
    - Leave Playwright/e2e/manual validation serial until the earlier improvements are proven stable.
  - Expected payoff:
    - Conservative gain: reduce overall wall-clock time by overlapping client and server work without changing compose-backed phases.
    - Stronger gain: remove redundant server builds and parallelize the full automated-test phase once wrapper refactoring is complete.
    - Additional gain may be available from Playwright worker increases, but only if stability remains acceptable.
