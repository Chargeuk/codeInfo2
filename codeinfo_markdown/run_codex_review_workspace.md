# Run the Codex review job

Read and follow `review_job_workspace_contract.md` first.

Use the assigned input directory to understand the target repository, exact committed HEAD and comparison base, story overview, acceptance criteria, out-of-scope guidance, and exclusions. Recheck the supplied commits with Git without changing them.

Prepare a self-contained instructions file under this job's `work/` directory that gives Codex the pinned story context, acceptance criteria, out-of-scope guidance, exact reviewed HEAD, comparison base, and exclusions. Do not use conversational memory as review evidence.

Run the native review exactly once through `$CODEINFO_ROOT/scripts/run-codex-review.sh`; do not construct or invoke `codex exec review` directly. Run the launcher from the assigned target repository and pass the exact comparison base, model `gpt-5.6-sol`, reasoning effort `high`, prepared instructions-file path, and a native-response output path under this job's `work/` directory. Redirect the launcher's stdout and stderr to separate files in `work/`. The launcher is authoritative for ephemeral execution, closed stdin, and `--dangerously-bypass-approvals-and-sandbox` because CodeInfo's Docker container is the isolation boundary.

Write `work/invocation.md` with the launcher path, Codex CLI version when available, model, reasoning effort, comparison base, reviewed HEAD, full-access mode, native-response path, stdout and stderr paths, and actual process exit status. If launch setup or Codex fails, preserve partial native evidence and the exact failure honestly; do not retry by calling Codex directly or by removing the full-access policy.

Then interpret the response yourself and write a self-describing review under `output/`. Preserve findings even if Codex uses an unexpected layout. For each finding, retain severity, target file and line when available, concrete evidence, expected behavior, and the proposed direction. State coverage, exclusions, command failure, timeout, partial output, and uncertainty honestly. Do not write or update `current-codex-review.json`.
