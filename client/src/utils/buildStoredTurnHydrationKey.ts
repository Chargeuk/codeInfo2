import type { StoredTurn } from '../hooks/useConversationTurns';

function hashText(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${hash}`;
}

function buildTurnSignature(turn: StoredTurn): string {
  const command = turn.command;
  return [
    turn.turnId ?? '',
    turn.role,
    turn.createdAt,
    turn.provider,
    turn.model,
    turn.status,
    hashText(turn.content),
    command?.name ?? '',
    command?.stepIndex ?? '',
    command?.totalSteps ?? '',
    command?.label ?? '',
  ].join('~');
}

export default function buildStoredTurnHydrationKey(
  conversationId: string,
  turns: StoredTurn[],
): string {
  return `${conversationId}::${turns.map(buildTurnSignature).join('|')}`;
}
