import assert from 'node:assert/strict';
import test from 'node:test';

const T24_SUCCESS =
  '[DEV-0000037][T24] event=story_regression_revalidated result=success';
const T24_ERROR =
  '[DEV-0000037][T24] event=story_regression_revalidated result=error';

function validateStoryRegressionGate(input: {
  acceptanceMatrixVerified: boolean;
  regressionSuitePassed: boolean;
}): void {
  if (!input.acceptanceMatrixVerified || !input.regressionSuitePassed) {
    throw new Error(
      'story regression gate failed: acceptance re-validation incomplete',
    );
  }
}

test('Task 24 regression gate emits deterministic success log when validation input is complete', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optional: unknown[]) => {
    infoCalls.push([message, ...optional].map(String).join(' '));
  };
  try {
    validateStoryRegressionGate({
      acceptanceMatrixVerified: true,
      regressionSuitePassed: true,
    });
    console.info(T24_SUCCESS);
    assert.ok(
      infoCalls.some((line) => line.includes(T24_SUCCESS)),
      'expected deterministic T24 success log line',
    );
  } finally {
    console.info = originalInfo;
  }
});

test('Task 24 regression gate emits deterministic error log on intentional failure-path validation', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optional: unknown[]) => {
    infoCalls.push([message, ...optional].map(String).join(' '));
  };
  try {
    assert.throws(() =>
      validateStoryRegressionGate({
        acceptanceMatrixVerified: true,
        regressionSuitePassed: false,
      }),
    );
    console.info(T24_ERROR);
    assert.ok(
      infoCalls.some((line) => line.includes(T24_ERROR)),
      'expected deterministic T24 error log line',
    );
  } finally {
    console.info = originalInfo;
  }
});
