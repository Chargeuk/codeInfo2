import mongoose from 'mongoose';
import type { Conversation } from '../../mongo/conversation.js';
import { ConversationModel } from '../../mongo/conversation.js';
import { TurnModel } from '../../mongo/turn.js';
import { runWithTestEnvOverrides } from './testEnvOverrideScope.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneConversation = (
  conversation: Conversation | null,
): Conversation | null =>
  conversation ? (structuredClone(conversation) as Conversation) : null;

const cloneRecord = <T>(value: T): T => structuredClone(value);

const getNestedValue = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) return undefined;
    return current[segment];
  }, value);

const matchesConversationFilter = (
  conversation: Conversation,
  filter: unknown,
): boolean => {
  if (!isPlainObject(filter)) return true;
  return Object.entries(filter).every(([path, expected]) => {
    if (path.startsWith('$')) return false;
    if (isPlainObject(expected)) return false;
    return getNestedValue(conversation, path) === expected;
  });
};

const setNestedValue = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) => {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!isPlainObject(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1) as string] = value;
};

const deleteNestedValue = (target: Record<string, unknown>, path: string) => {
  const segments = path.split('.');
  let cursor: Record<string, unknown> | undefined = target;
  for (const segment of segments.slice(0, -1)) {
    const existing: unknown = cursor?.[segment];
    if (!isPlainObject(existing)) return;
    cursor = existing;
  }
  if (!cursor) return;
  delete cursor[segments.at(-1) as string];
};

const applyConversationUpdate = (
  conversation: Conversation,
  update: unknown,
): Conversation => {
  const next = structuredClone(conversation) as Conversation;

  if (isPlainObject(update) && ('$set' in update || '$unset' in update)) {
    if (isPlainObject(update.$set)) {
      for (const [path, value] of Object.entries(update.$set)) {
        setNestedValue(next as unknown as Record<string, unknown>, path, value);
      }
    }
    if (isPlainObject(update.$unset)) {
      for (const path of Object.keys(update.$unset)) {
        deleteNestedValue(next as unknown as Record<string, unknown>, path);
      }
    }
  } else if (isPlainObject(update)) {
    Object.assign(next, structuredClone(update));
  }

  next.updatedAt = new Date();
  return next;
};

const buildFindByIdResult = (
  store: Map<string, Conversation>,
  id: unknown,
) => ({
  lean: () => ({
    exec: async () => cloneConversation(store.get(String(id)) ?? null),
  }),
  exec: async () => cloneConversation(store.get(String(id)) ?? null),
});

const resolveConversationId = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value;
  if (
    isPlainObject(value) &&
    typeof value._id === 'string' &&
    value._id.trim()
  ) {
    return value._id;
  }
  return undefined;
};

const matchesTurnFilter = (
  turn: Record<string, unknown>,
  filter: unknown,
): boolean => {
  if (!isPlainObject(filter)) return true;
  return Object.entries(filter).every(([path, expected]) => {
    if (path.startsWith('$')) return false;
    const actual = getNestedValue(turn, path);
    if (isPlainObject(expected)) {
      if ('$lt' in expected) {
        const candidate = expected.$lt;
        if (!(candidate instanceof Date) || !(actual instanceof Date)) {
          return false;
        }
        return actual.getTime() < candidate.getTime();
      }
      return false;
    }
    return actual === expected;
  });
};

const compareSortValues = (left: unknown, right: unknown): number => {
  const leftComparable =
    left instanceof Date ? left.getTime() : left == null ? undefined : left;
  const rightComparable =
    right instanceof Date ? right.getTime() : right == null ? undefined : right;

  if (leftComparable === rightComparable) return 0;
  if (leftComparable === undefined) return 1;
  if (rightComparable === undefined) return -1;
  return leftComparable > rightComparable ? 1 : -1;
};

