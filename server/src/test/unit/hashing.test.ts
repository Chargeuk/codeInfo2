import fs from 'fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'os';
import path from 'path';
import { hashChunk, hashFile } from '../../ingest/hashing.js';

test('hashChunk is deterministic across calls', () => {
  const h1 = hashChunk('src/app.ts', 0, 'hello');
  const h2 = hashChunk('src/app.ts', 0, 'hello');
  assert.equal(h1, h2);
});

test('hashFile returns same hash for unchanged file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-'));
  const file = path.join(dir, 'file.txt');
  await fs.writeFile(file, 'sample text');
  const h1 = await hashFile(file);
  const h2 = await hashFile(file);
  assert.equal(h1, h2);
});
