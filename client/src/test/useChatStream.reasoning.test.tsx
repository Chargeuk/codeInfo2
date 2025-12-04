import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import useChatStream, { type ChatMessage } from '../hooks/useChatStream';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

function Wrapper({
  prompt,
  onUpdate,
}: {
  prompt: string;
  onUpdate: (messages: ChatMessage[]) => void;
}) {
  const { messages, send } = useChatStream('m1', 'lmstudio');

  useEffect(() => {
    onUpdate(messages);
  }, [messages, onUpdate]);

  useEffect(() => {
    void send(prompt);
  }, [prompt, send]);

  return null;
}

const harmonyStream = () => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"token","content":"<|channel|>analysis<|message|>Need answer: Neil Armstrong."}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"<|channel|>analysis<|message|>Need answer: Neil Armstrong.<|end|><|start|>assistant<|channel|>final<|message|>He was the first person on the Moon."}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 20);
    },
  });
};

const thinkStream = () => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"token","content":"<think>Analyzing"}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode('data: {"type":"token","content":" steps"}\n\n'),
        );
      }, 10);
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"token","content":"</think>Final answer"}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 25);
    },
  });
};

const multiAnalysisFinalStream = () => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"token","content":"<|channel|>analysis<|message|>First part."}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"<|channel|>analysis<|message|>Second part.<|end|><|start|>assistant<|channel|>final<|message|>Visible answer."}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 10);
    },
  });
};

describe('useChatStream reasoning parsing', () => {
  it('splits Harmony analysis/final into hidden and visible buffers', async () => {
    const onUpdate = jest.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: harmonyStream(),
    });

    render(<Wrapper prompt="Tell me" onUpdate={onUpdate} />);

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = latest.find((msg) => msg.role === 'assistant');
      expect(assistant?.content).toContain(
        'He was the first person on the Moon.',
      );
    });

    const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
    const assistant = latest.find((msg) => msg.role === 'assistant');
    expect(assistant?.think).toContain('Need answer: Neil Armstrong.');
    expect(assistant?.thinkStreaming).toBe(false);
  });

  it('tracks <think> streaming then final text', async () => {
    const onUpdate = jest.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: thinkStream(),
    });

    render(<Wrapper prompt="hi" onUpdate={onUpdate} />);

    await waitFor(() => {
      const sawStreaming = onUpdate.mock.calls.some((call) =>
        (call[0] as ChatMessage[]).some(
          (msg) => msg.role === 'assistant' && msg.thinkStreaming,
        ),
      );
      expect(sawStreaming).toBe(true);
    });

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = latest.find((msg) => msg.role === 'assistant');
      expect(assistant?.content).toContain('Final answer');
    });

    const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
    const assistant = latest.find((msg) => msg.role === 'assistant');
    expect(assistant?.think).toContain('Analyzing steps');
    expect(assistant?.thinkStreaming).toBe(false);
  });

  it('keeps earlier analysis when final content includes another analysis block', async () => {
    const onUpdate = jest.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: multiAnalysisFinalStream(),
    });

    render(<Wrapper prompt="multi" onUpdate={onUpdate} />);

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = latest.find((msg) => msg.role === 'assistant');
      expect(assistant?.content).toContain('Visible answer.');
    });

    const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
    const assistant = latest.find((msg) => msg.role === 'assistant');
    expect(assistant?.think).toContain('First part.');
    expect(assistant?.think).toContain('Second part.');
  });
});
