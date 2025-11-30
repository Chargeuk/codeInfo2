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
    type: 'toolCallResult',
    callId: 'call-1',
    name: 'VectorSearch',
    roundIndex: 0,
    result: {
      results: [
        {
          repo: 'repo',
          relPath: 'main.txt',
          hostPath: '/host/repo/main.txt',
          chunk: 'sample chunk',
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
