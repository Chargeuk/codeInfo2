# Story 0000048 – Working Repo First Reference Resolution For Flows And Commands

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Commands and flows can already reference other workflow files, especially command JSON files and markdown instruction files, but the current lookup behavior is rooted too heavily in the repository that owns the flow or command definition. That is technically consistent, but it does not match how a user thinks about the product when they are actively working on one specific repository in the UI.

The intended user experience for this story is different. When a user selects or otherwise works inside a current working repository, that repository should be the first place the product looks for any referenced workflow file. This should apply even when the flow definition itself lives in the local `codeInfo2` repository. For example, if the user is working in `/Users/danielstapleton/Documents/dev/game_repo` and runs a flow from `codeInfo2/flows/flow_1.json`, then a referenced markdown file such as `updated_tests.md` should be searched for in the markdown area of `game_repo` before looking in `codeInfo2` or other repositories.

This story therefore changes reference resolution from an owner-first model to a working-repo-first model. The user has already chosen the intended four-place search order:

- the current working repository;
- the repository that owns the referencing file;
- the local `codeInfo2` repository;
- all other ingested repositories.

This order should be applied consistently for every reference lookup, not only the first one in a run. Nested references must restart the same lookup order for each new lookup. In other words, if a flow resolves a command file and that command later resolves a markdown file, the markdown lookup must again start at the current working repository, then the owner of the referencing command file, then `codeInfo2`, then the remaining repositories. The previous lookup winner must not become an implicit new root for the next lookup unless that winner is also the owner of the file making the new reference.

The story is about deterministic lookup priority and user expectation. It is not about inventing a new free-form path syntax. References should continue to resolve through their established subfolders inside each candidate repository. A command reference should still map to the candidate repository's `codex_agents/<agent>/commands/<commandName>.json` location, and a markdown reference should still map to the candidate repository's `codeinfo_markdown/<relativePath>` location. The change is the repository candidate order, not the subfolder conventions.

This story also needs one explicit contract for duplicate candidates. In common cases the same repository can appear in more than one conceptual position, such as when the current working repository is also the owner of the referencing file, or when the owner of the referencing file is `codeInfo2`. In those cases the runtime should keep the first occurrence and skip later duplicates while preserving the order of the remaining distinct repositories.

Finally, the current working repository must be defined by one stable runtime signal so the server, websocket events, and REST-triggered execution all behave the same way. If the product cannot identify a current working repository for a particular request, lookup should degrade deterministically to the remaining positions in the same order rather than silently inventing a second inconsistent rule. The user has also chosen that the selected current folder must no longer be ephemeral UI state. Agent conversations, chat conversations, flow runs, and command runs should all persist the selected current folder and restore it when the user switches between conversations in the GUI. Without that persistence, the new working-repo-first lookup rule would be hard to reason about and would appear to drift unexpectedly between runs.

This story also includes a repository-wide environment-variable normalization pass because current env names are colliding with variables in user repositories. The desired end state is that repository-owned environment variables should use an uppercase `CODEINFO_` namespace, with browser-exposed Vite variables using uppercase `VITE_CODEINFO_` names. This includes updating committed `.env` files, `.env.local` examples and guidance, e2e configuration, docker-compose files, wrappers, and documentation so the product stops depending on generic names that can clash with unrelated repositories. The goal is consistent naming and safer overrides, not cosmetic renaming for its own sake.

### Acceptance Criteria

- Every referenced-file lookup for commands and flows uses the same repository candidate order:
  - current working repository;
  - owner of the referencing file;
  - local `codeInfo2` repository;
  - other ingested repositories.
