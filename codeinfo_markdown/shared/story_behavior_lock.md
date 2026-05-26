# Story Behavior Lock

## Rule

- For any repository and any story, only user-facing behavior changes that are explicitly requested at the story level, or later approved explicitly by the user as a scope expansion, may be implemented.
- Once planning has translated the user request into a story plan, the allowed user-facing behavior changes for that story are locked.
- Tasking, implementation, testing, and review must not add new user-facing behavior changes beyond that locked story scope.

## What Counts As User-Facing Behavior

- Treat user-facing behavior broadly.
- This includes selection behavior, toggle behavior, replacement behavior, removal behavior, action availability, menu reachability, validation timing when it changes what the user can do, scene-targeting UX, visible controls, keyboard or focus interaction contracts, error or result behavior users rely on, and any other browser-visible or runtime-visible interaction contract.

## What Is Not Allowed

- Do not change user-facing behavior merely because a different contract would be cleaner, more consistent, easier to prove, easier to automate, easier to implement, or easier to reason about.
- If the change would alter an established user interaction pattern or workflow contract, preserve current behavior unless the story explicitly requests that change or the user explicitly approves that scope expansion later.
- Do not convert a pre-existing bug, awkward workflow, inconsistency, limitation, surprise, or product-quality issue into current-story scope unless the story explicitly requires that change or the user explicitly approves the scope expansion.
- Do not use testing, proof-authoring, or review feedback as a reason to widen product scope.

## What To Do Instead

- If proof needs a seam, prefer read-only observability, test-only harness work, fixture or setup work, or helper improvements over a production behavior change.
- If honest proof cannot proceed without a product decision, preserve current behavior and treat the issue as out-of-scope for the current story instead of silently changing behavior in the current story.
- If the current story itself introduced an unapproved user-facing behavior change, treat that as unfinished in-scope regression work against a preserved behavior rather than as acceptable completion or as out-of-scope product redesign.
- In steps that own machine-readable review state, represent that outcome in `rejected_or_non_actionable_findings` with a concise scope reason.
- In audit or planning steps that repair task truth, record story-caused preserved-behavior regressions by adding explicit unchecked remaining work and documenting the reason in the task's note or audit note.
- In those same audit or planning steps, merely discovered out-of-scope behavior drift may be documented in the audit note when that context is needed to explain why the task stayed aligned to current approved behavior without widening scope.
- In other steps that do not own machine-readable review state, report the scope boundary only in step output and do not invent an ad hoc durable storage location for it.
- Do not create a numbered task or blocker for an out-of-scope behavior change unless the user explicitly expands scope.
- For testing-additions and proof-authoring stories, tests must document current behavior unless the story explicitly asks for that behavior to change.

## Enforcement

- Planning must make the allowed user-facing behavior changes explicit.
- By default, planning should do that by clarifying the plan's existing requirements and out-of-scope sections rather than by introducing a new section.
- Add a separate behavior-lock section only when the story is unusually ambiguous, high-risk for scope reinterpretation, or otherwise needs an explicit extra boundary.
- Tasking must decompose only that locked scope.
- Implementation must reject scope drift even when tests pass.
- Review must catch regressions and proof gaps, not create new product scope.
