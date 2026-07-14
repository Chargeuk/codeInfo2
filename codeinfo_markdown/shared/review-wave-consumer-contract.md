# Review-Wave Consumer Contract

When the current story has `codeInfoTmp/reviews/<story-id>-current-review-set.json`, that manifest and the matching `current-review-wave-validation.json` are the authoritative review handoff.

- Require exact `story_id`, `review_wave_id`, `parent_execution_id`, and `targets_sha256` agreement. Never rediscover a wave or pointer by timestamp.
- Consume findings only from `job_results` whose status is `completed` or `partial`, plus the manifest's `aggregated_findings`. Keep each finding's `target_ids`, sources, and severity conflicts visible.
- Treat missing, failed, stale, and invalid cells as coverage, not as proof of no findings. A multi-target wave cannot close cleanly unless its cross-repository result is usable and `closeout_allowed` is true.
- Use the target owner recorded in the manifest for implementation task ownership. Cross-repository findings may require sequenced tasks, but each implementation task still names one repository owner and retains cross-target validation.
- A retry after fixes starts with a newly prepared target snapshot, review wave ID, target HEADs, bases, and pointers. Do not reuse a previous wave's identity or stable result.
- The cross-repository review already ran concurrently with target-local reviews. Do not add another unconditional cross-repository review after the join; request a follow-up only for explicitly missing or unusable coverage.

If no review-set manifest exists, retain the legacy single-repository behavior described by the calling prompt.
