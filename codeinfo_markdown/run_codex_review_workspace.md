# Run the Codex review job

Read and follow `review_job_workspace_contract.md` first.

Use the assigned input directory to understand the target repository, exact committed HEAD and comparison base, story overview, acceptance criteria, out-of-scope guidance, and exclusions. Recheck the supplied commits with Git without changing them.

Run a one-shot non-interactive Codex review of the committed base-to-HEAD diff. Give Codex the story context and exclusions in the best supported way. Close stdin and use the configured review model; do not use conversational memory as review evidence. Save the complete native Codex response under this job's `work/` directory.

Then interpret the response yourself and write a self-describing review under `output/`. Preserve findings even if Codex uses an unexpected layout. For each finding, retain severity, target file and line when available, concrete evidence, expected behavior, and the proposed direction. State coverage, exclusions, command failure, timeout, partial output, and uncertainty honestly. Do not write or update `current-codex-review.json`.
