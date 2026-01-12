export const chatRequestFixture = {
  model: 'llama-3',
  messages: [{ role: 'user', content: 'hello' }],
};

export const chatSseEventsFixture = [
  { type: 'token', content: 'Hi', roundIndex: 0 },
  {
    type: 'final',
    message: { role: 'assistant', content: 'Hi' },
    roundIndex: 0,
  },
  { type: 'complete' },
];

export const chatToolEventsFixture = [
  { type: 'predictionFragment', content: 'Tool call', roundIndex: 0 },
  {
    type: 'toolCallRequestStart',
    callId: 'call-1',
    name: 'VectorSearch',
    roundIndex: 0,
  },
  {
    type: 'toolCallRequestNameReceived',
    callId: 'call-1',
    name: 'VectorSearch',
    roundIndex: 0,
  },
  {
    type: 'toolCallRequestArgumentFragmentGenerated',
    callId: 'call-1',
    roundIndex: 0,
    content: '{"query":"fixture","limit":5}',
  },
  {
    type: 'toolCallRequestEnd',
    callId: 'call-1',
    roundIndex: 0,
  },
  {
    type: 'toolCallResult',
    callId: 'call-1',
    name: 'VectorSearch',
    roundIndex: 0,
    result: {
      modelId: 'embed-model',
      results: [
        {
          repo: 'repo',
          relPath: 'main.txt',
          hostPath: '/host/repo/main.txt',
          chunk: 'sample chunk',
          chunkId: 'chunk-1',
          score: 0.82,
          modelId: 'embed-model',
          lineCount: 1,
        },
        {
          repo: 'repo',
          relPath: 'main.txt',
          hostPath: '/host/repo/main.txt',
          chunk: 'second line',
          chunkId: 'chunk-2',
          score: 0.71,
          modelId: 'embed-model',
          lineCount: 1,
        },
      ],
      files: [
        {
          hostPath: '/host/repo/main.txt',
          highestMatch: 0.82,
          chunkCount: 2,
          lineCount: 2,
          repo: 'repo',
          modelId: 'embed-model',
        },
      ],
    },
  },
  {
    type: 'message',
    message: { role: 'assistant', content: 'Tool run complete' },
    roundIndex: 0,
  },
  { type: 'complete' },
];

export const chatErrorEventFixture = {
  type: 'error',
  message: 'lmstudio unavailable',
};

export const chatSseFrameFixture = chatSseEventsFixture.map(
  (event) => `data: ${JSON.stringify(event)}\n\n`,
);

export const chatWsInflightSnapshotFixture = {
  protocolVersion: 'v1',
  type: 'inflight_snapshot',
  conversationId: 'c1',
  seq: 1,
  inflight: {
    inflightId: 'i1',
    assistantText: '',
    assistantThink: '',
    toolEvents: [],
    startedAt: '2025-01-01T00:00:00.000Z',
    command: { name: 'improve_plan', stepIndex: 1, totalSteps: 4 },
  },
} as const;

export const chatWsAssistantDeltaFixture = {
  protocolVersion: 'v1',
  type: 'assistant_delta',
  conversationId: 'c1',
  seq: 2,
  inflightId: 'i1',
  delta: 'Hi',
} as const;

export const chatWsAnalysisDeltaFixture = {
  protocolVersion: 'v1',
  type: 'analysis_delta',
  conversationId: 'c1',
  seq: 3,
  inflightId: 'i1',
  delta: '<think>Reasoning</think>',
} as const;

export const chatWsToolEventFixture = {
  protocolVersion: 'v1',
  type: 'tool_event',
  conversationId: 'c1',
  seq: 4,
  inflightId: 'i1',
  event: {
    type: 'toolCallRequestStart',
    callId: 'call-1',
    name: 'VectorSearch',
    roundIndex: 0,
  },
} as const;

export const chatWsTurnFinalFixture = {
  protocolVersion: 'v1',
  type: 'turn_final',
  conversationId: 'c1',
  seq: 5,
  inflightId: 'i1',
  status: 'ok',
  threadId: null,
  usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
  timing: { totalTimeSec: 0.6, tokensPerSecond: 20 },
} as const;
