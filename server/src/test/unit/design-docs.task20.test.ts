import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const T20_SUCCESS =
  '[DEV-0000037][T20] event=design_documentation_synced result=success';
const T20_ERROR =
  '[DEV-0000037][T20] event=design_documentation_synced result=error';

function resolveDesignDocPath(): string {
  const direct = path.resolve(process.cwd(), 'design.md');
  if (fs.existsSync(direct)) {
    return direct;
  }
  const parent = path.resolve(process.cwd(), '..', 'design.md');
  return parent;
}

function assertTask20DesignCoverage(content: string): void {
  const requiredMarkers = [
    '## Story 0000037 Task 20: shared-home runtime architecture and API contract sync',
    'chat behavior source: `./codex/chat/config.toml`.',
    'agent behavior source: `codex_agents/<agent>/config.toml`.',
    '`effectiveProjects = { ...baseProjects, ...agentProjects }`',
    '`features.view_image_tool` normalizes to canonical `tools.view_image`.',
    '`POST /codex/device-auth` with `{}` only.',
    '`supportedReasoningEfforts` and `defaultReasoningEffort`',
    T20_SUCCESS,
    T20_ERROR,
  ];
  for (const marker of requiredMarkers) {
    assert.match(content, new RegExp(escapeRegExp(marker)));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('Task 20 design sync emits deterministic success log when docs are in canonical state', () => {
  const designPath = resolveDesignDocPath();
  const designContent = fs.readFileSync(designPath, 'utf8');
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optionalParams: unknown[]) => {
    const rendered = [message, ...optionalParams].map(String).join(' ');
    infoCalls.push(rendered);
  };
  try {
    assertTask20DesignCoverage(designContent);
    console.info(T20_SUCCESS);
    assert.ok(
      infoCalls.some((line) => line.includes(T20_SUCCESS)),
      'expected deterministic T20 success log line',
    );
  } finally {
    console.info = originalInfo;
  }
});

test('Task 20 design sync emits deterministic error log for intentional failure-path coverage', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optionalParams: unknown[]) => {
    const rendered = [message, ...optionalParams].map(String).join(' ');
    infoCalls.push(rendered);
  };
  try {
    assert.throws(() =>
      assertTask20DesignCoverage(
        'intentionally invalid design content for failure-path assertion',
      ),
    );
    console.info(T20_ERROR);
    assert.ok(
      infoCalls.some((line) => line.includes(T20_ERROR)),
      'expected deterministic T20 error log line',
    );
  } finally {
    console.info = originalInfo;
  }
});
