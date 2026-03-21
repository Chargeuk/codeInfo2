#!/usr/bin/env node

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const part = process.argv[index];
  if (!part.startsWith('--')) continue;
  const key = part.slice(2);
  const value = process.argv[index + 1];
  args.set(key, value);
}

const parseBoolean = (value, key) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected --${key} to be true or false`);
};

const baseUrl = (args.get('base-url') ?? 'http://host.docker.internal:5010')
  .trim()
  .replace(/\/+$/u, '');
const traceabilityPass = parseBoolean(
  args.get('traceability-pass') ?? 'false',
  'traceability-pass',
);
const manualChecksPassed = parseBoolean(
  args.get('manual-checks-passed') ?? 'false',
  'manual-checks-passed',
);
const proofWrapperPassed = parseBoolean(
  args.get('proof-wrapper-passed') ?? 'false',
  'proof-wrapper-passed',
);
const screenshotCountRaw = args.get('screenshot-count') ?? '0';
const screenshotCount = Number.parseInt(screenshotCountRaw, 10);

if (!Number.isInteger(screenshotCount) || screenshotCount < 0) {
  throw new Error('Expected --screenshot-count to be a non-negative integer');
}

const payload = {
  level: 'info',
  source: 'server',
  message: 'DEV-0000050:T14:story_validation_completed',
  timestamp: new Date().toISOString(),
  context: {
    traceabilityPass,
    manualChecksPassed,
    screenshotCount,
    proofWrapperPassed,
  },
};

const response = await fetch(`${baseUrl}/logs`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  throw new Error(
    `Failed to emit Task 14 marker: ${response.status} ${await response.text()}`,
  );
}

const body = await response.json();
console.log(
  'DEV-0000050:T14:story_validation_completed',
  JSON.stringify(payload.context),
);
console.log(JSON.stringify(body));
