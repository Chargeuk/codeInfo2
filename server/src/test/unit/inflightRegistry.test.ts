import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupInflight,
  createInflight,
} from '../../chat/inflightRegistry.js';

test('cleanupInflight detaches shared external abort listeners after successful child cleanup', () => {
  const conversationId = 'inflight-external-abort-cleanup';
  cleanupInflight({ conversationId });

  const externalController = new AbortController();
  const originalAdd = externalController.signal.addEventListener.bind(
    externalController.signal,
  ) as (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const originalRemove = externalController.signal.removeEventListener.bind(
    externalController.signal,
  ) as (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;

  let addedListener: EventListener | null = null;
  let removedListener: EventListener | null = null;
  let addCalls = 0;
  let removeCalls = 0;

  externalController.signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'abort' && listener) {
      addCalls += 1;
      addedListener = listener as EventListener;
    }
    return originalAdd(
      type,
      listener as EventListenerOrEventListenerObject,
      options,
    );
  }) as AbortSignal['addEventListener'];

  externalController.signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'abort' && listener) {
      removeCalls += 1;
      removedListener = listener as EventListener;
    }
    return originalRemove(
      type,
      listener as EventListenerOrEventListenerObject,
      options,
    );
  }) as AbortSignal['removeEventListener'];

  const inflight = createInflight({
    conversationId,
    inflightId: 'inflight-1',
    externalSignal: externalController.signal,
  });
  inflight.finalStatus = 'ok';

  cleanupInflight({ conversationId, inflightId: 'inflight-1' });

  assert.equal(addCalls, 1);
  assert.equal(removeCalls, 1);
  assert.equal(removedListener, addedListener);

  externalController.abort();
  assert.equal(inflight.abortController.signal.aborted, false);
});
