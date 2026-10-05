import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const manifest = JSON.parse(
  await fs.readFile(path.join(root, 'package.json'), 'utf8'),
);
assert.equal(manifest.name, '@dimforge/rapier3d-compat');
assert.equal(manifest.version, '0.21.0');
const require = createRequire(import.meta.url);
const cjs = require(path.join(root, 'dist/rapier.cjs'));
const esm = await import(pathToFileURL(path.join(root, 'dist/rapier.mjs')));
for (const [format, module] of [
  ['CJS', cjs],
  ['ESM', esm.default ?? esm],
]) {
  await module.init();
  const world = new module.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.step();
  } finally {
    world.free();
  }
  console.log(
    JSON.stringify({
      package: manifest.name,
      version: manifest.version,
      format,
      smoke: 'passed',
    }),
  );
}
