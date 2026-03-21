# Title
Users can run portable repository refresh workflows and use a more reliable host-networked testing stack

# Acceptance
1. Workflow users can refresh a repository without hard-coding a machine-specific path, including by using a repository selector, the current repository, or all ingested repositories.
2. Workflow users can run refresh steps that behave consistently across developer machines, containers, and environments.
3. Users can see clearer refresh outcomes in conversation history, including one combined result for all-repository refresh runs.
4. Users are protected from blank markdown instruction files causing confusing empty agent executions, because those steps are skipped with a clear recorded reason.
5. Support and developer users can run the checked-in server and Playwright MCP stack on the intended host-visible ports with clearer runtime checks and proof steps.

# Description
This story makes repository refresh workflows easier to reuse and more dependable. Instead of relying on absolute paths that only work on one machine, workflows will be able to target repositories in portable ways, including refreshing the repository that owns the running workflow or refreshing every ingested repository in a stable order. It also improves the runtime and testing stack so the checked-in server and Playwright MCP services use the intended host-network model, making manual validation and support troubleshooting more reliable.

# Tasks
1. [codeInfo2] - Extend re-ingest schema parsing for command and flow files
   - Update the server re-ingest schemas so workflow JSON can accept `sourceId`, `target: "current"`, and `target: "all"`.
   - Edit the command and flow schema files in `server/src/agents/` and `server/src/flows/`.
2. [codeInfo2] - Extend the strict single-repository re-ingest result contract
   - Update the server result contract so single-repository refresh outcomes stay strict and normalize to the story’s user-facing states.
   - Edit the re-ingest service and its unit tests in `server/src/agents/` and `server/src/test/unit/`.
3. [codeInfo2] - Add shared target orchestration for sourceId, current, and all
   - Reuse the existing repository selector helpers so the server can resolve portable targets before re-ingesting.
   - Update the command and flow execution paths in `server/src/agents/` and `server/src/flows/`.
4. [codeInfo2] - Emit and persist the new single and batch re-ingest transcript payloads
   - Add the new transcript payload shape for one-repository and all-repository refresh results.
   - Update transcript persistence and response-building files in `server/src/chat/`, `server/src/agents/`, and `server/src/mongo/`.
5. [codeInfo2] - Skip blank markdown instructions without weakening real markdown failures
   - Change the markdown-loading flow so whitespace-only markdown files are skipped with a clear info log.
   - Update the shared markdown execution paths and tests in `server/src/agents/`, `server/src/flows/`, and `server/src/test/`.
6. [codeInfo2] - Finalize runtime MCP placeholder normalization
   - Centralize how MCP endpoint placeholders are resolved so chat, agents, and status checks use the same runtime contract.
   - Edit the shared runtime config files in `server/src/config/` and related tests in `server/src/test/`.
7. [codeInfo2] - Migrate checked-in MCP config and env contracts
   - Update the checked-in config and env files to use the final MCP placeholder and port variable names.
   - Edit the checked-in config files under `server/` and the supporting server tests.
8. [codeInfo2] - Add a repo-local shell harness
   - Add the shared shell test wrapper that later host-network proof tasks can reuse.
   - Create or update the shell harness files under `scripts/` and `scripts/test/bats/`.
9. [codeInfo2] - Add host-network wrapper preflight
   - Extend the compose wrapper so it fails early when host-network requirements or ports are invalid.
   - Update the compose wrapper and shell-harness fixtures in `scripts/` and `scripts/test/bats/`.
10. [codeInfo2] - Bake runtime assets into the image-based host-network model
   - Move the needed runtime assets into the checked-in images so host-network containers do not depend on forbidden bind mounts.
   - Update the Dockerfiles and related build files at the repository root and under `server/`.
11. [codeInfo2] - Convert Compose definitions to the final host-network runtime model
   - Update the checked-in compose files so the server and existing `playwright-mcp` services use host networking and the required ports.
   - Edit `docker-compose.yml`, `docker-compose.local.yml`, and `docker-compose.e2e.yml`.
12. [codeInfo2] - Add the main-stack host-network proof wrapper
   - Create the reusable proof wrapper that confirms the main stack is reachable and correctly wired on host networking.
   - Update the summary wrapper script files in `scripts/` and the root `package.json` commands.
13. [codeInfo2] - Align the e2e proof path with host-network addresses
   - Update the checked-in e2e path so automated proof uses the final host-network addresses and contracts.
   - Edit the e2e wrapper, env, and supporting proof files at the repository root, under `e2e/`, and under `server/`.
14. [codeInfo2] - Run final validation for Story 0000050
   - Perform the full story proof using the checked-in wrappers, compose stack, runtime logs, and manual Playwright MCP checks.
   - Use the final validation assets, logs, and screenshots stored under `logs/`, `test-results/`, and `playwright-output-local/`.
15. [codeInfo2] - Update documentation and story close-out
   - Update the shared documentation so developers and support users can understand the new workflow targets, runtime setup, and proof commands.
   - Edit `README.md`, `design.md`, `projectStructure.md`, `docs/developer-reference.md`, and the final review summary content.
