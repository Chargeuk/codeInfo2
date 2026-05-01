# Fixture: Malformed TOML Crashes Discovery

- Changed runtime seam: provider-discovery or model-metadata route that reads config defaults.
- Contradiction to challenge: malformed TOML or config input throws through the route instead of degrading safely with warnings or fallback defaults.
- Expected review outcome: actionable runtime finding, not cleanup.
