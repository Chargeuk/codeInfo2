import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const read = (relativePath: string) =>
  fs.readFile(path.join(repoRoot, relativePath), 'utf8');

test('human findings contract requires local display time and understandable provenance', async () => {
  const contract = await read(
    'codeinfo_markdown/shared/review-findings-plan-record.md',
  );

  for (const required of [
    'Findings recorded',
    'format-display-timestamp.mjs',
    'CODEINFO_DISPLAY_LOCALE',
    'CODEINFO_DISPLAY_TIME_ZONE',
    'Review harnesses',
    'Reviews attempted',
    'Input tokens',
    'Cached input tokens',
    'Output tokens',
    'At least <number> reported; incomplete',
    'no-findings',
    'Simple description',
    'Example',
    'generating or corroborating',
    'Unknown review harness',
    'UTC machine timestamps',
  ]) {
    assert.match(contract, new RegExp(required), required);
  }

  assert.doesNotMatch(
    contract,
    /No concrete example was recorded in the validated review evidence/u,
  );
});

test('generic, legacy, external, and closeout paths consume the shared findings contract', async () => {
  for (const relativePath of [
    'codeinfo_markdown/disposition_review_batch.md',
    'codeinfo_markdown/record_review_issue_decisions_in_plan.md',
    'codeinfo_markdown/review_disposition.md',
    'codeinfo_markdown/external_review_disposition.md',
    'codeinfo_markdown/write_review_no_findings_closeout.md',
    'codeinfo_markdown/settle_agent_native_review_pass.md',
    'codeinfo_markdown/apply_agent_native_review_settlement.md',
    'codeinfo_markdown/audit_agent_native_review_settlement.md',
  ]) {
    const content = await read(relativePath);
    assert.match(
      content,
      /shared\/review-findings-plan-record\.md/u,
      relativePath,
    );
  }

  const disposition = await read(
    'codeinfo_markdown/disposition_review_batch.md',
  );
  assert.match(
    disposition,
    /every generating or corroborating review harness/u,
  );
  assert.match(disposition, /short simple description/u);
  assert.match(disposition, /concrete evidence-grounded example/u);
  assert.match(disposition, /locale and IANA time zone/u);
});

test('agent-native settlement records exactly one completed task per fix-bearing batch', async () => {
  const contract = await read(
    'codeinfo_markdown/shared/completed-review-fix-task.md',
  );

  for (const required of [
    'Task Status: __done__',
    'Review Task Role: completed_review_fixes',
    'Create no completed-review-fix task for a batch with no repair commit',
    'exactly one matching task',
    'Affected Repositories',
    'Review Harnesses',
    'Addresses Findings',
    'exact full commits',
    'final whole-story revalidation task',
  ]) {
    assert.match(contract, new RegExp(required), required);
  }

  for (const relativePath of [
    'codeinfo_markdown/record_review_batch_outcome.md',
    'codeinfo_markdown/settle_agent_native_review_pass.md',
    'codeinfo_markdown/apply_agent_native_review_settlement.md',
    'codeinfo_markdown/audit_agent_native_review_settlement.md',
  ]) {
    const content = await read(relativePath);
    assert.match(
      content,
      /shared\/completed-review-fix-task\.md/u,
      relativePath,
    );
  }

  const apply = await read(
    'codeinfo_markdown/apply_agent_native_review_settlement.md',
  );
  assert.match(apply, /exactly one `__done__` completed-review-fixes task/u);
  assert.match(apply, /never create a task for a no-fix batch/u);
  assert.match(apply, /Match by exact batch ID/u);
  assert.match(apply, /final revalidation task is last/u);
});

test('compose variants pass host-derived display settings without changing mounts', async () => {
  const wrapper = await read('scripts/docker-compose-with-env.sh');
  assert.match(wrapper, /resolve_display_locale/u);
  assert.match(wrapper, /resolve_display_time_zone/u);
  assert.match(
    wrapper,
    /export CODEINFO_DISPLAY_LOCALE="\$\(resolve_display_locale\)"/u,
  );
  assert.match(
    wrapper,
    /export CODEINFO_DISPLAY_TIME_ZONE="\$\(resolve_display_time_zone\)"/u,
  );

  for (const relativePath of [
    'docker-compose.yml',
    'docker-compose.local.yml',
    'docker-compose.e2e.yml',
  ]) {
    const compose = await read(relativePath);
    assert.match(compose, /CODEINFO_DISPLAY_LOCALE=/u, relativePath);
    assert.match(compose, /CODEINFO_DISPLAY_TIME_ZONE=/u, relativePath);
  }
});
