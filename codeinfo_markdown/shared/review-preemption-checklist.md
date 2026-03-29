# Goal

Provide one shared checklist of review-hotspot categories that planning and tasking must pre-empt before implementation begins.

<usage_rules>

- Use this checklist during plan hardening, review-preemption risk surfacing, task generation, and late tasking audits.
- Treat the checklist as a prompt to make requirements, subtasks, and proof explicit. Do not paste the checklist into the final plan unless a category materially affects the story.
- Mark a category as not applicable when repository evidence shows the story does not touch that surface.
  </usage_rules>

<checklist>

- Persistence surfaces:
  - Does the story change a file, directory, lock, cache, database collection, persisted artifact, or cleanup path?
  - If yes, identify the writer, the reader, whether writes are atomic, how partial or in-progress state is handled, and who is allowed to clean it up.
- Lifecycle transitions:
  - Does the story change create, acquire, in-progress, steady-state, retry, cancel, release, teardown, or crash-recovery behavior?
  - If yes, make those transitions explicit in the plan and task proof.
- Default-path reachability:
  - Does the story change a selector, launcher, wrapper, startup path, CI path, feature flag, or harness-registration rule?
  - If yes, prove the changed behavior still runs in the default path rather than only through a manual or targeted route.
- Producer and consumer alignment:
  - Does the story change a shared contract, error taxonomy, persisted shape, config shape, log schema, or alias-migration path?
  - If yes, make both sides explicit and require proof that they still agree.
- Config-domain enforcement:
  - Does the story change a constrained env/config input?
  - If yes, define blank-input behavior, whitespace behavior, lower bounds, upper bounds, and whether invalid values clamp, fallback, or fail.
- Scale-bounded behavior:
  - Does the story change a query, filter, bulk selector, batch payload, or other request shape that can grow with repository, file, chunk, or symbol count?
  - If yes, make the bounding strategy explicit and require proof that large inputs stay bounded.
- Test isolation and determinism:
  - Does the story add or change tests that use shared state, ports, files, caches, locks, retries, or negative assertions?
  - If yes, require deterministic observable boundaries, teardown behavior, and worker or parallel-safety proof.
    </checklist>

<output_contract>

- Planning passes should turn relevant checklist items into plan language, edge cases, or explicit seams.
- Tasking passes should turn relevant checklist items into implementation subtasks, proof-authoring subtasks, and honest testing steps.
  </output_contract>
