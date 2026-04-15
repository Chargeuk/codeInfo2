# Goal

Confirm the tasking against existing repository patterns and external contract evidence before generating granular tasks.

<instruction_priority>

- Do not create or rewrite tasks until this pass has resolved the relevant unknowns.
- Prefer existing repository and company patterns first, then official library or external-system guidance second.
- Do not allow research-shaped subtasks to leak into the final task list.
  </instruction_priority>

<source_priority>

- Use `code_info` first for repository facts, established local patterns, reusable helpers, contract seams, likely file locations, and how our repositories already solve the same class of problem.
- Inspect relevant local source files directly after `code_info`.
- If `repository_information.md` was found during preflight, use it as supporting product and repository context.
- Use Context7 for library, SDK, and framework documentation when relevant.
- Use DeepWiki for external GitHub repository architecture or usage guidance when relevant.
- Use official docs and targeted web research when local patterns plus official library docs still leave a runtime or contract ambiguity.
  </source_priority>

<research_and_pattern_rules>

- Re-read the active plan from disk before researching so you are checking the current text rather than memory.
- For each planned implementation seam, identify the strongest matching existing internal pattern and note whether it is reusable, partially reusable, or missing.
- For each planned external contract surface, confirm the message structure, env/config names, lifecycle expectations, and failure behavior from evidence.
- For each planned env/config input, confirm the valid domain, blank/whitespace behavior, lower bounds, upper bounds, and whether invalid values must clamp, fallback, or fail before task generation begins.
- For each planned query/filter/bulk selector that could grow with repository, file, chunk, or symbol count, confirm the intended bounding strategy now instead of leaving it to a later implementation subtask.
- For each planned persisted artifact, cleanup path, selector, launcher, wrapper, or startup seam, identify any controlling unchanged file that later implementation and proof will need to inspect honestly.
- For each planned reader and writer pair over the same artifact, confirm how partial or in-progress state is tolerated, how stale state is distinguished from live state, and who owns cleanup.
- For each planned lifecycle-sensitive seam, confirm the relevant cancel, retry, failure, teardown, or crash-recovery expectations from repository evidence now.
- If the contract is still ambiguous after repository and official-doc review, create or run the smallest safe proving example needed to settle the uncertainty now.
- For each proof surface, distinguish between:
  - automated proof that should later appear in `Testing`; and
  - optional manual or browser validation that should later appear only in `Manual Testing Guidance`.
- When the story is likely to end in runnable or browser-visible manual proof, gather repository evidence for:
  - prerequisite services or helpers;
  - startup order;
  - login, seed, or setup path;
  - where credentials or access come from without exposing secrets.
- Use that evidence later when writing the final task's `Manual Testing Guidance`.
- Do not let research conclusions turn into manual-testing subtasks, manual-testing checklist items, or subtasks that depend on future proof outputs.
- Feed any newly confirmed pattern or contract detail back into the plan immediately when the current plan text is still too vague for clean task generation.
- If a prerequisite capability, harness, or contract adapter is missing, make it explicit in the plan before task generation instead of burying it in a later subtask.
  </research_and_pattern_rules>

<verification_loop>

- Treat this pass as incomplete until each planned seam either has a confirmed internal pattern, a confirmed external contract, or an explicit prerequisite in the plan.
- Check whether any remaining unknown would force a final task to say “investigate,” “confirm,” “spike,” or “figure out.” If so, resolve it now or rewrite the plan first.
- Check whether the planned proof files and wrappers still make sense for the confirmed pattern rather than only the originally guessed one.
- Check whether the plan now explicitly names config-domain constraints and scale-bounded query expectations so the later task list can avoid research-shaped subtasks.
- Check whether the plan now names any controlling unchanged selector, launcher, wrapper, harness, reader, or cleanup surface that the later tasks must inspect.
  </verification_loop>

<output_contract>

- Update the plan directly only when needed to capture confirmed patterns, contracts, or prerequisites before task generation.
- Keep the later task list free of research subtasks unless the story itself is explicitly a research or prototype story.
  </output_contract>
