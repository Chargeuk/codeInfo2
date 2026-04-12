The base `review_blind_spot_challenge` command sequence has already been applied for this external-review variant.

Apply these external-review-specific additions after that shared base sequence:

1. Preserve the external review input context already captured in the evidence and findings artifacts. Do not rediscover external comments from anywhere else.
2. When an external comment overlaps a top-risk helper/function, make that overlap explicit in the challenge artifact so the disposition step can see whether the external comment exposed a real blind spot or was ultimately rejected.
3. If the challenge produces a new finding, ensure the challenge artifact distinguishes whether that finding came from:
   - the existing internal risk matrix alone;
   - the external review comments reinforcing that risk;
   - or both together.
4. Keep the same backward-compatibility rule as the base prompt: the external disposition step must still work when this challenge artifact is absent because an older flow snapshot is still running.
5. Preserve the base prompt's extra non-helper consistency or portability challenge so external review can still catch issues such as duplicated literals that should use a canonical constant, absolute local filesystem links in changed user-facing docs, or changed test-support mocks with already-aborted cancellation inputs.
6. Preserve the base prompt's failure-ordering challenge for changed orchestration functions so external review can still catch cases where a no-op, metadata-only, delete-only, or zero-work fast path depends on provider or bootstrap setup before proving real work exists.
