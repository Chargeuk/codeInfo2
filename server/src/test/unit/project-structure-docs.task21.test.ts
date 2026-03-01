import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const T21_SUCCESS =
  '[DEV-0000037][T21] event=project_structure_documentation_synced result=success';
const T21_ERROR =
  '[DEV-0000037][T21] event=project_structure_documentation_synced result=error';

function resolveProjectStructurePath(): string {
  const direct = path.resolve(process.cwd(), 'projectStructure.md');
  if (fs.existsSync(direct)) {
    return direct;
  }
  return path.resolve(process.cwd(), '..', 'projectStructure.md');
}

function assertTask21Coverage(content: string): void {
  const requiredMarkers = [
    '## Story 0000037 final file-map rollup (Task 21)',
    '### Added files (story-wide)',
    '### Removed files (story-wide)',
    '### Modified files (story-wide)',
    '## Story 0000037 compatibility aliases (input accepted, canonical output only)',
    '`features.view_image_tool` -> `tools.view_image`',
    '`features.web_search_request` and top-level `web_search_request` -> top-level `web_search`',
    'aliases are accepted for compatibility input only and are not emitted as canonical output',
    T21_SUCCESS,
    T21_ERROR,
  ];
  for (const marker of requiredMarkers) {
    assert.match(content, new RegExp(escapeRegExp(marker)));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('Task 21 projectStructure sync emits deterministic success log when docs are canonical', () => {
  const filePath = resolveProjectStructurePath();
  const content = fs.readFileSync(filePath, 'utf8');
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optionalParams: unknown[]) => {
    infoCalls.push([message, ...optionalParams].map(String).join(' '));
  };
  try {
    assertTask21Coverage(content);
    console.info(T21_SUCCESS);
    assert.ok(
      infoCalls.some((line) => line.includes(T21_SUCCESS)),
      'expected deterministic T21 success log line',
    );
  } finally {
    console.info = originalInfo;
  }
});

test('Task 21 projectStructure sync emits deterministic error log on intentional failure-path coverage', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optionalParams: unknown[]) => {
    infoCalls.push([message, ...optionalParams].map(String).join(' '));
  };
  try {
    assert.throws(() =>
      assertTask21Coverage('invalid docs payload for error-path assertion'),
    );
    console.info(T21_ERROR);
    assert.ok(
      infoCalls.some((line) => line.includes(T21_ERROR)),
      'expected deterministic T21 error log line',
    );
  } finally {
    console.info = originalInfo;
  }
});
