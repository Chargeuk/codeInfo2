# Blind-spot challenge

Reviewed HEAD: `a07f482a2b10bf44f8694c3d2862d3fda4bc3962`
Comparison base: `4939ff83297aa78109ab3c58dae702e009db9ea7`

## Result

No supported finding.

## Disposition

- The reported `json` versus JSONL mismatch is not supported. Installed Copilot CLI help defines `--output-format json` as JSONL with one JSON object per line, so the launcher argument, `copilot.stdout.jsonl` artifact, line parser, story contract, and [launcher unit proof](../../server/src/test/unit/copilot-review-launcher.test.ts) agree.

## Unsupported claim

- The earlier claim that external Copilot launches inherit `COPILOT_HOME` is not supported by the current source.
- In [the Copilot review launcher](../../server/src/copilot/reviewLauncher.ts), `buildExternalCopilotEnvironmentBaseline()` only copies keys from `EXTERNAL_COPILOT_BASELINE_ENVIRONMENT_KEYS`, and that allowlist does not include `COPILOT_HOME`.
- `buildExternalCopilotReviewEnvironment()` only adds the selected provider URL, wire API, model, and optional API key at `:501-513`, so the previous leakage claim does not hold on this head.

## Residual uncertainty

- No live Copilot CLI run or full client/server/Cucumber/e2e suite was performed in this challenge.
