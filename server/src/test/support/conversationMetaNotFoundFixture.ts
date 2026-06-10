import mongoose from 'mongoose';

import type { Conversation } from '../../mongo/conversation.js';
import { ConversationModel } from '../../mongo/conversation.js';

type CapturedMetaUpdate = {
  filter: unknown;
  update: unknown;
};

const cloneConversation = (conversation: Conversation): Conversation =>
  structuredClone(conversation) as Conversation;

export async function withConversationMetaNotFoundFixture<T>(params: {
  seedConversation: Conversation;
  run: (state: {
    conversations: Map<string, Conversation>;
    capturedUpdates: CapturedMetaUpdate[];
  }) => Promise<T>;
}): Promise<T> {
  const conversations = new Map<string, Conversation>([
    [params.seedConversation._id, cloneConversation(params.seedConversation)],
  ]);
  const capturedUpdates: CapturedMetaUpdate[] = [];

  const originalReadyState = mongoose.connection.readyState;
  const originalFindById = ConversationModel.findById;
  const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;

  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  ConversationModel.findById = ((id: unknown) => ({
    lean: () => ({
      exec: async () => conversations.get(String(id)) ?? null,
    }),
    exec: async () => conversations.get(String(id)) ?? null,
  })) as typeof ConversationModel.findById;

  ConversationModel.findOneAndUpdate = ((
    filter: unknown,
    update: unknown,
  ) => ({
    exec: async () => {
      capturedUpdates.push({ filter, update });
      conversations.delete(params.seedConversation._id);
      return null;
    },
  })) as typeof ConversationModel.findOneAndUpdate;

  try {
    return await params.run({ conversations, capturedUpdates });
  } finally {
    ConversationModel.findById = originalFindById;
    ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReadyState,
      configurable: true,
    });
  }
}
