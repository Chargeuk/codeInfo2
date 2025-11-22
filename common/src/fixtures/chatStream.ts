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

export const chatErrorEventFixture = {
  type: 'error',
  message: 'lmstudio unavailable',
};

export const chatSseFrameFixture = chatSseEventsFixture.map(
  (event) => `data: ${JSON.stringify(event)}\n\n`,
);
