import type { TurnSummary } from '../mongo/repo.js';

export class ForkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

export type NativeForkTurn = {
  id: string;
  completed: boolean;
  user: string;
  assistant: string;
  timestamp?: string;
  eventId?: string;
  nextEventId?: string;
};

export function lastIndex<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  for (let index = items.length - 1; index >= 0; index--)
    if (predicate(items[index])) return index;
  return -1;
}
export function last<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): T | undefined {
  return items[lastIndex(items, predicate)];
}

/** Match the existing client transcript tie breakers without reordering source DB history. */
export function orderForkDisplayHistory(turns: TurnSummary[]): TurnSummary[] {
  const priority = (role: TurnSummary['role']) =>
    role === 'system' ? 0 : role === 'user' ? 1 : 2;
  return turns.slice().sort((a, b) => {
    const time = a.createdAt.getTime() - b.createdAt.getTime();
    if (time) return time;
    if (a.displayOrder !== undefined && b.displayOrder !== undefined)
      return a.displayOrder - b.displayOrder;
    return (
      priority(a.role) - priority(b.role) || a.turnId.localeCompare(b.turnId)
    );
  });
}

export function selectForkSnapshot(
  turns: TurnSummary[],
  turnId?: string,
): TurnSummary[] {
  const selected = turnId
    ? turns.findIndex((turn) => turn.turnId === turnId)
    : lastIndex(
        turns,
        (turn) =>
          turn.role === 'assistant' && ['ok', 'warning'].includes(turn.status),
      );
  if (turnId && selected >= 0 && turns[selected].fork?.handover) {
    let responseIndex = selected - 1;
    while (responseIndex >= 0 && turns[responseIndex].fork?.handover)
      responseIndex--;
    if (
      responseIndex >= 0 &&
      turns[responseIndex].role === 'assistant' &&
      ['ok', 'warning'].includes(turns[responseIndex].status)
    ) {
      return turns.slice(0, selected + 1);
    }
  }
  if (
    selected < 0 ||
    turns[selected].role !== 'assistant' ||
    !['ok', 'warning'].includes(turns[selected].status)
  ) {
    throw new ForkError(
      'FORK_BOUNDARY_UNAVAILABLE',
      'Choose a stored, completed assistant response.',
    );
  }
  // A fork awaiting its first instruction may end in handovers, which are history,
  // not an unfinished model turn. Keep these only for a latest-point fork.
  let end = selected + 1;
  if (!turnId) {
    while (end < turns.length && turns[end].fork?.handover) end++;
  }
  return turns.slice(0, end);
}

const similar = (native: string, stored: string) => {
  const a = native.trim();
  const b = stored.trim();
  return !!b && (a === b || a.includes(b));
};

export function resolveForkBoundary(
  snapshot: TurnSummary[],
  native: NativeForkTurn[],
): {
  turn: NativeForkTurn;
  estimated: boolean;
} {
  const responses = snapshot.filter(
    (turn) =>
      turn.role === 'assistant' && ['ok', 'warning'].includes(turn.status),
  );
  const selected = responses.at(-1);
  if (!selected)
    throw new ForkError(
      'FORK_BOUNDARY_UNAVAILABLE',
      'No completed response is available.',
    );
  const exact = selected.native?.eventId
    ? native.find((turn) => turn.eventId === selected.native!.eventId)
    : selected.native?.turnId
      ? last(native, (turn) => turn.id === selected.native!.turnId)
      : undefined;
  if (exact?.completed)
    return { turn: exact, estimated: selected.native?.estimated === true };

  // Old records deliberately remain valid. Align in order so repeated prompts
  // and tied timestamps cannot silently select the first occurrence every time.
  let previous = -1;
  let match: NativeForkTurn | undefined;
  for (const response of responses) {
    const index = snapshot.indexOf(response);
    const prompt =
      last(
        snapshot.slice(0, index),
        (turn) => turn.role === 'user' && !turn.fork?.handover,
      )?.content ?? '';
    const candidates = native
      .map((turn, position) => ({ turn, position }))
      .filter(({ turn, position }) => position > previous && turn.completed);
    let chosen = candidates.find(
      ({ turn }) =>
        similar(turn.assistant, response.content) && similar(turn.user, prompt),
    );
    chosen ??= candidates.find(({ turn }) =>
      similar(turn.assistant, response.content),
    );
    chosen ??= candidates.find(({ turn }) => similar(turn.user, prompt));
    // Content can be compacted or transformed by the provider. Timestamp plus
    // surrounding order is still useful evidence; never invent a native ID.
    chosen ??= candidates
      .filter(
        ({ turn }) =>
          turn.timestamp && Number.isFinite(Date.parse(turn.timestamp)),
      )
      .sort(
        (a, b) =>
          Math.abs(
            Date.parse(a.turn.timestamp!) - response.createdAt.getTime(),
          ) -
          Math.abs(
            Date.parse(b.turn.timestamp!) - response.createdAt.getTime(),
          ),
      )[0];
    if (!chosen && response !== selected) continue;
    if (!chosen) {
      // Missing/compacted earlier exchanges must not disqualify a usable match
      // for the requested boundary. This remains explicitly estimated.
      const completed = native.filter((turn) => turn.completed);
      const fallback =
        last(
          completed,
          (turn) =>
            similar(turn.assistant, response.content) &&
            similar(turn.user, prompt),
        ) ??
        last(completed, (turn) => similar(turn.assistant, response.content)) ??
        last(completed, (turn) => similar(turn.user, prompt));
      if (fallback) return { turn: fallback, estimated: true };
      throw new ForkError(
        'FORK_HISTORY_UNAVAILABLE',
        'The native session has no usable match for this history point.',
      );
    }
    previous = chosen.position;
    match = chosen.turn;
  }
  if (!match)
    throw new ForkError(
      'FORK_HISTORY_UNAVAILABLE',
      'The native session history is unavailable.',
    );
  return { turn: match, estimated: true };
}
