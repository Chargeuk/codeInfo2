# Factual review-artifact handoff

Apply this contract only when the current step is responsible for an artifact. A later gate or repair stage that trustworthy earlier evidence made deliberately inapplicable requires no placeholder; preserve that skip reason in the next applicable audit, disposition, or outcome instead. Missing, partial, unavailable, conflicting, or uncertain evidence is not a clean skip.

Missing, malformed, empty, incomplete, contradictory, unexpectedly formatted, or factually rejected data is an evidence limitation, never by itself a reason to deliberately fail the agent turn, stop the parent flow, ask the user, or discard useful work. Read whatever is available, salvage every understandable fact, and continue with the best safe result. Best effort does not permit invented evidence, unsafe path guesses, promotion of unproven findings, or a false claim that handoff succeeded.

Use the scheduler-assigned job paths or the one batch directory resolved from the canonical current-batch handoff. Assign those paths once, derive destinations from them, and never reconstruct, repeatedly retype, or replace them through a broader filesystem search. Do not search a sibling or lookalike batch to find a preferred result, and do not delete or move a misplaced file merely to hide a handoff mistake.

For imperfect input or an imperfect existing artifact, use this recovery order:

1. Read the available file as agent-readable evidence and preserve every usable fragment even when its layout, syntax, headings, fields, or prose are malformed.
2. Triangulate those fragments with other trustworthy evidence already available inside the assigned job or batch, including assigned inputs, native `work/`, existing output, tool results, repository checks, and earlier applicable batch artifacts.
3. Produce the most complete self-describing result the combined evidence safely supports, explicitly preserving contradictions, missing coverage, and uncertainty.
4. When complete recovery remains impossible, degrade normally to an honest partial or unavailable result. This is a non-failing best-effort outcome, not successful artifact handoff and not a reason to fail the turn or parent flow.

When the assigned destination can be safely established and written, complete these checks before returning from an applicable artifact-producing step:

1. Enumerate or reopen the actual assigned destination, following regular files beneath it only as deeply as this step's existing flexible layout requires.
2. Confirm that at least one non-empty regular file owned by this step exists there. Do not satisfy this check with a directory, an expected filename that is absent, an empty file, a question, or a chat response that was never written to disk.
3. Reopen the discovered artifact and confirm only factual handoff properties: it is inside the assigned boundary, belongs to the exact job or batch, is non-empty, and honestly states a completed, partial, unavailable, or no-work result as appropriate. Understand its prose; do not require exact headings, fields, filenames, or schemas.
4. If the artifact is missing or misleading, recover or reconstruct it using the recovery order above. Write the recovered account into the assigned destination and repeat the checks.
5. If trustworthy evidence cannot establish a complete result, write an honest partial or unavailable artifact into the assigned destination, state the evidence gap, and repeat the checks. Never invent successful coverage or return a successful handoff while the applicable destination remains empty.

If the assigned destination itself cannot be safely resolved or written, do not invent one or search another batch. Return normally with a concise unavailable-handoff summary that preserves every usable fact, the attempted recovery, and the exact path limitation so the parent flow and later recovery agents can continue. Never deliberately return a failed turn merely because artifact handoff was unavailable.

Run the existing review-workspace checker when this prompt already requires it or the canonical batch handoff is available and the check is useful. Treat warnings, errors, and malformed evidence as diagnostic facts to recover from, not fatal semantic gates. Repair only artifacts owned by this step; preserve scheduler-owned evidence and unrelated jobs, and report their limitations honestly.
