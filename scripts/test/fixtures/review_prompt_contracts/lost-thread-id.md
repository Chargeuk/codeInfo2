# Fixture: Lost Thread Id On Rebuild

- Changed runtime seam: conversation flag rebuild or normalization path.
- Contradiction to challenge: a preserved conversation or thread id is silently dropped during a rebuild, so resume creates a fresh thread instead of continuing the existing one.
- Expected review outcome: actionable runtime finding, not cleanup.
