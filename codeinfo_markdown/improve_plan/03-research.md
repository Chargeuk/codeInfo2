# Goal

Gather the minimum evidence needed to improve the active plan thoroughly and safely.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/improve_plan/01-shared-contract.md"`.
- Do not create tasks.
- Keep the plan aligned to the KISS principle.
- Prefer upstream or shared fixes over downstream duplication when repository evidence supports that direction.
  </instruction_priority>

<source_priority>

- Use `code_info` first for repository facts, likely file locations, existing implementations, current contracts, reusable patterns, and how we or our company already solve similar problems across ingested repositories. Include the full repository path when asking about this repository.
- Inspect relevant local source files directly after `code_info`.
- If `repository_information.md` was found during preflight, use it as supporting product and repository context throughout this pass.
- Use DeepWiki for external GitHub repository architecture or documentation when relevant.
- Use Context7 for library, SDK, or framework documentation when relevant.
- Use web search only when repository evidence plus official docs do not settle an external-library, runtime, or deployment question.
  </source_priority>

<dependency_checks>

- Re-read the active plan from disk before researching so you are working from the current text.
- Determine whether the story is single-repository or multi-repository before applying cross-repository structure.
- If the story is single-repository, keep the normal single-repository style.
- If the story is multi-repository, gather evidence for provider and consumer responsibilities, dependency direction, sequencing, compatibility expectations, and repository ownership.
  </dependency_checks>

<design_contract_checks>

- If `Design Contract Present` is true:
  - identify the exact design assets that are implementation targets;
  - identify any paired design markdown plus visual design assets such as `*.png` or `*.svg` that govern the same surface;
  - extract the mandatory layout, hierarchy, spacing, metadata-placement, typography, and interaction-pattern invariants they imply when those qualities are visibly material to the design;
  - extract exact requirements from the paired design markdown first, then use the paired visual asset as supporting visual reference for overall shape, hierarchy, and feel;
  - if paired design markdown and visual design asset conflict, treat the markdown as canonical and record that the markdown overrides the visual asset for the plan contract;
  - identify which of those requirements later task-up must restate explicitly in task subtasks, visual invariants, or task exit criteria so downstream implementation and review do not have to guess from the design files alone;
  - distinguish mandatory match requirements from acceptable implementation flex;
  - identify which page, shell, surface, or component each design asset governs;
  - identify which design-relevant files must be referenced later by the visual implementation tasks for those governed surfaces;
  - check whether the plan still leaves visual success criteria implied rather than explicit.

</design_contract_checks>

<research_checklist>

- Check whether the Description, Acceptance Criteria, and Out Of Scope sections are specific enough for a junior developer.
- Check whether any expected capability does not yet exist in the relevant codebases.
- Check for missing runtime seams, startup commands, HTTP listeners, readiness or health endpoints, environment-variable injection paths, deployment mappings, and Docker Compose prerequisites.
- Inspect every planned Docker, Dockerfile, and Docker Compose build/runtime path.
- Prefer code copied into Docker images over host-source bind mounts inside containers.
- Check whether the plan needs explicit Docker build-context ignore updates, explicit port choices, or Docker-managed volumes for generated artifacts.
- Check whether a new frontend or backend is actually required.
- If a backend is required or changed, ensure the plan expects unit tests and Cucumber integration tests that use Testcontainers as the primary integration-test path. If those harnesses are missing for the system being changed, add the prerequisite work early in the story before relying on them for new functionality.
- If a frontend is required or changed, ensure the plan expects frontend unit tests plus Playwright end-to-end tests with screenshot evidence where the UI can be checked visually.
- If a backend is paired with a frontend, ensure the paired system includes the required Playwright end-to-end tests. If those harnesses are missing for the system being changed, add the prerequisite work early in the story before relying on them for new functionality.
- Check whether automated tests will need test-only seams such as seeded identities, mocked auth providers, fixture logins, harness-only configuration, or dependency injection, and prefer those seams over changing shipped production behavior purely for testability.
- Check whether any planned auth bypass, alternate login path, or provider stub can live entirely in test code, test configuration, or harness wiring rather than in the production code path.
- Check whether manual testing can use the unmodified human Docker stack as the default runtime path, especially when repository evidence already documents supported credentials or access sources for that stack.
- Check whether any required credentials, seeded accounts, or access sources are documented in repository files, README guidance, environment conventions, helper scripts, or fixtures, and record only where they are found rather than copying values into the plan.
- If `Design Contract Present` is true, check whether the plan already names the design assets, mandatory visual invariants, and later screenshot-comparison proof expectations; if not, add them now instead of leaving design fidelity implicit for tasking.
- If `Design Contract Present` is true, check whether the plan makes paired design markdown precedence explicit wherever paired markdown and visual design assets such as `*.png` or `*.svg` both exist for the same surface.
- If `Design Contract Present` is true, check whether the plan makes it clear that later explicit task wording can intentionally override paired design markdown for a bounded surface, while vague task wording cannot.
- If `Design Contract Present` is true, check whether the plan expects the final story validation path to capture screenshots for every implemented frontend surface across the whole story so later review can compare them against the named design assets.
- Check whether new message contracts or storage shapes are required.
- Check whether new or changed env/config inputs have an explicit valid domain, including empty-string behavior, whitespace behavior, lower bounds, upper bounds, and whether invalid values must clamp, fallback, or fail.
- Check whether any planned query, delete filter, or bulk selector scales with repository size, file count, chunk count, or symbol count, and whether a bounded strategy is required because the story targets large files, large repositories, ingest scale, or indexing scale.
- Check whether planned test types need new harnesses because the current repositories do not already support them.
- Check whether planned proof steps will be runnable at the point they are reached.
- Check for edge cases, failure modes, contradictions, and assumptions that are currently invalid.
- Check for scale-shape risks where a logically correct query or payload could still become too large or too expensive when the story’s target dataset grows.
  </research_checklist>

<classification_contract>

- For each major implementation area, classify findings internally as:
  - existing capability;
  - missing prerequisite capability;
  - invalid assumption;
  - not applicable.
- Do not dump raw notes into the plan unless they materially improve the plan.
  </classification_contract>

<verification_loop>

- Treat this pass as incomplete until every relevant planning area above is either supported by evidence and ready to write into the plan, or explicitly marked not applicable.
- If a lookup returns empty, partial, or suspiciously narrow results, retry with at least one better-targeted fallback before concluding there is no evidence.
- Before moving on, check whether any broad implementation area still hides an unstated prerequisite, runtime seam, or proof gap that later passes must make explicit.
- If `Design Contract Present` is true, check whether every named design asset now has an explicit planning purpose and whether the plan states what later proof must compare against it.
- If `Design Contract Present` is true and paired design markdown plus visual design assets such as `*.png` or `*.svg` exist, check whether the plan treats the markdown as canonical and the visual asset as supporting reference rather than allowing visual-asset-only interpretation to override explicit markdown requirements.
- If `Design Contract Present` is true, check whether the plan leaves enough explicit design detail that later task-up can turn it into concrete task-level requirements instead of forcing manual testing or review to infer intent directly from design assets.
- If `Design Contract Present` is true, check whether the plan makes it clear that missing screenshots alone are not a review finding, because the manual-testing pass owns the attempt to capture them first.
  </verification_loop>

<output_contract>

- Make plan edits only when supported by evidence.
- Keep summaries concise and evidence-backed.
- Do not create tasks in this pass.
  </output_contract>
