import fs from 'fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'path';

function readOpenApi() {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const openApiPath = path.resolve(testDir, '../../../../openapi.json');
  const raw = fs.readFileSync(openApiPath, 'utf8');
  return JSON.parse(raw) as {
    paths?: Record<string, unknown>;
  };
}

test('OpenAPI /ingest/roots schema includes canonical lock fields and aliases', () => {
  const openapi = readOpenApi();
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    '/ingest/roots'
  ] as Record<string, unknown> | undefined;
  const success = (
    ((schema?.get as Record<string, unknown>)?.responses ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  )['200'];
  const bodySchema = ((
    ((success?.content as Record<string, unknown>) ?? {})[
      'application/json'
    ] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null;
  assert.ok(bodySchema, 'missing /ingest/roots schema');
  const rootItem = ((
    ((bodySchema?.properties as Record<string, unknown>)?.roots ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(rootItem, 'missing roots item schema');
  const rootProps = (rootItem?.properties ?? {}) as Record<string, unknown>;
  const topProps = (bodySchema?.properties ?? {}) as Record<string, unknown>;
  assert.ok(rootProps.embeddingProvider);
  assert.ok(rootProps.embeddingModel);
  assert.ok(rootProps.embeddingDimensions);
  assert.ok(rootProps.model);
  assert.ok(rootProps.modelId);
  assert.ok(rootProps.lock);
  assert.ok(rootProps.status);
  assert.ok(rootProps.phase);
  assert.ok(topProps.lock);
  assert.ok(topProps.lockedModelId);
  assert.ok(topProps.schemaVersion);
  assert.deepEqual(topProps.schemaVersion, {
    type: 'string',
    enum: ['0000038-status-phase-v1'],
  });
});

test('OpenAPI /tools/ingested-repos schema includes canonical repo and lock alias fields', () => {
  const openapi = readOpenApi();
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    '/tools/ingested-repos'
  ] as Record<string, unknown> | undefined;
  const success = (
    ((schema?.get as Record<string, unknown>)?.responses ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  )['200'];
  const bodySchema = ((
    ((success?.content as Record<string, unknown>) ?? {})[
      'application/json'
    ] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null;
  assert.ok(bodySchema, 'missing /tools/ingested-repos schema');
  const repoItem = ((
    ((bodySchema?.properties as Record<string, unknown>)?.repos ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(repoItem, 'missing repos item schema');
  const repoProps = (repoItem?.properties ?? {}) as Record<string, unknown>;
  const topProps = (bodySchema?.properties ?? {}) as Record<string, unknown>;
  assert.ok(repoProps.embeddingProvider);
  assert.ok(repoProps.embeddingModel);
  assert.ok(repoProps.embeddingDimensions);
  assert.ok(repoProps.model);
  assert.ok(repoProps.modelId);
  assert.ok(repoProps.lock);
  assert.ok(repoProps.status);
  assert.ok(repoProps.phase);
  assert.ok(topProps.lock);
  assert.ok(topProps.lockedModelId);
  assert.ok(topProps.schemaVersion);
  assert.deepEqual(topProps.schemaVersion, {
    type: 'string',
    enum: ['0000038-status-phase-v1'],
  });
});

test('OpenAPI /codex/device-auth schema enforces empty request and deterministic 200/400/503 responses', () => {
  const openapi = readOpenApi();
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    '/codex/device-auth'
  ] as Record<string, unknown> | undefined;
  assert.ok(schema, 'missing /codex/device-auth schema');

  const post = (schema?.post ?? null) as Record<string, unknown> | null;
  assert.ok(post, 'missing /codex/device-auth post schema');

  const requestSchema = (((
    (
      ((post?.requestBody as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(requestSchema, 'missing /codex/device-auth request schema');
  assert.equal(requestSchema.type, 'object');
  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(
    Object.keys((requestSchema.properties ?? {}) as Record<string, unknown>)
      .length,
    0,
  );

  const responses = (post?.responses ?? {}) as Record<string, unknown>;

  const successSchema = (((
    (
      ((responses['200'] as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(successSchema, 'missing 200 response schema');
  assert.deepEqual(successSchema.required, ['status', 'rawOutput']);
  assert.deepEqual(
    (successSchema.properties as Record<string, unknown>).status,
    {
      type: 'string',
      enum: ['ok'],
    },
  );

  const invalidRequestSchema = (((
    (
      ((responses['400'] as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(invalidRequestSchema, 'missing 400 response schema');
  assert.deepEqual(invalidRequestSchema.required, ['error', 'message']);
  assert.deepEqual(
    (invalidRequestSchema.properties as Record<string, unknown>).error,
    { type: 'string', enum: ['invalid_request'] },
  );

  const unavailableSchema = (((
    (
      ((responses['503'] as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(unavailableSchema, 'missing 503 response schema');
  assert.deepEqual(unavailableSchema.required, ['error', 'reason']);
  assert.deepEqual(
    (unavailableSchema.properties as Record<string, unknown>).error,
    { type: 'string', enum: ['codex_unavailable'] },
  );
});

test('OpenAPI /chat/models schema includes codex capability fields', () => {
  const openapi = readOpenApi();
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    '/chat/models'
  ] as Record<string, unknown> | undefined;
  assert.ok(schema, 'missing /chat/models schema');

  const success = (
    ((schema?.get as Record<string, unknown>)?.responses ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  )['200'];
  const bodySchema = ((
    ((success?.content as Record<string, unknown>) ?? {})[
      'application/json'
    ] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null;
  assert.ok(bodySchema, 'missing /chat/models 200 schema');

  const modelItems = ((
    ((bodySchema?.properties as Record<string, unknown>)?.models ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(modelItems, 'missing /chat/models models.items schema');

  const oneOf = (modelItems?.oneOf ?? null) as Record<string, unknown>[] | null;
  assert.ok(
    oneOf && oneOf.length >= 1,
    'missing /chat/models model oneOf schema',
  );

  const codexEntry = oneOf.find((entry) => {
    const typeSchema = ((entry.properties ?? {}) as Record<string, unknown>)
      .type as Record<string, unknown> | undefined;
    const typeEnum = (typeSchema?.enum ?? []) as unknown[];
    return typeEnum.includes('codex');
  });

  assert.ok(codexEntry, 'missing codex model schema entry');
  const codexRequired = (codexEntry?.required ?? []) as string[];
  assert.ok(
    codexRequired.includes('supportedReasoningEfforts'),
    'codex model schema missing required supportedReasoningEfforts',
  );
  assert.ok(
    codexRequired.includes('defaultReasoningEffort'),
    'codex model schema missing required defaultReasoningEffort',
  );
});

test('OpenAPI GET /agents/{agentName}/commands requires stepCount >= 1', () => {
  const openapi = readOpenApi();
  const pathSchema = (
    openapi.paths as Record<string, Record<string, unknown>>
  )?.['/agents/{agentName}/commands'] as Record<string, unknown> | undefined;
  assert.ok(pathSchema, 'missing /agents/{agentName}/commands schema');

  const success = (
    ((pathSchema?.get as Record<string, unknown>)?.responses ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  )['200'];
  const bodySchema = ((
    ((success?.content as Record<string, unknown>) ?? {})[
      'application/json'
    ] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null;
  assert.ok(bodySchema, 'missing /agents/{agentName}/commands 200 schema');

  const commandItem = ((
    ((bodySchema?.properties as Record<string, unknown>)?.commands ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(commandItem, 'missing command item schema');

  const required = (commandItem?.required ?? []) as string[];
  assert.ok(required.includes('stepCount'), 'stepCount must be required');

  const stepCountSchema = (
    (commandItem?.properties ?? {}) as Record<string, unknown>
  ).stepCount as Record<string, unknown> | undefined;
  assert.ok(stepCountSchema, 'missing stepCount schema');
  assert.equal(stepCountSchema.type, 'integer');
  assert.equal(stepCountSchema.minimum, 1);
});

test('OpenAPI POST /agents/{agentName}/commands/run keeps startStep optional and documents INVALID_START_STEP payload', () => {
  const openapi = readOpenApi();
  const pathSchema = (
    openapi.paths as Record<string, Record<string, unknown>>
  )?.['/agents/{agentName}/commands/run'] as
    | Record<string, unknown>
    | undefined;
  assert.ok(pathSchema, 'missing /agents/{agentName}/commands/run schema');

  const post = (pathSchema?.post ?? null) as Record<string, unknown> | null;
  assert.ok(post, 'missing POST schema');

  const requestSchema = (((
    (
      ((post?.requestBody as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(requestSchema, 'missing request body schema');
  const required = (requestSchema.required ?? []) as string[];
  assert.ok(required.includes('commandName'));
  assert.equal(required.includes('startStep'), false);

  const props = (requestSchema.properties ?? {}) as Record<string, unknown>;
  const startStepSchema = props.startStep as
    | Record<string, unknown>
    | undefined;
  assert.ok(startStepSchema, 'missing startStep property');
  assert.equal(startStepSchema.type, 'integer');

  const responses = (post.responses ?? {}) as Record<string, unknown>;
  const invalidStartStepSchema = (((
    (
      ((responses['400'] as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(invalidStartStepSchema, 'missing 400 INVALID_START_STEP schema');
  assert.deepEqual(invalidStartStepSchema.required, [
    'error',
    'code',
    'message',
  ]);

  const invalidProps = (invalidStartStepSchema.properties ?? {}) as Record<
    string,
    unknown
  >;
  assert.deepEqual(invalidProps.error, {
    type: 'string',
    enum: ['invalid_request'],
  });
  assert.deepEqual(invalidProps.code, {
    type: 'string',
    enum: ['INVALID_START_STEP'],
  });
  assert.deepEqual(invalidProps.message, {
    type: 'string',
    enum: ['startStep must be between 1 and N'],
  });
});
