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

After all possible bundles have been attempted, inspect the complete manifest, comments, validation, reports, exclusions, warnings, and failures. Write a self-describing review under `output/` with supported findings, coverage, partial work, and residual uncertainty. Do not invoke `publish_open_code_review.py` and do not write `current-open-code-review.json`.
