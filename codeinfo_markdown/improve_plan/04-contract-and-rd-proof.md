# Goal

Resolve external contract unknowns before tasking by confirming real message shapes, runtime assumptions, and integration behavior with evidence rather than guesswork.

<instruction_priority>

- Do not create tasks in this pass.
- Run this pass whenever the story may exchange data with an external system, SDK, service, file format, protocol, or user-provided contract that is not already fully settled by repository evidence.
- Prefer confirming unknowns now over pushing investigation into later tasks.
  </instruction_priority>

<source_priority>

- Use `code_info` first for existing internal patterns, current adapters, contract helpers, and how our repositories already represent the same class of data.
- Inspect relevant local source files directly after `code_info`.
- Use Context7 for library, SDK, and framework documentation when relevant.
- Use DeepWiki for external GitHub repository architecture or usage guidance when relevant.
- Use official documentation and targeted web research when repository evidence and official SDK docs do not fully settle a contract or runtime question.
  </source_priority>

<contract_and_rd_rules>

- Check inbound and outbound message structures, storage shapes, config/env names, startup assumptions, readiness dependencies, auth or header requirements, and error vocabulary when those surfaces matter to the story.
- For changed persisted artifacts, locks, caches, or cleanup paths, confirm who writes the state, who reads it, whether writes are atomic or otherwise safe to observe, how partial or in-progress state should be handled, and who owns cleanup or stale-state deletion.
- For changed selectors, launchers, wrappers, startup paths, or CI-facing config, confirm which unchanged file or runtime path actually determines default reachability so the plan does not assume the new behavior is on the standard path when it is still opt-in.
- For changed env/config inputs, confirm the accepted value domain from code and evidence, including blank input, whitespace-only input, lower bounds, upper bounds, and whether invalid values must clamp, fallback, or fail.
- For changed query/filter/bulk selectors, confirm whether the request shape remains bounded as repository, file, chunk, or symbol counts grow, and use the smallest safe proving example needed when the scale behavior is ambiguous.
- Compare the planned contract against any existing internal producer or consumer code so the plan does not invent a one-sided shape.
- Compare changed producer and consumer handling when the story touches wrapped errors, retryability, cancel-vs-terminal behavior, or other error-taxonomy contracts.
- If repository evidence and official docs are still ambiguous, create or run the smallest safe proving example needed to confirm the behavior now.
- Keep any proving example minimal and disposable. Do not leave throwaway files in the repository unless they materially improve the plan or become part of the real proof path.
- Record the confirmed contract or behavior back into the plan in concrete language.
- Record domain constraints and scale-bounding expectations back into the plan in concrete language instead of leaving them implicit in the later tasking pass.
- If the behavior still cannot be confirmed cheaply, make the prerequisite implementation or prototype work explicit in the plan instead of letting the later tasking pass create research subtasks.
  </contract_and_rd_rules>

<verification_loop>

- Check whether every externally sourced message, payload, or runtime assumption in the story is now either confirmed or explicitly turned into prerequisite work in the plan.
- Check whether the plan now states the concrete contract shape rather than a vague placeholder such as “wire up the API response” or “match the provider payload.”
- Check whether any remaining unknown would force a later tasking pass to create investigation subtasks; if so, resolve it here or make the prerequisite explicit in the plan first.
  </verification_loop>

<output_contract>

- Update the plan directly when contract or proving-example clarification is needed.
- Keep the edits evidence-backed, concise, and implementation-oriented.
- Do not create tasks in this pass.
  </output_contract>
