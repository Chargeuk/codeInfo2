# Gather deep-review evidence

Read and follow `review_job_workspace_contract.md`. This is the evidence stage of a multi-agent reviewer, but the parent treats the complete job as an ordinary review.

Read the shared input pack and inspect the exact committed base-to-HEAD change. Build an acceptance-proof and risk map covering changed production code, tests, interfaces, lifecycle behavior, failure paths, UI behavior when applicable, and important exclusions. Use repository tools and bounded plan helpers to verify claims.

Write self-describing evidence under this job's `work/evidence/` directory. Do not publish findings or shared state yet.
