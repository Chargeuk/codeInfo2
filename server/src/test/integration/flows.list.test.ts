import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import express from 'express';
import supertest from 'supertest';

import { createFlowsRouter } from '../../routes/flows.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

describe('GET /flows', () => {
  test('missing flows folder returns empty list', async () => {
    const app = express();
    app.use(createFlowsRouter());
    const response = await supertest(app).get('/flows');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { flows: [] });
  });

  test('lists flows with disabled/error states for invalid entries', async () => {
    const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-'));
    await fs.cp(fixturesDir, tmpDir, { recursive: true });

    process.env.FLOWS_DIR = tmpDir;
    const app = express();
    app.use(createFlowsRouter());
    const response = await supertest(app).get('/flows');

    assert.equal(response.status, 200);
    const names = response.body.flows.map(
      (flow: { name: string }) => flow.name,
    );
    assert.deepEqual(names, ['invalid-json', 'invalid-schema', 'valid-flow']);

    const invalidJson = response.body.flows.find(
      (flow: { name: string }) => flow.name === 'invalid-json',
    );
    assert.equal(invalidJson.disabled, true);
    assert.ok(invalidJson.error);

    const invalidSchema = response.body.flows.find(
      (flow: { name: string }) => flow.name === 'invalid-schema',
    );
    assert.equal(invalidSchema.disabled, true);
    assert.ok(invalidSchema.error);

    const valid = response.body.flows.find(
      (flow: { name: string }) => flow.name === 'valid-flow',
    );
    assert.equal(valid.disabled, false);
    assert.equal(valid.description, 'Valid flow');

    delete process.env.FLOWS_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
