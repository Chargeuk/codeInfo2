import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INGEST_MAX_QUEUE_SIZE, DEFAULT_LMSTUDIO_MAX_BATCH_SIZE, DEFAULT_LMSTUDIO_MAX_INFLIGHT, DEFAULT_OPENAI_MAX_BATCH_SIZE, DEFAULT_OPENAI_MAX_INFLIGHT, MAX_LMSTUDIO_BATCH_SIZE, MAX_LMSTUDIO_INFLIGHT, MAX_OPENAI_INFLIGHT, resolveConfig, } from '../../ingest/config.js';
import { OPENAI_MAX_INPUTS_PER_REQUEST } from '../../ingest/providers/index.js';
function withEnv(values: Record<string, string | undefined>, run: () => void | Promise<void>) {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key]);
        if (value === undefined) {
            clearScopedTestEnvValue(key);
        }
        else {
            setScopedTestEnvValue(key, value);
        }
    }
    const cleanup = () => {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                clearScopedTestEnvValue(key);
            }
            else {
                setScopedTestEnvValue(key, value);
            }
        }
    };
    try {
        const result = run();
        if (result && typeof (result as Promise<void>).then === 'function') {
            return (result as Promise<void>).finally(cleanup);
        }
        cleanup();
        return result;
    }
    catch (error) {
        cleanup();
        throw error;
    }
}
test('provider dispatch settings resolve to Story 54 defaults', () => {
    withEnv({
        CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE: undefined,
        CODEINFO_INGEST_OPENAI_MAX_INFLIGHT: undefined,
        CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE: undefined,
        CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT: undefined,
        CODEINFO_INGEST_MAX_QUEUE_SIZE: undefined,
    }, () => {
        const config = resolveConfig();
        assert.equal(config.openAiMaxBatchSize, DEFAULT_OPENAI_MAX_BATCH_SIZE);
        assert.equal(config.openAiMaxInFlight, DEFAULT_OPENAI_MAX_INFLIGHT);
        assert.equal(config.lmStudioMaxBatchSize, DEFAULT_LMSTUDIO_MAX_BATCH_SIZE);
        assert.equal(config.lmStudioMaxInFlight, DEFAULT_LMSTUDIO_MAX_INFLIGHT);
        assert.equal(config.maxQueueSize, DEFAULT_INGEST_MAX_QUEUE_SIZE);
    });
});
test('provider dispatch settings clamp to supported effective values', () => {
    withEnv({
        CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE: '999999',
        CODEINFO_INGEST_OPENAI_MAX_INFLIGHT: '999',
        CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE: '999',
        CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT: '999',
    }, () => {
        const config = resolveConfig();
        assert.equal(config.openAiMaxBatchSize, OPENAI_MAX_INPUTS_PER_REQUEST);
        assert.equal(config.openAiMaxInFlight, MAX_OPENAI_INFLIGHT);
        assert.equal(config.lmStudioMaxBatchSize, MAX_LMSTUDIO_BATCH_SIZE);
        assert.equal(config.lmStudioMaxInFlight, MAX_LMSTUDIO_INFLIGHT);
    });
});
test('queue cap preserves -1, 0, and positive integers', () => {
    withEnv({ CODEINFO_INGEST_MAX_QUEUE_SIZE: '-1' }, () => {
        assert.equal(resolveConfig().maxQueueSize, -1);
    });
    withEnv({ CODEINFO_INGEST_MAX_QUEUE_SIZE: '0' }, () => {
        assert.equal(resolveConfig().maxQueueSize, 0);
    });
    withEnv({ CODEINFO_INGEST_MAX_QUEUE_SIZE: '7' }, () => {
        assert.equal(resolveConfig().maxQueueSize, 7);
    });
});
test('token margin treats blank input as unset and clamps to a safe range', () => {
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: undefined }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 0.85);
    });
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: '' }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 0.85);
    });
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: '   ' }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 0.85);
    });
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: '0' }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 0.85);
    });
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: '-1' }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 0.85);
    });
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: '0.9' }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 0.9);
    });
    withEnv({ CODEINFO_INGEST_TOKEN_MARGIN: '1.2' }, () => {
        assert.equal(resolveConfig().tokenSafetyMargin, 1);
    });
});
