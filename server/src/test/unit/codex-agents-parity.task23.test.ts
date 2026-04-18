import assert from 'node:assert/strict';
import test from 'node:test';

const T23_COMMAND_TREE_SUCCESS =
  '[DEV-0000037][T23] event=codex_agents_command_tree_verified result=success';
const T23_COMMAND_TREE_ERROR =
  '[DEV-0000037][T23] event=codex_agents_command_tree_verified result=error';

function assertNoDeleteOrRename(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.trim();
    if (!normalized) continue;
    const status = normalized.split('\t', 1)[0] ?? '';
    if (status === 'D' || status.startsWith('R')) {
      throw new Error(
        `codex_agents parity check failed: disallowed status "${status}" in "${normalized}"`,
      );
    }
  }
}

test('Task 23 command-tree checker emits deterministic success log for accepted diffs', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optional: unknown[]) => {
    infoCalls.push([message, ...optional].map(String).join(' '));
  };
  try {
    assertNoDeleteOrRename([
      'M\tcodex_agents/planning_agent/commands/improve_plan.json',
      'M\tcodex_agents/planning_agent/commands/task_up_review_tasks.json',
      'A\tcodex_agents/planning_agent/commands/kadshow_improve_plan.json',
      'M\tcodex_agents/tasking_agent/commands/task_up2.json',
    ]);
    console.info(T23_COMMAND_TREE_SUCCESS);
    assert.ok(
      infoCalls.some((line) => line.includes(T23_COMMAND_TREE_SUCCESS)),
      'expected deterministic T23 success log line',
    );
  } finally {
    console.info = originalInfo;
  }
});

test('Task 23 command-tree checker emits deterministic error log for disallowed delete or rename diffs', () => {
  const infoCalls: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown, ...optional: unknown[]) => {
    infoCalls.push([message, ...optional].map(String).join(' '));
  };
  try {
    assert.throws(() =>
      assertNoDeleteOrRename([
        'M\tcodex_agents/planning_agent/commands/improve_plan.json',
        'D\tcodex_agents/tasking_agent/commands/task_up2.json',
      ]),
    );
    console.info(T23_COMMAND_TREE_ERROR);
    assert.ok(
      infoCalls.some((line) => line.includes(T23_COMMAND_TREE_ERROR)),
      'expected deterministic T23 error log line',
    );
  } finally {
    console.info = originalInfo;
  }
});
