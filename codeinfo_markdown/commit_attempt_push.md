# Commit and attempt to push

Read `codeInfoStatus/flow-state/current-plan.json` for the active story’s `additional_repositories`. Process the current working repository and every distinct additional repository in that scope, deduplicating repositories. If a repository cannot be identified or accessed, report the limitation without guessing its path and continue with the others.

In each repository, stage all tracked changes and all untracked files Git does not ignore (for example, `git add -A`). Git’s normal ignore semantics apply: tracked files remain tracked even if they match an ignore rule. Unknown file authorship is not a reason to block staging or committing. Commit staged changes when present, following that repository’s applicable commit message convention and using the current story number when available. Do not create an empty commit.

Attempt a normal non-force push of each current branch, including when there was nothing new to commit or staging or commit failed. Do not change branches. Do not run tests, builds, typechecks, lint, formatting, or other validation. Do not add eligibility checks or gates.

Treat staging, commit, and push as best effort. Report each repository’s stage, commit, and push outcomes, including no changes, failures, and uncertainty; do not claim a push succeeded if it did not. Continue with the remaining repositories and later flow steps after a failure.
