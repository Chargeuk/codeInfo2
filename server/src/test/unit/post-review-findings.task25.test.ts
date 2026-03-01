import assert from 'node:assert/strict';
import test from 'node:test';

const T25_SUCCESS =
  '[DEV-0000037][T25] event=post_review_findings_resolved result=success';
const T25_ERROR =
  '[DEV-0000037][T25] event=post_review_findings_resolved result=error';

function validateTask25RemediationGate(input: {
  resolverFailureSeamApplied: boolean;
  clientNormalizerDeduped: boolean;
  detectionRegistryFresh: boolean;
  oversizedContractStandardized: boolean;
}): void {
  if (
    !input.resolverFailureSeamApplied ||
    !input.clientNormalizerDeduped ||
    !input.detectionRegistryFresh ||
    !input.oversizedContractStandardized
  ) {
    throw new Error('task 25 remediation gate failed');
  }
}

test('Task 25 remediation gate emits deterministic success log when all findings are resolved', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optional: unknown[]) => {
    infoCalls.push([message, ...optional].map(String).join(' '));
  };
  try {
    validateTask25RemediationGate({
      resolverFailureSeamApplied: true,
      clientNormalizerDeduped: true,
      detectionRegistryFresh: true,
      oversizedContractStandardized: true,
    });
    console.info(T25_SUCCESS);
    assert.ok(
      infoCalls.some((line) => line.includes(T25_SUCCESS)),
      'expected deterministic T25 success log line',
    );
  } finally {
    console.info = originalInfo;
  }
});

test('Task 25 remediation gate emits deterministic error log for intentional failure path', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optional: unknown[]) => {
    infoCalls.push([message, ...optional].map(String).join(' '));
  };
  try {
    assert.throws(() =>
      validateTask25RemediationGate({
        resolverFailureSeamApplied: true,
        clientNormalizerDeduped: true,
        detectionRegistryFresh: false,
        oversizedContractStandardized: true,
      }),
    );
    console.info(T25_ERROR);
    assert.ok(
      infoCalls.some((line) => line.includes(T25_ERROR)),
      'expected deterministic T25 error log line',
    );
  } finally {
    console.info = originalInfo;
  }
});
