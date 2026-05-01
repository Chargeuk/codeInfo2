# Fixture: POSIX sh Script Uses local

- Changed runtime seam: shell entrypoint or startup helper declared as `#!/usr/bin/env sh`.
- Contradiction to challenge: the script uses non-POSIX shell features such as `local`, so it can fail under `dash` or another real `/bin/sh` implementation.
- Expected review outcome: actionable portability/runtime finding, not cleanup.
