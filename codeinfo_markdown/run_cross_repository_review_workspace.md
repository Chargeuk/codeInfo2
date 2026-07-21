# Run the cross-repository review job

Read and follow `review_job_workspace_contract.md`. This job uses the story-level cross-repository input directory.

When only one target exists, write a short self-describing not-applicable result under `output/` and finish. Otherwise inspect producer/consumer contracts, coordinated schemas, configuration, versions, rollout assumptions, deployment coupling, shared tests, and compatibility across every target. Use the exact target commits in the shared input.

Keep supporting investigation under `work/` and write the final self-describing review under `output/`. Identify every affected target for each finding. Preserve partial target coverage and uncertainty. Do not write a cross-repository pointer.
