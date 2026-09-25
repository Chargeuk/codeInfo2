import assert from 'node:assert/strict';
import test from 'node:test';
import { runOpenAiWithRetry } from '../../ingest/providers/openaiRetry.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
test('OpenAI ingest retry path uses CODEINFO_OPENAI_INGEST_MAX_RETRIES override attempts', async () => {
    await runWithTestEnvOverrides({
        CODEINFO_OPENAI_INGEST_MAX_RETRIES: '1',
    }, async () => {
        let attempts = 0;
        await assert.rejects(() => runOpenAiWithRetry({
            model: 'text-embedding-3-small',
            inputCount: 2,
            tokenEstimate: 128,
            sleep: async () => { },
            runStep: async () => {
                attempts += 1;
                throw { status: 503, message: 'temporary upstream failure' };
            },
        }), () => true);
        // 1 retry after initial attempt => 2 total attempts.
        assert.equal(attempts, 2);
    });
});