- The lookup order is restarted fresh for every nested reference lookup rather than inheriting the winner of a previous lookup.
- Duplicate repositories are removed while preserving the first applicable position in the four-place order.
- A flow step that references a command file uses the four-place order to choose the repository candidate before applying the existing command subfolder convention.
- A flow step that references a markdown file uses the four-place order to choose the repository candidate before applying the existing markdown subfolder convention.
- A command item that references a markdown file uses the same four-place order, including when that command is being executed from inside a flow.
- Running a local flow from `codeInfo2/flows/<name>.json` while the current working repository is another repo causes referenced commands and markdown files to be searched in the working repository first.
- Running a flow owned by an ingested repository while the current working repository is a different repo still searches the working repository first, then the flow-owner repository second.
- The selected current folder is persisted for agent conversations, chat conversations, flow runs, and command runs and is restored when the user switches between existing conversations in the GUI.
- The persisted current-folder value is the same canonical signal used by the new working-repo-first reference resolver, so UI restoration and runtime lookup cannot disagree about which repository is active.
- Existing relative-path safety rules remain in place for command names and markdown paths; this story changes repository candidate priority, not path traversal policy.
- Fallback continues only for not-found outcomes. Higher-priority read, parse, validation, or decode failures remain fail-fast instead of falling through to lower-priority repositories.
- Observability logs and documentation are updated so the selected candidate order and selected repository are visible and understandable during debugging.
- The behavior is documented with at least one nested-reference example that proves the lookup order restarts for each reference hop.
- Repository-owned environment variables are renamed to uppercase `CODEINFO_` names, and Vite browser-facing variables are renamed to uppercase `VITE_CODEINFO_` names.
- The env renaming work updates committed defaults, local override examples, compose files, e2e configuration, wrappers, and documentation so the renamed variables are used consistently across local, compose, and test workflows.
- Where backward compatibility is required during rollout, the migration behavior is explicit and documented rather than being left to accidental partial support.

### Out Of Scope

- Changing the on-disk subfolder conventions for workflow assets inside a repository.
- Adding brand new reference types beyond the currently supported command and markdown references.
- Inventing a variable-substitution system or a free-form path expression language for workflow files.
- Changing how flow files themselves are listed or discovered unless that is required to surface the chosen current working repository signal.
- Altering the existing fail-fast policy for unreadable or invalid higher-priority candidates.
- Defining a new concept of current working repository separately for each transport or UI surface.
- Renaming operating-system, shell, Docker, Node.js, or toolchain environment variables that are not owned by this repository, such as `HOME`, `PATH`, or `NODE_ENV`.
- Reworking the Playwright manual-testing container networking model in this story beyond any documentation notes needed to explain why it is deferred.

### Questions

- What exact request or conversation field should be treated as the canonical current working repository signal for command runs, flow runs, resumptions, and websocket-connected UI refreshes?
- When no current working repository is available, should lookup skip the first slot entirely and proceed with owner -> `codeInfo2` -> others, or should there be an explicit "no working repo" marker in observability output?
- Should direct command execution outside flows use the command file itself as the owner slot when the command was selected from an ingested repository, even if the current working repository is different?
- Which existing logs and API responses should expose the resolved lookup order so debugging remains easy without requiring deep log inspection?
- Should the env-variable rename ship with a temporary compatibility window for old names, or should the story enforce a single clean cutover once docs, compose files, and wrappers are updated?

## Implementation Ideas

- Add one shared repository-candidate builder that accepts:
  - current working repository;
  - owner repository for the referencing file;
  - `codeInfo2` root;
  - remaining ingested repositories;
  and returns a de-duplicated ordered candidate list.
- Reuse that shared candidate builder in all reference-resolution paths so command lookup and markdown lookup cannot drift apart over time.
- Ensure nested flow -> command -> markdown execution passes both the current working repository and the owner of the immediate referencing file into the shared resolver for each lookup.
- Persist the selected current folder on conversation records so the GUI can restore it on conversation switch and the runtime can reuse the same canonical value for later runs or resumptions.
- Audit chat, agent, flow, and command execution entrypoints so they all write and read the same current-folder field instead of keeping separate page-local state.
- Keep existing safety guards for command name sanitization, markdown relative paths, and path-within-root checks unchanged.
- Inventory every repository-owned env variable currently used by server, client, compose, wrappers, tests, and docs; rename them to `CODEINFO_` or `VITE_CODEINFO_` as appropriate and update all references in one coordinated pass.
- Add explicit migration notes and validation coverage for renamed env variables so config drift and partial updates fail clearly.
- Extend unit and integration coverage with examples for:
  - local `codeInfo2` flow plus external working repo;
  - ingested flow plus different working repo;
  - nested flow -> command -> markdown lookup order restart;
  - duplicate candidate removal;
  - fail-fast on invalid higher-priority candidate.
- Update `design.md`, `projectStructure.md`, and any route or runtime documentation that currently describes owner-first resolution so the working-repo-first contract becomes the documented source of truth.
