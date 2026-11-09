import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import mongoose from 'mongoose';
import { listForkTurns } from '../../mongo/repo.js';
import { TurnModel, type Turn } from '../../mongo/turn.js';

type Row = Turn & { _id: mongoose.Types.ObjectId };
const id = (number: number) =>
  new mongoose.Types.ObjectId(number.toString(16).padStart(24, '0'));
const row = (
  number: number,
  role: Turn['role'],
  overrides: Partial<Row> = {},
): Row => ({
  _id: id(number),
  conversationId: 'source',
  role,
  content: `body-${number}`,
  model: 'model',
  provider: 'codex',
  source: 'REST',
  toolCalls: { large: 'tool output' },
  status: 'ok',
  createdAt: new Date(100),
  ...overrides,
});
const field = (value: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (current, part) =>
        (current as Record<string, unknown> | undefined)?.[part],
      value,
    );
const scalar = (value: unknown): string | number | boolean | null =>
  value == null
    ? null
    : value instanceof Date
      ? value.getTime()
      : value instanceof mongoose.Types.ObjectId
        ? String(value)
        : (value as string | number | boolean);
const compare = (left: unknown, right: unknown) => {
  const a = scalar(left);
  const b = scalar(right);
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
};
function matches(document: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or')
      return (expected as Record<string, unknown>[]).some((part) =>
        matches(document, part),
      );
    if (key === '$and')
      return (expected as Record<string, unknown>[]).every((part) =>
        matches(document, part),
      );
    const actual = field(document, key);
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof Date) &&
      !(expected instanceof mongoose.Types.ObjectId)
    ) {
      return Object.entries(expected).every(([operator, operand]) => {
        if (operator === '$in')
          return (operand as unknown[]).some(
            (entry) => compare(actual, entry) === 0,
          );
        if (operator === '$ne') return compare(actual, operand) !== 0;
        // Mongo comparisons do not treat a missing number/string as a smaller
        // populated value; those missing-value branches must be explicit.
        if (actual == null) return false;
        if (operator === '$lt') return compare(actual, operand) < 0;
        if (operator === '$gt') return compare(actual, operand) > 0;
        throw new Error(`Unexpected query operator ${operator}`);
      });
    }
    return compare(actual, expected) === 0;
  });
}
function database(t: TestContext, rows: Row[]) {
  const calls: Array<{
    method: string;
    projection?: string;
    filter: Record<string, unknown>;
  }> = [];
  for (const method of ['find', 'findOne'] as const) {
    t.mock.method(TurnModel, method, (filter: Record<string, unknown>) => {
      const call: (typeof calls)[number] = { method, filter };
      calls.push(call);
      let order: Record<string, number> = {};
      const query = {
        select(projection: string) {
          call.projection = projection;
          return query;
        },
        sort(sort: Record<string, number>) {
          order = sort;
          return query;
        },
        lean() {
          return query;
        },
        async exec() {
          const selected = rows
            .filter((document) => matches(document, filter))
            .sort((a, b) => {
              for (const [key, direction] of Object.entries(order)) {
                const result = compare(field(a, key), field(b, key));
                if (result) return result * direction;
              }
              return 0;
            });
          const projected = selected.map((document) =>
            call.projection
              ? Object.fromEntries(
                  call.projection
                    .split(' ')
                    .map((key) => [key, field(document, key)]),
                )
              : document,
          );
          return method === 'findOne' ? (projected[0] ?? null) : projected;
        },
      };
      return query;
    });
  }
  return calls;
}

for (const chronology of ['source', 'copy', 'legacy-copy'] as const) {
  test(`fork prefix excludes a later tied-timestamp prompt using ${chronology} chronology`, async (t) => {
    const rows = [row(10, 'user'), row(20, 'assistant'), row(30, 'user')];
    if (chronology !== 'source')
      rows.forEach((document, index) => {
        document._id = id(100 - index);
        if (chronology === 'copy') document.chronologicalOrder = index;
        else document.fork = { sourceTurnId: String(id((index + 1) * 10)) };
      });
    rows.push(row(40, 'assistant', { conversationId: 'another-conversation' }));
    const calls = database(t, rows);
    const result = await listForkTurns('source', String(rows[1]._id));
    assert.deepEqual(
      result.items.map((turn) => turn.turnId),
      [String(rows[1]._id), String(rows[0]._id)],
    );
    assert.deepEqual(
      result.items.map((turn) => turn.content),
      ['body-20', 'body-10'],
    );
    assert.equal(calls.filter((call) => call.method === 'find').length, 1);
    assert.equal(calls[0].projection?.includes('content'), false);
  });
}

test('options read only selected completed-bubble metadata with no prefix materialization', async (t) => {
  const selected = row(2, 'assistant', {
    native: { sessionId: 'native', turnId: 'earlier' },
  });
  const calls = database(t, [row(1, 'user'), selected, row(3, 'user')]);
  const result = await listForkTurns('source', String(selected._id), true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].native, selected.native);
  assert.equal(result.items[0].content, undefined);
  assert.equal(result.items[0].toolCalls, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'findOne');
  assert.equal(calls[0].projection?.includes('toolCalls'), false);
});

test('latest fork retains only contiguous inherited handovers before a later active prompt', async (t) => {
  const rows = [
    row(1, 'user'),
    row(2, 'assistant'),
    row(3, 'user', { fork: { handover: true } }),
    row(4, 'user', { fork: { handover: true } }),
    row(5, 'user'),
    row(6, 'user', { fork: { handover: true } }),
    row(7, 'assistant', { status: 'failed' }),
  ];
  database(t, rows);
  const latest = await listForkTurns('source');
  assert.deepEqual(
    latest.items.map((turn) => turn.turnId),
    [4, 3, 2, 1].map((number) => String(id(number))),
  );
  const options = await listForkTurns('source', undefined, true);
  assert.deepEqual(
    options.items.map((turn) => turn.turnId),
    [4, 2].map((number) => String(id(number))),
  );
  const explicit = await listForkTurns('source', String(id(4)), true);
  assert.deepEqual(
    explicit.items.map((turn) => turn.turnId),
    [4, 2].map((number) => String(id(number))),
  );
});

test('selected rows must belong to the source conversation; malformed IDs never query history', async (t) => {
  const calls = database(t, [row(1, 'assistant', { conversationId: 'other' })]);
  assert.deepEqual(
    (await listForkTurns('source', String(id(1)), true)).items,
    [],
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(
    (await listForkTurns('source', 'not-an-object-id', true)).items,
    [],
  );
  assert.equal(calls.length, 1);
});

test('unfinished or non-assistant stored rows cannot trigger a prefix read', async (t) => {
  const calls = database(t, [
    row(1, 'user'),
    row(2, 'assistant', { status: 'stopped' }),
  ]);
  assert.deepEqual((await listForkTurns('source', String(id(1)))).items, []);
  assert.deepEqual((await listForkTurns('source', String(id(2)))).items, []);
  assert.equal(
    calls.every((call) => call.method === 'findOne'),
    true,
  );
});
