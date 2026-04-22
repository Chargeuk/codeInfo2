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

function getResponse(
  openapi: ReturnType<typeof readOpenApi>,
  pathName: string,
  method: 'get' | 'post',
  statusCode: string,
) {
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    pathName
  ] as Record<string, unknown> | undefined;
  return (
    ((schema?.[method] as Record<string, unknown>)?.responses ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  )[statusCode];
}

function getResponseSchema(
  openapi: ReturnType<typeof readOpenApi>,
  pathName: string,
  method: 'get' | 'post',
  statusCode: string,
) {
  const response = getResponse(openapi, pathName, method, statusCode);
  return (((
    ((response?.content as Record<string, unknown>) ?? {})[
      'application/json'
    ] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
}

function getRequestSchema(
  openapi: ReturnType<typeof readOpenApi>,
  pathName: string,
  method: 'post',
) {
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    pathName
  ] as Record<string, unknown> | undefined;
  const operation = (schema?.[method] ?? null) as Record<
    string,
    unknown
  > | null;
  return (((
    (
      ((operation?.requestBody as Record<string, unknown>)?.content ??
        {}) as Record<string, unknown>
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
}

function assertQueueUnavailableResponse(
  openapi: ReturnType<typeof readOpenApi>,
  pathName: '/ingest/start' | '/ingest/reembed/{root}',
) {
  const response = getResponse(openapi, pathName, 'post', '503');
  assert.ok(response, `missing ${pathName} 503 response`);

  const headers = (response.headers ?? {}) as Record<string, unknown>;
  const retryAfter = headers['Retry-After'] as
    | Record<string, unknown>
    | undefined;
  assert.ok(retryAfter, `missing ${pathName} Retry-After header`);
  assert.deepEqual(retryAfter.schema, { type: 'integer', minimum: 1 });

  const bodySchema = getResponseSchema(openapi, pathName, 'post', '503');
  assert.ok(bodySchema, `missing ${pathName} 503 schema`);
  assert.equal(bodySchema.type, 'object');
  assert.deepEqual(bodySchema.required, [
    'status',
    'code',
    'retryable',
    'message',
  ]);
  assert.equal(bodySchema.additionalProperties, false);

  const props = (bodySchema.properties ?? {}) as Record<string, unknown>;
  assert.deepEqual(props.status, { type: 'string', enum: ['error'] });
  assert.deepEqual(props.code, {
    type: 'string',
    enum: ['QUEUE_UNAVAILABLE'],
  });
  assert.deepEqual(props.retryable, { type: 'boolean', enum: [true] });
  assert.deepEqual(props.message, { type: 'string' });
}

test('OpenAPI /ingest/roots schema includes documented identity, error, queue, and lock fields', () => {
  const openapi = readOpenApi();
  const bodySchema = getResponseSchema(openapi, '/ingest/roots', 'get', '200');
  assert.ok(bodySchema, 'missing /ingest/roots schema');
  const rootItem = ((
    ((bodySchema?.properties as Record<string, unknown>)?.roots ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(rootItem, 'missing roots item schema');
  const rootProps = (rootItem?.properties ?? {}) as Record<string, unknown>;
  const topProps = (bodySchema?.properties ?? {}) as Record<string, unknown>;
  assert.deepEqual(rootProps.id, { type: 'string' });
  assert.ok(rootProps.embeddingProvider);
  assert.ok(rootProps.embeddingModel);
  assert.ok(rootProps.embeddingDimensions);
  assert.ok(rootProps.model);
  assert.ok(rootProps.modelId);
  assert.deepEqual(rootProps.requestId, { type: 'string', nullable: true });
  assert.deepEqual(rootProps.runId, { type: 'string', nullable: true });
  assert.deepEqual(rootProps.queuePosition, {
    type: 'integer',
    minimum: 1,
    nullable: true,
  });
  assert.deepEqual(rootProps.queueState, {
    type: 'string',
    enum: ['waiting', 'running', 'cleanup-blocked'],
    nullable: true,
  });
  assert.deepEqual(rootProps.error, {
    type: 'object',
    nullable: true,
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      retryable: { type: 'boolean' },
      provider: { type: 'string', enum: ['lmstudio', 'openai', 'ingest'] },
      upstreamStatus: { type: 'integer' },
      retryAfterMs: { type: 'integer' },
    },
    required: ['error', 'message', 'retryable', 'provider'],
    additionalProperties: false,
  });
  assert.ok(rootProps.lock);
  assert.ok(rootProps.status);
  assert.ok(rootProps.phase);
  assert.ok(topProps.lock);
  assert.ok(topProps.lockedModelId);
  assert.ok(topProps.schemaVersion);
  assert.deepEqual(topProps.schemaVersion, {
    type: 'string',
    enum: ['0000055-queued-repo-list-v1'],
  });
  assert.equal(
    (rootItem?.required as string[] | undefined)?.includes('id') ?? false,
    true,
  );
  assert.equal(
    (rootItem?.required as string[] | undefined)?.includes('runId') ?? false,
    false,
  );
});

test('OpenAPI /tools/ingested-repos schema includes documented repo identity, name, error, queue, and lock fields', () => {
  const openapi = readOpenApi();
  const bodySchema = getResponseSchema(
    openapi,
    '/tools/ingested-repos',
    'get',
    '200',
  );
  assert.ok(bodySchema, 'missing /tools/ingested-repos schema');
  const repoItem = ((
    ((bodySchema?.properties as Record<string, unknown>)?.repos ??
      {}) as Record<string, unknown>
  ).items ?? null) as Record<string, unknown> | null;
  assert.ok(repoItem, 'missing repos item schema');
  const repoProps = (repoItem?.properties ?? {}) as Record<string, unknown>;
  const topProps = (bodySchema?.properties ?? {}) as Record<string, unknown>;
  assert.deepEqual(repoProps.id, { type: 'string' });
  assert.deepEqual(repoProps.name, { type: 'string' });
  assert.ok(repoProps.embeddingProvider);
  assert.ok(repoProps.embeddingModel);
  assert.ok(repoProps.embeddingDimensions);
  assert.ok(repoProps.model);
  assert.ok(repoProps.modelId);
  assert.deepEqual(repoProps.requestId, { type: 'string', nullable: true });
  assert.deepEqual(repoProps.runId, { type: 'string', nullable: true });
  assert.deepEqual(repoProps.queuePosition, {
    type: 'integer',
    minimum: 1,
    nullable: true,
  });
  assert.deepEqual(repoProps.queueState, {
    type: 'string',
    enum: ['waiting', 'running', 'cleanup-blocked'],
    nullable: true,
  });
  assert.deepEqual(repoProps.error, {
    type: 'object',
    nullable: true,
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      retryable: { type: 'boolean' },
      provider: { type: 'string', enum: ['lmstudio', 'openai', 'ingest'] },
      upstreamStatus: { type: 'integer' },
      retryAfterMs: { type: 'integer' },
    },
    required: ['error', 'message', 'retryable', 'provider'],
    additionalProperties: false,
  });
  assert.ok(repoProps.lock);
  assert.ok(repoProps.status);
  assert.ok(repoProps.phase);
  assert.ok(topProps.lock);
  assert.ok(topProps.lockedModelId);
  assert.ok(topProps.schemaVersion);
  assert.deepEqual(topProps.schemaVersion, {
    type: 'string',
    enum: ['0000055-queued-repo-list-v1'],
  });
  assert.equal(
    (repoItem?.required as string[] | undefined)?.includes('name') ?? false,
    true,
  );
  assert.equal(
    (repoItem?.required as string[] | undefined)?.includes('runId') ?? false,
    false,
  );
});

test('OpenAPI /ingest/start request schema rejects malformed typed body fields and unknown properties', () => {
  const openapi = readOpenApi();
  const requestSchema = getRequestSchema(openapi, '/ingest/start', 'post');

  assert.ok(requestSchema, 'missing /ingest/start request schema');
  assert.equal(requestSchema.type, 'object');
  assert.deepEqual(requestSchema.required, ['path', 'name']);
  assert.equal(requestSchema.additionalProperties, false);

  const props = (requestSchema.properties ?? {}) as Record<string, unknown>;
  assert.deepEqual(Object.keys(props).sort(), [
    'description',
    'dryRun',
    'embeddingModel',
    'embeddingProvider',
    'model',
    'name',
    'path',
  ]);
  assert.deepEqual(props.path, { type: 'string' });
  assert.deepEqual(props.name, { type: 'string' });
  assert.deepEqual(props.description, { type: 'string' });
  assert.deepEqual(props.dryRun, { type: 'boolean' });
  assert.deepEqual(props.model, { type: 'string' });
  assert.deepEqual(props.embeddingProvider, {
    type: 'string',
    enum: ['lmstudio', 'openai'],
  });
  assert.deepEqual(props.embeddingModel, { type: 'string' });
});

test('OpenAPI /ingest/start queue-aware 202 response documents immediate and waiting acceptance shapes', () => {
  const openapi = readOpenApi();
  const bodySchema = getResponseSchema(openapi, '/ingest/start', 'post', '202');

  assert.ok(bodySchema, 'missing /ingest/start 202 schema');
  const variants = (bodySchema.oneOf ?? null) as
    | Record<string, unknown>[]
    | null;
  assert.ok(variants && variants.length === 2, 'missing queue-aware oneOf');

  const immediateSchema = variants.find((entry) => {
    const queuedEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).queued as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return queuedEnum.includes(false);
  });
  assert.ok(immediateSchema, 'missing immediate-start acceptance schema');
  assert.deepEqual(immediateSchema?.required, ['queued', 'requestId', 'runId']);
  assert.equal(
    'queuePosition' in
      (((immediateSchema?.properties ?? {}) as Record<string, unknown>) ?? {}),
    false,
  );

  const waitingSchema = variants.find((entry) => {
    const queuedEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).queued as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return queuedEnum.includes(true);
  });
  assert.ok(waitingSchema, 'missing waiting acceptance schema');
  assert.deepEqual(waitingSchema?.required, [
    'queued',
    'requestId',
    'queuePosition',
  ]);
  assert.equal(
    'runId' in
      (((waitingSchema?.properties ?? {}) as Record<string, unknown>) ?? {}),
    false,
  );
});

test('OpenAPI /ingest/start documents POST /ingest/start 503 QUEUE_UNAVAILABLE response', () => {
  const openapi = readOpenApi();

  assertQueueUnavailableResponse(openapi, '/ingest/start');
});

test('OpenAPI /ingest/reembed/{root} queue-aware 202 response documents immediate and waiting acceptance shapes', () => {
  const openapi = readOpenApi();
  const bodySchema = getResponseSchema(
    openapi,
    '/ingest/reembed/{root}',
    'post',
    '202',
  );

  assert.ok(bodySchema, 'missing /ingest/reembed/{root} 202 schema');
  const variants = (bodySchema.oneOf ?? null) as
    | Record<string, unknown>[]
    | null;
  assert.ok(variants && variants.length === 2, 'missing queue-aware oneOf');

  const immediateSchema = variants.find((entry) => {
    const queuedEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).queued as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return queuedEnum.includes(false);
  });
  assert.ok(immediateSchema, 'missing immediate re-embed acceptance schema');
  assert.deepEqual(immediateSchema?.required, ['queued', 'requestId', 'runId']);

  const waitingSchema = variants.find((entry) => {
    const queuedEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).queued as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return queuedEnum.includes(true);
  });
  assert.ok(waitingSchema, 'missing waiting re-embed acceptance schema');
  assert.deepEqual(waitingSchema?.required, [
    'queued',
    'requestId',
    'queuePosition',
  ]);
  assert.equal(
    'runId' in
      (((waitingSchema?.properties ?? {}) as Record<string, unknown>) ?? {}),
    false,
  );
});

test('OpenAPI /ingest/reembed/{root} documents POST /ingest/reembed/{root} 503 QUEUE_UNAVAILABLE response', () => {
  const openapi = readOpenApi();

  assertQueueUnavailableResponse(openapi, '/ingest/reembed/{root}');
});

test('OpenAPI /codex/device-auth schema enforces empty request and shared provider-auth responses', () => {
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
  const successOneOf = (successSchema.oneOf ?? null) as
    | Record<string, unknown>[]
    | null;
  assert.ok(successOneOf && successOneOf.length >= 4, 'missing auth oneOf');

  const verificationReadySchema = successOneOf.find((entry) => {
    const stateEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).state as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return stateEnum.includes('verification_ready');
  });
  assert.ok(verificationReadySchema, 'missing verification_ready schema');
  assert.deepEqual(verificationReadySchema?.required, [
    'provider',
    'state',
    'verificationUrl',
    'userCode',
  ]);

  const pendingSchema = successOneOf.find((entry) => {
    const stateEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).state as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return stateEnum.includes('completion_pending');
  });
  assert.ok(pendingSchema, 'missing completion_pending schema');

  const completedSchema = successOneOf.find((entry) => {
    const stateEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).state as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return stateEnum.includes('completed');
  });
  assert.ok(completedSchema, 'missing completed schema');

  const unavailableSchema = successOneOf.find((entry) => {
    const stateEnum = ((
      ((entry.properties ?? {}) as Record<string, unknown>).state as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
    return stateEnum.includes('unavailable_before_start');
  });
  assert.ok(unavailableSchema, 'missing unavailable_before_start schema');

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
});

test('OpenAPI /copilot/device-auth schema enforces empty request and shared provider-auth responses', () => {
  const openapi = readOpenApi();
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    '/copilot/device-auth'
  ] as Record<string, unknown> | undefined;
  assert.ok(schema, 'missing /copilot/device-auth schema');

  const post = (schema?.post ?? null) as Record<string, unknown> | null;
  assert.ok(post, 'missing /copilot/device-auth post schema');

  const requestSchema = (((
    (
      ((post?.requestBody as Record<string, unknown>)?.content ?? {}) as Record<
        string,
        unknown
      >
    )['application/json'] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null)!;
  assert.ok(requestSchema, 'missing /copilot/device-auth request schema');
  assert.equal(requestSchema.type, 'object');
  assert.equal(requestSchema.additionalProperties, false);

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
  const successOneOf = (successSchema.oneOf ?? null) as
    | Record<string, unknown>[]
    | null;
  assert.ok(successOneOf && successOneOf.length >= 4, 'missing auth oneOf');

  const providerEnums = successOneOf.map((entry) => {
    return ((
      (entry.properties as Record<string, unknown>)?.provider as
        | Record<string, unknown>
        | undefined
    )?.enum ?? []) as unknown[];
  });
  assert.ok(providerEnums.every((values) => values.includes('copilot')));
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

test('OpenAPI /chat/models schema documents invalid provider validation failure', () => {
  const openapi = readOpenApi();
  const schema = (openapi.paths as Record<string, Record<string, unknown>>)?.[
    '/chat/models'
  ] as Record<string, unknown> | undefined;
  assert.ok(schema, 'missing /chat/models schema');

  const invalid = (
    ((schema?.get as Record<string, unknown>)?.responses ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  )['400'];
  assert.ok(invalid, 'missing /chat/models 400 schema');

  const bodySchema = ((
    ((invalid?.content as Record<string, unknown>) ?? {})[
      'application/json'
    ] as Record<string, unknown>
  )?.schema ?? null) as Record<string, unknown> | null;
  assert.ok(bodySchema, 'missing /chat/models 400 schema body');

  const required = (bodySchema?.required ?? []) as string[];
  assert.deepEqual(required, ['error', 'message']);

  const props = (bodySchema?.properties ?? {}) as Record<string, unknown>;
  assert.deepEqual(props.error, {
    type: 'string',
    enum: ['invalid_request'],
  });
  assert.deepEqual(props.message, {
    type: 'string',
    enum: ['provider must be one of: codex, copilot, lmstudio'],
  });
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
