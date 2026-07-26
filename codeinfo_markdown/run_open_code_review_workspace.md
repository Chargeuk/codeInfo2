# Run the OpenCode review job

Read and follow `review_job_workspace_contract.md` first.

Read the assigned shared input directory and verify its exact repository, base commit, HEAD commit, story context, and exclusions. Keep every OpenCode artifact inside this job's `work/` directory.

Use the supported agent commands, adapting paths to this job:

```text
ocr agent prepare --repo <repo-root> --from <base> --to <head> --exclude 'planning/**' --split --output <work-dir>/bundle-manifest.json
ocr agent validate-comments --repo <repo-root> --bundle <manifest> --comments <comments> --output <validation>
ocr agent report --repo <repo-root> --bundle <manifest> --comments <comments> --validation <validation> --format markdown --output <report>
```

Review every reviewable bundle with Codex-owned reasoning. Continue past an invalid or unavailable bundle and preserve useful sibling work. A changed excluded path may legitimately remain in the manifest as a non-reviewable entry with no patch; confirm the exclusion was honored instead of rejecting the review merely because the path is listed.

Each `ocr` invocation may outlive one tool-call yield. Invoke each command separately with direct `exec_command`, never with `functions.exec`, JavaScript, or nested `tools.exec_command`. If direct `exec_command` returns a `session_id`, retain it and poll that same direct process with `write_stdin` until its result includes a numeric `exit_code` before reading that command's output as complete or starting the dependent command. Completion of a JavaScript orchestration cell is not evidence that `ocr` exited. Do not relaunch the same `ocr` command, classify a bundle from still-growing files, or treat a yielded direct session as a timeout. If the direct continuation itself later becomes unavailable, preserve the partial artifacts, record the lost continuation honestly, and continue with independent bundles when possible.

After all possible bundles have been attempted, inspect the complete manifest, comments, validation, reports, exclusions, warnings, and failures. Write a self-describing review under `output/` with supported findings, coverage, partial work, and residual uncertainty. Do not invoke `publish_open_code_review.py` and do not write `current-open-code-review.json`.

Before returning, enumerate the files that actually exist under the assigned `output/` variable rather than checking or reporting a path typed from memory. Apply the shared factual handoff contract: if no non-empty output exists there, recover the review from this job's assigned manifest, comments, validation, reports, command results, and other `work/` evidence, or write an honest unavailable result there when trustworthy recovery is impossible. Reopen the discovered output and do not report completion while the assigned destination is empty.