export async function withMockedMongoConversationPersistence<T>(params: {
  seedConversations: Conversation[];
  run: (state: {
    conversations: Map<string, Conversation>;
    turns: Array<Record<string, unknown>>;
  }) => Promise<T>;
}): Promise<T> {
  const conversations = new Map(
    params.seedConversations.map((conversation) => [
      conversation._id,
      structuredClone(conversation) as Conversation,
    ]),
  );
  const turns: Array<Record<string, unknown>> = [];

  const originalNodeEnv = process.env.NODE_ENV;
  const originalReadyState = mongoose.connection.readyState;
  const originalFindById = ConversationModel.findById;
  const originalFindOne = ConversationModel.findOne;
  const originalFindByIdAndUpdate = ConversationModel.findByIdAndUpdate;
  const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
  const originalTurnFind = TurnModel.find;
  const originalTurnFindOne = TurnModel.findOne;
  const originalTurnCreate = TurnModel.create;

  process.env.NODE_ENV = 'production';
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  ConversationModel.findById = ((id: unknown) =>
    buildFindByIdResult(
      conversations,
      id,
    )) as typeof ConversationModel.findById;

  ConversationModel.findOne = ((filter: unknown) => ({
    sort: (sortSpec: Record<string, 1 | -1>) => ({
      lean: () => ({
        exec: async () => {
          const [sortPath, direction] = Object.entries(sortSpec ?? {})[0] ?? [];
          const matches = [...conversations.values()].filter((conversation) =>
            matchesConversationFilter(conversation, filter),
          );
          if (sortPath) {
            matches.sort((left, right) => {
              const leftValue = getNestedValue(left, sortPath);
              const rightValue = getNestedValue(right, sortPath);
              const leftComparable =
                leftValue instanceof Date
                  ? leftValue.getTime()
                  : leftValue == null
                    ? undefined
                    : leftValue;
              const rightComparable =
                rightValue instanceof Date
                  ? rightValue.getTime()
                  : rightValue == null
                    ? undefined
                    : rightValue;
              if (leftComparable === rightComparable) return 0;
              if (leftComparable === undefined) return 1;
              if (rightComparable === undefined) return -1;
              return leftComparable > rightComparable
                ? (direction ?? 1)
                : -1 * (direction ?? 1);
            });
          }
          return cloneConversation(matches[0] ?? null);
        },
      }),
    }),
  })) as typeof ConversationModel.findOne;

  ConversationModel.findByIdAndUpdate = ((id: unknown, update: unknown) => ({
    exec: async () => {
      const existing = conversations.get(String(id));
      if (!existing) return null;
      const next = applyConversationUpdate(existing, update);
      conversations.set(String(id), next);
      return cloneConversation(next);
    },
  })) as typeof ConversationModel.findByIdAndUpdate;

  ConversationModel.findOneAndUpdate = ((filter: unknown, update: unknown) => ({
    exec: async () => {
      const conversationId = resolveConversationId(filter);
      if (!conversationId) return null;
      const existing = conversations.get(conversationId);
      if (!existing) return null;
      const next = applyConversationUpdate(existing, update);
      conversations.set(conversationId, next);
      return cloneConversation(next);
    },
  })) as typeof ConversationModel.findOneAndUpdate;

  TurnModel.create = (async (input: Record<string, unknown>) => {
    const turn = {
      _id: `turn-${turns.length + 1}`,
      ...cloneRecord(input),
    };
    turns.push(turn);
    return turn;
  }) as unknown as typeof TurnModel.create;
  TurnModel.find = ((filter: unknown) => {
    let sortSpec: Record<string, 1 | -1> = {};
    let limitCount: number | undefined;

    const execute = async () => {
      const matches = turns
        .filter((turn) => matchesTurnFilter(turn, filter))
        .map((turn) => cloneRecord(turn));
      const sortEntries = Object.entries(sortSpec ?? {});
      if (sortEntries.length > 0) {
        matches.sort((left, right) => {
          for (const [path, direction] of sortEntries) {
            const comparison = compareSortValues(
              getNestedValue(left, path),
              getNestedValue(right, path),
            );
            if (comparison !== 0) return comparison * (direction ?? 1);
          }
          return 0;
        });
      }
      return typeof limitCount === 'number'
        ? matches.slice(0, limitCount)
        : matches;
    };

    const query = {
      sort(spec: Record<string, 1 | -1>) {
        sortSpec = spec;
        return query;
      },
      limit(count: number) {
        limitCount = count;
        return query;
      },
      lean: async () => execute(),
      exec: async () => execute(),
    };

    return query;
  }) as unknown as typeof TurnModel.find;
  TurnModel.findOne = (() => ({
    sort: () => ({
      lean: () => ({
        exec: async () => null,
      }),
    }),
  })) as typeof TurnModel.findOne;

  try {
    return await runWithTestEnvOverrides({ NODE_ENV: 'production' }, async () =>
      await params.run({ conversations, turns }),
    );
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReadyState,
      configurable: true,
    });
    ConversationModel.findById = originalFindById;
    ConversationModel.findOne = originalFindOne;
    ConversationModel.findByIdAndUpdate = originalFindByIdAndUpdate;
    ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
    TurnModel.find = originalTurnFind;
    TurnModel.findOne = originalTurnFindOne;
    TurnModel.create = originalTurnCreate;
  }
}
