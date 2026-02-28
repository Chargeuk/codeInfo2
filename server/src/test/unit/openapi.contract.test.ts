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
  assert.ok(topProps.lock);
  assert.ok(topProps.lockedModelId);
  assert.ok(topProps.schemaVersion);
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
  assert.ok(topProps.lock);
  assert.ok(topProps.lockedModelId);
  assert.ok(topProps.schemaVersion);
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
