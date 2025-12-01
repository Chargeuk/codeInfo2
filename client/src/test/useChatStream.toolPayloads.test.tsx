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
  stream,
  onUpdate,
}: {
  prompt: string;
  stream: ReadableStream<Uint8Array>;
  onUpdate: (messages: ChatMessage[]) => void;
}) {
  const { messages, send } = useChatStream('m1');

  useEffect(() => {
    onUpdate(messages);
  }, [messages, onUpdate]);

  useEffect(() => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });
    void send(prompt);
  }, [prompt, send, stream]);

  return null;
}

const encoder = new TextEncoder();

const successStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"c1","name":"VectorSearch"}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-result","callId":"c1","name":"VectorSearch","stage":"success","parameters":{"query":"hi","limit":5},"result":{"parameters":{"query":"hi","limit":5},"results":[{"repo":"repo","relPath":"file.txt","hostPath":"/host/file.txt","chunk":"sample chunk","chunkId":"chunk-1","score":0.82,"modelId":"embed","lineCount":1}],"modelId":"embed","files":[{"hostPath":"/host/file.txt","highestMatch":0.82,"chunkCount":1,"lineCount":1,"modelId":"embed","repo":"repo"}]}}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"final","message":{"role":"assistant","content":"done"}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
      controller.close();
    },
  });

const errorStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"c2","name":"VectorSearch"}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"c2","name":"VectorSearch","stage":"error","parameters":{"query":"fail"},"errorTrimmed":{"code":"MODEL_UNAVAILABLE","message":"embedding model missing"},"errorFull":{"code":"MODEL_UNAVAILABLE","message":"embedding model missing"}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"after failure"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 10);
    },
  });

describe('useChatStream tool payload handling', () => {
  it('stores parameters and aggregated VectorSearch payloads', async () => {
    const onUpdate = jest.fn();

    render(
      <Wrapper prompt="Hello" stream={successStream()} onUpdate={onUpdate} />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.tools?.[0].status).toBe('done');
      expect(assistant?.tools?.[0].parameters).toEqual({
        query: 'hi',
        limit: 5,
      });
      const payload = assistant?.tools?.[0].payload as
        | {
            files?: Array<{ lineCount?: number }>;
            results?: Array<{ lineCount?: number }>;
          }
        | undefined;
      expect(payload?.results?.[0].lineCount).toBe(1);
      expect(payload?.files?.[0].chunkCount).toBe(1);
    });
  });

  it('stores trimmed and full errors for tool failures', async () => {
    const onUpdate = jest.fn();

    render(<Wrapper prompt="Hi" stream={errorStream()} onUpdate={onUpdate} />);

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.tools?.[0].status).toBe('error');
      expect(assistant?.tools?.[0].parameters).toEqual({ query: 'fail' });
      expect(assistant?.tools?.[0].errorTrimmed).toEqual({
        code: 'MODEL_UNAVAILABLE',
        message: 'embedding model missing',
      });
      expect(assistant?.tools?.[0].errorFull).toBeDefined();
    });
  });
});
