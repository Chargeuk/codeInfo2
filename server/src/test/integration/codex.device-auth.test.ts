import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import express from 'express';
import supertest from 'supertest';
import type { CodexDetection } from '../../providers/codexRegistry.js';
import { createCodexDeviceAuthRouter } from '../../routes/codexDeviceAuth.js';
import type { CodexDeviceAuthCompletion, CodexDeviceAuthResult, CodexDeviceAuthResultWithCompletion, CodexDeviceAuthVerificationReady, } from '../../utils/codexDeviceAuth.js';
import { createCodexCompletedResponse, createCodexFailedResponse, createCodexVerificationReadyResponse, } from '../../utils/codexDeviceAuth.js';
function buildApp(deps?: Parameters<typeof createCodexDeviceAuthRouter>[0]) {
    const app = express();
    app.use('/codex', createCodexDeviceAuthRouter(deps));
    return app;
}
const defaultDetection: CodexDetection = {
    available: false,
    authPresent: false,
    configPresent: true,
    reason: 'auth missing',
};
const availableDetection: CodexDetection = {
    available: true,
    authPresent: true,
    configPresent: true,
};
type DeviceAuthResult = CodexDeviceAuthResultWithCompletion;
function buildDeviceAuthResult(result: CodexDeviceAuthResult, completionResult: CodexDeviceAuthCompletion['result'] | undefined = result.state === 'verification_ready'
    ? createCodexCompletedResponse()
    : result, exitCode = completionResult.state === 'completed' ||
    completionResult.state === 'already_authenticated'
    ? 0
    : 1): DeviceAuthResult {
    return {
        ...result,
        completion: Promise.resolve({ exitCode, result: completionResult }),
    };
}
function verificationReadyResult(overrides?: Partial<CodexDeviceAuthVerificationReady>): CodexDeviceAuthVerificationReady {
    return createCodexVerificationReadyResponse({
        verificationUrl: overrides?.verificationUrl ?? 'https://device.test/verify',
        displayOutput: overrides?.displayOutput ??
            'Open https://device.test/verify and enter code CODE-123.',
    });
}
function withDeps(overrides?: Partial<Parameters<typeof createCodexDeviceAuthRouter>[0]>): Parameters<typeof createCodexDeviceAuthRouter>[0] {
    return {
        discoverAgents: async () => [],
        propagateAgentAuthFromPrimary: async () => ({ agentCount: 0 }),
        refreshCodexDetection: () => defaultDetection,
        getCodexHome: () => '/tmp/codex-home',
        ensureCodexAuthFileStore: async (configPath: string) => ({
            changed: false,
            configPath,
        }),
        getCodexConfigPathForHome: (home: string) => `${home}/config.toml`,
        runCodexDeviceAuth: async () => buildDeviceAuthResult(verificationReadyResult()),
        resolveCodexCli: () => ({ available: true }),
        ...overrides,
    };
}
describe('POST /codex/device-auth', () => {
    test('returns verification data for empty object request', async () => {
        let receivedHome: string | undefined;
        const res = await supertest(buildApp(withDeps({
            runCodexDeviceAuth: async (params) => {
                receivedHome = params?.codexHome;
                return buildDeviceAuthResult(verificationReadyResult());
            },
        })))
            .post('/codex/device-auth')
            .send({});
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, {
            provider: 'codex',
            state: 'verification_ready',
            verificationUrl: 'https://device.test/verify',
            displayOutput: 'Open https://device.test/verify and enter code CODE-123.',
        });
        assert.equal(receivedHome, undefined);
    });
    test('keeps the shared auth flow pending after verification details are returned', async () => {
        let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
        const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
            resolveCompletion = resolve;
        });
        const app = buildApp(withDeps({
            runCodexDeviceAuth: async () => ({
                ...verificationReadyResult(),
                completion,
            }),
        }));
        const first = await supertest(app).post('/codex/device-auth').send({});
        const second = await supertest(app).post('/codex/device-auth').send({});
        assert.equal(first.status, 200);
        assert.equal(first.body.state, 'verification_ready');
        assert.equal(second.status, 200);
        assert.deepEqual(second.body, {
            provider: 'codex',
            state: 'completion_pending',
            verificationUrl: 'https://device.test/verify',
            displayOutput: 'Open https://device.test/verify and enter code CODE-123.',
        });
        resolveCompletion({ exitCode: 0, result: createCodexCompletedResponse() });
    });
    test('completed auth can be retried even when runtime detection now sees existing auth', async () => {
        let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
        const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
            resolveCompletion = resolve;
        });
        let refreshCalls = 0;
        const app = buildApp(withDeps({
            refreshCodexDetection: () => {
                refreshCalls += 1;
                return refreshCalls === 1 ? defaultDetection : availableDetection;
            },
            runCodexDeviceAuth: async () => ({
                ...verificationReadyResult(),
                completion,
            }),
        }));
        await supertest(app).post('/codex/device-auth').send({}).expect(200);
        resolveCompletion({ exitCode: 0, result: createCodexCompletedResponse() });
        await new Promise((resolve) => setImmediate(resolve));
        const refreshed = await supertest(app).post('/codex/device-auth').send({});
        assert.equal(refreshed.status, 200);
        assert.deepEqual(refreshed.body, {
            provider: 'codex',
            state: 'verification_ready',
            verificationUrl: 'https://device.test/verify',
            detectedAuthState: 'already_authenticated',
            displayOutput: 'Open https://device.test/verify and enter code CODE-123.',
        });
    });
    test('selector fields are rejected with 400 invalid_request', async () => {
        const payloads = [
            { target: 'chat' },
            { target: 'agent' },
            { target: 'agent', agentName: 'coding_agent' },
            { agentName: 'coding_agent' },
        ];
        for (const payload of payloads) {
            const res = await supertest(buildApp())
                .post('/codex/device-auth')
                .send(payload);
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, {
                error: 'invalid_request',
                message: 'request body must be an empty JSON object',
            });
        }
    });
    test('unknown non-empty fields are rejected with 400 invalid_request', async () => {
        const res = await supertest(buildApp())
            .post('/codex/device-auth')
            .send({ foo: 'bar' });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, {
            error: 'invalid_request',
            message: 'request body must be an empty JSON object',
        });
    });
    test('non-object bodies are rejected with deterministic invalid_request payload', async () => {
        const payloads: unknown[] = [null, [], 'hello', 123];
        for (const payload of payloads) {
            const res = await supertest(buildApp())
                .post('/codex/device-auth')
                .set('content-type', 'application/json')
                .send(JSON.stringify(payload));
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, {
                error: 'invalid_request',
                message: 'request body must be an empty JSON object',
            });
        }
    });
    test('codex unavailable returns unavailable-before-start shared auth state', async () => {
        const res = await supertest(buildApp(withDeps({
            resolveCodexCli: () => ({
                available: false,
                reason: 'codex not found',
            }),
            runCodexDeviceAuth: async () => {
                throw new Error('should not run');
            },
        })))
            .post('/codex/device-auth')
            .send({});
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, {
            provider: 'codex',
            state: 'unavailable_before_start',
            reason: 'codex not found',
        });
    });
    test('device-auth parse error returns failed shared auth state', async () => {
        const res = await supertest(buildApp(withDeps({
            runCodexDeviceAuth: async () => buildDeviceAuthResult(createCodexFailedResponse('device auth output not recognized')),
        })))
            .post('/codex/device-auth')
            .send({});
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, {
            provider: 'codex',
            state: 'failed',
            reason: 'device auth output not recognized',
        });
    });
    test('clears terminal cached auth states before starting a new auth run', async () => {
        let authAttempt = 0;
        const runCodexDeviceAuth = mock.fn(async () => {
            authAttempt += 1;
            return authAttempt === 1
                ? buildDeviceAuthResult(createCodexFailedResponse('device auth output not recognized'))
                : buildDeviceAuthResult(verificationReadyResult());
        });
        const app = buildApp(withDeps({
            runCodexDeviceAuth,
        }));
        const first = await supertest(app).post('/codex/device-auth').send({});
        const second = await supertest(app).post('/codex/device-auth').send({});
        assert.equal(first.status, 200);
        assert.deepEqual(first.body, {
            provider: 'codex',
            state: 'failed',
            reason: 'device auth output not recognized',
        });
        assert.equal(second.status, 200);
        assert.deepEqual(second.body, {
            provider: 'codex',
            state: 'verification_ready',
            verificationUrl: 'https://device.test/verify',
            displayOutput: 'Open https://device.test/verify and enter code CODE-123.',
        });
        assert.equal(runCodexDeviceAuth.mock.calls.length, 2);
    });
    test('already-authenticated runtime detection is advisory and still allows a fresh auth flow', async () => {
        const runCodexDeviceAuth = mock.fn(async () => buildDeviceAuthResult(verificationReadyResult()));
        const res = await supertest(buildApp(withDeps({
            refreshCodexDetection: () => availableDetection,
            runCodexDeviceAuth,
        })))
            .post('/codex/device-auth')
            .send({});
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, {
            provider: 'codex',
            state: 'verification_ready',
            verificationUrl: 'https://device.test/verify',
            detectedAuthState: 'already_authenticated',
            displayOutput: 'Open https://device.test/verify and enter code CODE-123.',
        });
        assert.equal(runCodexDeviceAuth.mock.calls.length, 1);
    });
    test('oversized payload returns standardized invalid_request contract', async () => {
        const prevLimit = process.env.CODEINFO_LOG_MAX_CLIENT_BYTES;
        setScopedTestEnvValue("CODEINFO_LOG_MAX_CLIENT_BYTES", '10');
        try {
            const res = await supertest(buildApp())
                .post('/codex/device-auth')
                .send({ extra: 'toolarge' });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, {
                error: 'invalid_request',
                message: 'request body exceeds maximum size',
            });
            assert.equal('reason' in res.body, false);
            assert.equal(res.body.error === 'payload too large', false);
        }
        finally {
            if (prevLimit === undefined) {
                clearScopedTestEnvValue("CODEINFO_LOG_MAX_CLIENT_BYTES");
            }
            else {
                setScopedTestEnvValue("CODEINFO_LOG_MAX_CLIENT_BYTES", prevLimit);
            }
        }
    });
    test('propagates auth only after completion resolves', async () => {
        let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
        const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
            resolveCompletion = resolve;
        });
        const successResult = verificationReadyResult();
        const propagateAgentAuthFromPrimary = mock.fn(async () => ({
            agentCount: 1,
        }));
        let refreshCalls = 0;
        const refreshCodexDetection = mock.fn(() => {
            refreshCalls += 1;
            return refreshCalls === 1 ? defaultDetection : availableDetection;
        });
        const res = await supertest(buildApp(withDeps({
            propagateAgentAuthFromPrimary,
            refreshCodexDetection,
            runCodexDeviceAuth: async () => ({
                ...successResult,
                completion,
            }),
        })))
            .post('/codex/device-auth')
            .send({});
        assert.equal(res.status, 200);
        assert.equal(res.body.state, 'verification_ready');
        assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 0);
        assert.equal(refreshCodexDetection.mock.calls.length, 1);
        resolveCompletion({ exitCode: 0, result: createCodexCompletedResponse() });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 1);
        assert.equal(refreshCodexDetection.mock.calls.length, 2);
    });
    test('overlapping requests reuse one auth run and keep side effects idempotent', async () => {
        let resolveRun!: (value: DeviceAuthResult) => void;
        const runPromise = new Promise<DeviceAuthResult>((resolve) => {
            resolveRun = resolve;
        });
        let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
        const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
            resolveCompletion = resolve;
        });
        const successResult = verificationReadyResult();
        const runCodexDeviceAuth = mock.fn(async () => runPromise);
        const propagateAgentAuthFromPrimary = mock.fn(async () => ({
            agentCount: 2,
        }));
        let authCompleted = false;
        const refreshCodexDetection = mock.fn(() => authCompleted ? availableDetection : defaultDetection);
        const app = buildApp(withDeps({
            runCodexDeviceAuth,
            propagateAgentAuthFromPrimary,
            refreshCodexDetection,
        }));
        const reqA = supertest(app)
            .post('/codex/device-auth')
            .send({})
            .then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 25));
        const reqB = supertest(app)
            .post('/codex/device-auth')
            .send({})
            .then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 25));
        resolveRun({
            ...successResult,
            completion,
        });
        const [resA, resB] = await Promise.all([reqA, reqB]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
        assert.deepEqual(resA.body, {
            provider: 'codex',
            state: 'verification_ready',
            verificationUrl: 'https://device.test/verify',
            displayOutput: 'Open https://device.test/verify and enter code CODE-123.',
        });
        assert.deepEqual(resA.body, resB.body);
        assert.equal(runCodexDeviceAuth.mock.calls.length, 1);
        assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 0);
        assert.equal(refreshCodexDetection.mock.calls.length, 2);
        authCompleted = true;
        resolveCompletion({ exitCode: 0, result: createCodexCompletedResponse() });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 1);
        assert.equal(refreshCodexDetection.mock.calls.length, 3);
    });
    test('emits deterministic T10 success log for strict contract happy path', async () => {
        const infoMock = mock.method(console, 'info', () => { });
        try {
            const res = await supertest(buildApp(withDeps()))
                .post('/codex/device-auth')
                .send({});
            assert.equal(res.status, 200);
            const successCall = infoMock.mock.calls.find((call) => typeof call.arguments[0] === 'string' &&
                call.arguments[0].startsWith('[DEV-0000037][T10] event=device_auth_contract_validated result=success'));
            assert.ok(successCall);
        }
        finally {
            infoMock.mock.restore();
        }
    });
    test('emits deterministic T10 error log for strict contract failures', async () => {
        const errorMock = mock.method(console, 'error', () => { });
        try {
            const res = await supertest(buildApp())
                .post('/codex/device-auth')
                .send({ target: 'chat' });
            assert.equal(res.status, 400);
            const errorCall = errorMock.mock.calls.find((call) => typeof call.arguments[0] === 'string' &&
                call.arguments[0].startsWith('[DEV-0000037][T10] event=device_auth_contract_validated result=error'));
            assert.ok(errorCall);
        }
        finally {
            errorMock.mock.restore();
        }
    });
    test('device-auth error logs remain secret-safe and exclude raw token-like output', async () => {
        const secretLikeToken = 'sk-test-secret-token-should-not-leak';
        const errorMock = mock.method(console, 'error', () => { });
        try {
            const res = await supertest(buildApp(withDeps({
                runCodexDeviceAuth: async () => buildDeviceAuthResult(createCodexFailedResponse(`${secretLikeToken} device auth command failed`)),
            })))
                .post('/codex/device-auth')
                .send({});
            assert.equal(res.status, 200);
            const loggedLines = errorMock.mock.calls
                .map((call) => call.arguments.map(String).join(' '))
                .join('\n');
            assert.equal(loggedLines.includes(secretLikeToken), false);
        }
        finally {
            errorMock.mock.restore();
        }
    });
    test('emits deterministic T11 success log after completion side effects', async () => {
        let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
        const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
            resolveCompletion = resolve;
        });
        const successResult = verificationReadyResult();
        let refreshCalls = 0;
        const infoMock = mock.method(console, 'info', () => { });
        try {
            const res = await supertest(buildApp(withDeps({
                refreshCodexDetection: () => {
                    refreshCalls += 1;
                    return refreshCalls === 1 ? defaultDetection : availableDetection;
                },
                runCodexDeviceAuth: async () => ({
                    ...successResult,
                    completion,
                }),
            })))
                .post('/codex/device-auth')
                .send({});
            assert.equal(res.status, 200);
            resolveCompletion({
                exitCode: 0,
                result: createCodexCompletedResponse(),
            });
            await new Promise((resolve) => setImmediate(resolve));
            const successCall = infoMock.mock.calls.find((call) => typeof call.arguments[0] === 'string' &&
                call.arguments[0].startsWith('[DEV-0000037][T11] event=device_auth_concurrency_and_side_effects_completed result=success'));
            assert.ok(successCall);
        }
        finally {
            infoMock.mock.restore();
        }
    });
    test('emits deterministic T11 error log for completion side-effect failures', async () => {
        const errorMock = mock.method(console, 'error', () => { });
        try {
            const res = await supertest(buildApp(withDeps({
                runCodexDeviceAuth: async () => buildDeviceAuthResult(createCodexFailedResponse('device auth command failed')),
            })))
                .post('/codex/device-auth')
                .send({});
            assert.equal(res.status, 200);
            await new Promise((resolve) => setImmediate(resolve));
            const errorCall = errorMock.mock.calls.find((call) => typeof call.arguments[0] === 'string' &&
                call.arguments[0].startsWith('[DEV-0000037][T11] event=device_auth_concurrency_and_side_effects_completed result=error'));
            assert.ok(errorCall);
        }
        finally {
            errorMock.mock.restore();
        }
    });
});
