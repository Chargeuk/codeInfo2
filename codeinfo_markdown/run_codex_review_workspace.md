# Run the Codex review job

Read and follow `review_job_workspace_contract.md` first.

Use the assigned input directory to understand the target repository, exact committed HEAD and comparison base, story overview, acceptance criteria, out-of-scope guidance, and exclusions. Recheck the supplied commits with Git without changing them.

Prepare a self-contained instructions file under this job's `work/` directory that gives Codex the pinned story context, acceptance criteria, out-of-scope guidance, exact reviewed HEAD, comparison base, and exclusions. Do not use conversational memory as review evidence.

Run the native review exactly once through `$CODEINFO_ROOT/scripts/run-codex-review.sh`; do not construct or invoke `codex exec review` directly. Run the launcher from the assigned target repository and pass the exact comparison base, model `gpt-5.6-terra`, reasoning effort `high`, prepared instructions-file path, and a native-response output path under this job's `work/` directory. Redirect the launcher's JSONL stdout and diagnostic stderr to separate files in `work/`. The launcher requires a non-empty caller-selected model and passes it through unchanged rather than enforcing an exact model name. It remains authoritative for JSONL events, high reasoning, ephemeral execution, closed stdin, and `--dangerously-bypass-approvals-and-sandbox` because CodeInfo's Docker container is the isolation boundary.

Write `work/invocation.md` with the launcher path, Codex CLI version when available, model, reasoning effort, comparison base, reviewed HEAD, full-access mode, native-response path, stdout and stderr paths, and actual process exit status. Inspect the JSONL stdout after the process exits. When a terminal `turn.completed` event supplies usage, write `work/review-usage/native-codex.md` as a small self-describing artifact that preserves `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens` as separate values. State explicitly that cached input is part of the input category and must not be added to it. Do not include this wrapper agent's own usage. If terminal native usage is absent, malformed, or partial, write `Not reported` for each unavailable category and continue; usage evidence is optional and never changes review success.

If launch setup or Codex fails, preserve partial native evidence and the exact failure honestly; do not retry by calling Codex directly or by removing the full-access policy.

Then interpret the response yourself and write a self-describing review under `output/`. Preserve findings even if Codex uses an unexpected layout. For each finding, retain severity, target file and line when available, concrete evidence, expected behavior, and the proposed direction. State coverage, exclusions, command failure, timeout, partial output, and uncertainty honestly. Do not write or update `current-codex-review.json`.
