import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function readOpenApi() {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const openApiPath = path.resolve(testDir, '../../../../openapi.json');
  const raw = fs.readFileSync(openApiPath, 'utf8');
  return JSON.parse(raw) as {
    paths?: Record<string, unknown>;
  };
}

test('OpenAPI includes GET /agents/{agentName}/prompts with required working_folder and 200/400/404/500 responses', () => {
  const openapi = readOpenApi();
  const pathSchema = (
    openapi.paths as Record<string, Record<string, unknown>>
  )?.['/agents/{agentName}/prompts'] as Record<string, unknown> | undefined;

  assert.ok(pathSchema, 'missing /agents/{agentName}/prompts path');

  const getSchema = (pathSchema?.get ?? null) as Record<string, unknown> | null;
  assert.ok(getSchema, 'missing GET /agents/{agentName}/prompts');

  const parameters = (getSchema?.parameters ?? []) as Array<
    Record<string, unknown>
  >;
  const agentNameParam = parameters.find((param) => param.name === 'agentName');
  assert.ok(agentNameParam, 'missing path parameter agentName');
  assert.equal(agentNameParam?.in, 'path');
  assert.equal(agentNameParam?.required, true);

  const workingFolderParam = parameters.find(
    (param) => param.name === 'working_folder',
  );
  assert.ok(workingFolderParam, 'missing query parameter working_folder');
  assert.equal(workingFolderParam?.in, 'query');
  assert.equal(workingFolderParam?.required, true);

  const responses = (getSchema?.responses ?? {}) as Record<string, unknown>;
  assert.ok(responses['200'], 'missing 200 response');
  assert.ok(responses['400'], 'missing 400 response');
  assert.ok(responses['404'], 'missing 404 response');
  assert.ok(responses['500'], 'missing 500 response');

  const successSchema = ((
    (
      ((responses['200'] as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null;

  assert.ok(successSchema, 'missing 200 schema');
  assert.deepEqual(successSchema?.required, ['prompts']);

  const promptsItems = ((
    ((successSchema?.properties as Record<string, unknown>)?.prompts ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(promptsItems, 'missing prompts.items schema');
  const promptProps = (promptsItems?.properties ?? {}) as Record<
    string,
    unknown
  >;
  assert.ok(promptProps.relativePath, 'missing relativePath in prompts.items');
  assert.ok(promptProps.fullPath, 'missing fullPath in prompts.items');
});
