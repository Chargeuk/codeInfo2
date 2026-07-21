# Implement direct fixes from the current review batch

Read the current batch disposition, underlying evidence, bounded story plan, and repository instructions. Implement only findings explicitly classified as safe direct fixes. Work through all such findings with best effort, verifying source before changing it.

Run proportionate tests for each change and preserve unrelated worktree changes. Commit completed direct fixes on the current story branch with the repository-required story commit prefix so the next review batch receives a new immutable HEAD; do not push from this step. Never mix pre-existing unrelated changes into a fix commit. Continuously update the current task plan checkboxes and implementation notes when this work belongs to an active task. Record a self-describing direct-fix audit under the batch reconciliation directory, including changed files, exact fix commits, tests, unresolved findings, and whether another review of the new committed HEAD is useful.

Do not create implementation tasks here. Task-required findings are handled during complete-pass settlement.
