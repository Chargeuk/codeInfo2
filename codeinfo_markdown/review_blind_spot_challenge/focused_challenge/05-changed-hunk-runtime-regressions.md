# Goal

Force one last changed-hunk runtime regression scan so the blind-spot pass does not rely only on seeded defect families.

<usage_rules>

- Apply this file only during the blind-spot challenge.
- Use it for changed runtime files outside the allowed support-file set, especially routes, interfaces, config loaders, entrypoints, startup scripts, and mounted-path helpers.
- Keep the scan bounded to the changed hunks and the directly adjacent producer or consumer seams they affect.
- Record the scan as short per-file subsections or bullets in the challenge artifact rather than inventing a rigid schema. Each subsection should name the changed file, the contradiction attempted, and the outcome.

</usage_rules>

<changed_hunk_rules>

- For each changed runtime file, inspect the changed hunks directly and ask all of the following before concluding no-finding:
  - does the edit rebuild or normalize state in a way that can drop preserved identifiers, thread ids, handles, or working-folder state;
  - does the edit move config parsing or loading into a path that can now throw on malformed input instead of degrading safely;
  - does the edit assume a shell, launcher, or runtime feature that is not guaranteed by the declared entrypoint or runtime image;
  - does the edit reuse an existing log marker, error label, or event name for a broader failure region than the label honestly describes;
  - does the edit resolve an optional dependency, readiness probe, model list, or provider status eagerly on paths where lazy resolution would preserve current behavior and reduce failure surface.
- When the answer to any question above is “possibly yes,” challenge the exact changed seam with one contradictory scenario before accepting the current behavior.
- Prefer contradiction attempts that mirror real runtime use over generic style concerns, such as:
  - resume an existing conversation after flags are rebuilt;
  - load malformed config while discovery metadata is being assembled;
  - execute the declared shell entrypoint under the actual shell named in the shebang;
  - trigger a non-config runtime failure inside a broad `try`/`catch` and compare the emitted label to the real fault;
  - request a non-default provider and check whether unrelated provider readiness work still runs eagerly.
- Use known missed-review examples as pattern reminders rather than as a hard-coded schema, including:
  - lost preserved identifiers such as a conversation or thread id during flag or metadata rebuilds;
  - malformed TOML or config input crashing discovery or metadata routes instead of degrading safely;
  - shell scripts that claim POSIX `sh` but use non-POSIX features such as `local`;
  - runtime error markers that overclaim a narrower root cause than the surrounding failure region;
  - provider readiness or model-discovery work that runs eagerly for unrelated providers.
- If the changed hunk appears to introduce only portability or neatness cleanup, do not escalate it unless the contradictory scenario reproduces a real behavioral or operational problem on the current head.

</changed_hunk_rules>
