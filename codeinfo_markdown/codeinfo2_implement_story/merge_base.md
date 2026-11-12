# Integrate a verified base only when required and safe

Read `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/shared.md` and fresh target `AGENTS.md` guidance.

First discover the repository's documented integration procedure and exact base branch/ref. Do not assume a name, host, tracking ref, or permission. If none is documented or remote access/fetch is unavailable, report merge skipped/unavailable and continue safe local work; do not make it a blocker or repeatedly retry unchanged conditions.

Before any merge, verify the selected target/branch, source identity and fetched/cached status, current HEAD, index/worktree, any existing merge state, and ownership of all active changes. Capture the invocation's pre-merge state and identify protected selected-plan, current-plan handoff, and story-progress content. Do not switch branches or touch another owner's merge. If source is already an ancestor, retain the existing state without an empty merge commit.

If a merge is authorized, integrate only into the verified current story branch using the documented safe procedure. Inspect the entire resulting candidate index/tree, including clean auto-merges: preserve unrelated staged/worktree changes and protected plan/handoff/progress even when an incoming change appears conflict-free. Do not accept an automatic replacement/deletion of that local progress without an authorized, evidence-backed reconciliation. Route conflict/code/config/test repair to `coding_agent`; do not commit unresolved conflicts or another owner's changes.

If this invocation's merge cannot be completed safely, abort only that invocation-owned merge and only when the captured baseline proves that abort will preserve all pre-existing staged/worktree/protected content. If ownership or restoration safety is uncertain, do not abort, reset, checkout, stash, clean, or guess; preserve and report the actual state. A failed optional merge must not leave an invocation-owned pending merge blocking later work when a safe abort is proven. Report exact verified source/ref and merged, already-included, failed, skipped, or safely-aborted outcome; continue independent safe local work.
