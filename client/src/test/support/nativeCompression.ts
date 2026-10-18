import { Blob as NativeBlob } from 'node:buffer';
import { CompressionStream as NativeCompressionStream } from 'node:stream/web';
import { runInThisContext } from 'node:vm';
import { decodeJsonBody } from './decodeJsonBody';

const NativeResponse = runInThisContext('Response') as typeof Response;

// Scoped native APIs for compression proofs; the shared JSDOM polyfills stay unchanged.
export function installNativeCompression() {
  function bufferGate(matches: (body: Record<string, unknown>) => boolean) {
    let enter!: () => void;
    let release!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    return {
      matches,
      entered,
      released: new Promise<void>((resolve) => {
        release = resolve;
      }),
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      enter: () => enter(),
      release: () => release(),
      finish: () => finish(),
      used: false,
    };
  }
  const gates: ReturnType<typeof bufferGate>[] = [];
  class BufferedResponse extends NativeResponse {
    async arrayBuffer() {
      let gate: ReturnType<typeof bufferGate> | undefined;
      try {
        const bytes = await super.arrayBuffer();
        const signature = new Uint8Array(
          bytes,
          0,
          Math.min(2, bytes.byteLength),
        );
        if (
          gates.some((item) => !item.used) &&
          signature[0] === 0x1f &&
          signature[1] === 0x8b
        ) {
          const body = decodeJsonBody({
            body: bytes,
            headers: { 'Content-Encoding': 'gzip' },
          });
          gate = gates.find((item) => !item.used && item.matches(body));
        }
        if (gate) {
          gate.used = true;
          gate.enter();
          await gate.released;
        }
        return bytes;
      } finally {
        gate?.finish();
      }
    }
  }
  const values = {
    Blob: NativeBlob,
    CompressionStream: NativeCompressionStream,
    Response: BufferedResponse,
  };
  const descriptors = Object.fromEntries(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return {
    holdNextBuffer(
      matches: (body: Record<string, unknown>) => boolean = () => true,
    ) {
      const gate = bufferGate(matches);
      gates.push(gate);
      return gate;
    },
    async restore() {
      gates.forEach((gate) => gate.release());
      await Promise.all(
        gates.filter((gate) => gate.used).map((gate) => gate.finished),
      );
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
