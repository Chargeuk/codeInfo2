# Blind-spot challenge

Reviewed HEAD: `a07f482a2b10bf44f8694c3d2862d3fda4bc3962`
Comparison base: `4939ff83297aa78109ab3c58dae702e009db9ea7`

## Result

1 supported finding.

## Finding

- P1: `server/src/copilot/reviewLauncher.ts:335-336` requests `--output-format json`, but the launcher writes `copilot.stdout.jsonl`, parses stdout as JSONL, and the story acceptance criteria explicitly require JSONL output. The current unit test in [`server/src/test/unit/copilot-review-launcher.test.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/copilot-review-launcher.test.ts) at `:250-256` asserts the same `json` argument, so the proof harness currently codifies the mismatch instead of proving the required runtime behavior. If the installed Copilot CLI distinguishes `json` from JSONL, the review event stream and normalized artifacts can diverge from the documented contract.

## Unsupported claim

- The earlier claim that external Copilot launches inherit `COPILOT_HOME` is not supported by the current source.
- In [`server/src/copilot/reviewLauncher.ts`](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/copilot/reviewLauncher.ts), `buildExternalCopilotEnvironmentBaseline()` only copies keys from `EXTERNAL_COPILOT_BASELINE_ENVIRONMENT_KEYS`, and that allowlist does not include `COPILOT_HOME` at `:380-404`.
- `buildExternalCopilotReviewEnvironment()` only adds the selected provider URL, wire API, model, and optional API key at `:501-513`, so the previous leakage claim does not hold on this head.

## Residual uncertainty

- No live Copilot CLI run or full client/server/Cucumber/e2e suite was performed in this challenge.
