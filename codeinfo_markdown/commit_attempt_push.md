# Commit and attempt to push

In the current working repository, stage the current working repository changes and commit them when there are staged changes. Follow the current working repository’s applicable AGENTS.md commit message conventions, including its subject prefix and body requirements. Use the current story number when available. Do not create an empty commit.

Attempt a normal non-force push of the current branch, including when there was nothing new to commit. Do not change branches or use force push. Do not run tests, builds, typechecks, lint, formatting, or other validation. Do not add eligibility checks or gates.

Treat staging, commit, and push as best effort. Report the actual commit and push outcomes, including no changes, failures, and any uncertainty; do not claim a push succeeded if it did not. A failure does not prevent the following reingest or later flow steps.
