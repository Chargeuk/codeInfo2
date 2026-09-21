import assert from 'node:assert/strict';
import test from 'node:test';
import { getControlledEmbeddingWaiterCount, getLastControlledEmbeddingState, getLastPredictionState, MockLMStudioClient, startMock, stopMock, waitForControlledEmbeddingCalls, } from '../support/mockLmStudioSdk.js';
const ORIGINAL_LMSTUDIO_BASE_URL = process.env.CODEINFO_LMSTUDIO_BASE_URL;
test.beforeEach(() => {
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
});
test.afterEach(() => {
    stopMock();
    if (ORIGINAL_LMSTUDIO_BASE_URL === undefined) {
        clearScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL");
    }
    else {
        setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", ORIGINAL_LMSTUDIO_BASE_URL);
    }
});
test('controlled embedding waiters are cleaned up after timeout', async () => {
    startMock({ scenario: 'controlled-embedding' });
    await assert.rejects(() => waitForControlledEmbeddingCalls(1, 5), /Timed out waiting for 1 controlled embedding call/u);
    assert.equal(getControlledEmbeddingWaiterCount(), 0);
});
test('pre-aborted chat prediction marks the helper cancelled immediately', async () => {
    startMock({ scenario: 'chat-stream' });
    const controller = new AbortController();
    controller.abort();
    const client = new MockLMStudioClient();
    const model = await client.llm.model('chat-model');
    await model.act([], [], { signal: controller.signal });
    const state = getLastPredictionState();
    assert.ok(state);
    assert.equal(state.cancelled, true);
    assert.equal(state.emittedEventCount, 0);
    assert.equal(state.roundStartCount, 0);
});
test('pre-aborted chat prediction emits no delayed callbacks or chunks', async () => {
    startMock({ scenario: 'chat-stream' });
    const controller = new AbortController();
    controller.abort();
    const fragments: unknown[] = [];
    const messages: unknown[] = [];
    const rounds: number[] = [];
    const client = new MockLMStudioClient();
    const model = await client.llm.model('chat-model');
    await model.act([], [], {
        signal: controller.signal,
        onPredictionFragment: (fragment: unknown) => {
            fragments.push(fragment);
        },
        onMessage: (message: unknown) => {
            messages.push(message);
        },
        onRoundStart: (roundIndex: number) => {
            rounds.push(roundIndex);
        },
    });
    const state = getLastPredictionState();
    assert.ok(state);
    assert.deepEqual(fragments, []);
    assert.deepEqual(messages, []);
    assert.deepEqual(rounds, []);
    assert.equal(state.emittedEventCount, 0);
    assert.equal(state.roundStartCount, 0);
});
test('pre-aborted chat prediction completes its cleanup boundary before returning', async () => {
    startMock({ scenario: 'chat-stream' });
    const controller = new AbortController();
    controller.abort();
    const client = new MockLMStudioClient();
    const model = await client.llm.model('chat-model');
    await model.act([], [], { signal: controller.signal });
    const state = getLastPredictionState();
    assert.ok(state);
    assert.equal(state.cancelled, true);
    assert.equal(state.abortListenerRemoved, true);
});
test('non-aborted chat prediction still emits output and clears helper cleanup state', async () => {
    startMock({ scenario: 'chat-stream' });
    const fragments: unknown[] = [];
    const messages: unknown[] = [];
    const rounds: number[] = [];
    const client = new MockLMStudioClient();
    const model = await client.llm.model('chat-model');
    const result = await model.act([], [], {
        onPredictionFragment: (fragment: unknown) => {
            fragments.push(fragment);
        },
        onMessage: (message: unknown) => {
            messages.push(message);
        },
        onRoundStart: (roundIndex: number) => {
            rounds.push(roundIndex);
        },
    });
    const state = getLastPredictionState();
    assert.ok(state);
    assert.equal(state.cancelled, false);
    assert.ok(fragments.length > 0);
    assert.ok(messages.length > 0);
    assert.ok(rounds.length > 0);
    assert.ok(state.emittedEventCount > 0);
    assert.ok(state.roundStartCount > 0);
    assert.equal(state.abortListenerRemoved, true);
    assert.ok(result.rounds > 0);
});
test('pre-aborted controlled embed short-circuits before registering live work', async () => {
    startMock({ scenario: 'controlled-embedding' });
    const controller = new AbortController();
    controller.abort();
    const client = new MockLMStudioClient();
    const model = await client.embedding.model('embed-model');
    await model.embed('hello world', { signal: controller.signal });
    const state = getLastControlledEmbeddingState();
    assert.ok(state);
    assert.equal(state.preAborted, true);
    assert.equal(state.liveWorkRegistered, false);
    await assert.rejects(() => waitForControlledEmbeddingCalls(1, 5), /Timed out waiting for 1 controlled embedding call/u);
});
test('pre-aborted controlled embed returns the mock short-circuit shape without rejection', async () => {
    startMock({ scenario: 'controlled-embedding' });
    const controller = new AbortController();
    controller.abort();
    const client = new MockLMStudioClient();
    const model = await client.embedding.model('embed-model');
    await assert.doesNotReject(async () => {
        const result = await model.embed('hello world', {
            signal: controller.signal,
        });
        assert.deepEqual(result, { modelKey: 'embed-model', embedding: [] });
    });
});
test('pre-aborted controlled embed clears abort-listener cleanup state before return', async () => {
    startMock({ scenario: 'controlled-embedding' });
    const controller = new AbortController();
    controller.abort();
    const client = new MockLMStudioClient();
    const model = await client.embedding.model('embed-model');
    await model.embed('hello world', { signal: controller.signal });
    const state = getLastControlledEmbeddingState();
    assert.ok(state);
    assert.equal(state.abortListenerRemoved, true);
    assert.equal(getControlledEmbeddingWaiterCount(), 0);
});
