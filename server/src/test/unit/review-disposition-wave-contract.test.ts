import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(process.cwd(), '..');

test('review disposition and classifier cannot claim a clean multi-target wave with unusable cross-repository coverage', async () => {
  for (const filename of [
    'review_disposition.md',
    'classify_review_disposition.md',
  ]) {
    const prompt = await fs.readFile(
      path.join(repoRoot, 'codeinfo_markdown', filename),
      'utf8',
    );
    assert.match(prompt, /current-review-set\.json/u);
    assert.match(prompt, /current-review-wave-validation\.json/u);
    assert.match(prompt, /closeout_allowed: false/u);
    assert.match(prompt, /cross-repository coverage/iu);
  }
});
