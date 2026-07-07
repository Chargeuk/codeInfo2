import { getFetchMock, mockJsonResponse } from './support/fetchMock';
const mockFetch = getFetchMock();
beforeAll(() => {
    setScopedTestEnvValue("MODE", 'test');
    global.fetch = mockFetch;
});
beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockJsonResponse({
        status: 'started',
        flowName: 'daily',
        conversationId: 'c1',
        inflightId: 'i1',
        providerId: 'codex',
        modelId: 'gpt-5.2-codex',
    }, { status: 202 }));
});
const { runFlow } = await import('../api/flows');
describe('Flows API runFlow payload', () => {
    it('includes working_folder and resumeStepPath when provided', async () => {
        await runFlow({
            flowName: 'daily',
            working_folder: '/abs/path',
            resumeStepPath: [1, 0],
        });
        const [, init] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.working_folder).toBe('/abs/path');
        expect(body.resumeStepPath).toEqual([1, 0]);
    });
    it('includes retryOwnershipId for fresh runs and trims it before submission', async () => {
        await runFlow({
            flowName: 'daily',
            retryOwnershipId: '  retry-1  ',
            mode: 'run',
            isNewConversation: true,
        });
        const [, init] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.retryOwnershipId).toBe('retry-1');
    });
    it('omits optional payload fields when not provided', async () => {
        await runFlow({ flowName: 'daily' });
        const [, init] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).not.toHaveProperty('working_folder');
        expect(body).not.toHaveProperty('resumeStepPath');
        expect(body).not.toHaveProperty('retryOwnershipId');
    });
    it('includes customTitle only for new runs', async () => {
        await runFlow({
            flowName: 'daily',
            customTitle: '  Morning brief  ',
            isNewConversation: true,
            mode: 'run',
        });
        const [, init] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.customTitle).toBe('Morning brief');
    });
    it('omits customTitle for resumes or existing conversations', async () => {
        await runFlow({
            flowName: 'daily',
            customTitle: 'Resume title',
            isNewConversation: false,
            mode: 'resume',
            resumeStepPath: [0],
        });
        const [, init] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).not.toHaveProperty('customTitle');
        mockFetch.mockClear();
        await runFlow({
            flowName: 'daily',
            customTitle: 'Existing conversation',
            isNewConversation: false,
            mode: 'run',
        });
        const [, nextInit] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const nextBody = JSON.parse(nextInit.body as string) as Record<string, unknown>;
        expect(nextBody).not.toHaveProperty('customTitle');
    });
    it('omits retryOwnershipId for resumes even when a fresh-run retry token is present', async () => {
        await runFlow({
            flowName: 'daily',
            retryOwnershipId: 'retry-2',
            mode: 'resume',
            isNewConversation: false,
            resumeStepPath: [0],
        });
        const [, init] = mockFetch.mock.calls[0] as [
            unknown,
            RequestInit
        ];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).not.toHaveProperty('retryOwnershipId');
    });
    it('keeps providerId and warnings from the run-start payload instead of narrowing them away', async () => {
        mockFetch.mockResolvedValueOnce(mockJsonResponse({
            status: 'started',
            flowName: 'daily',
            conversationId: 'c1',
            inflightId: 'i1',
            providerId: 'lmstudio',
            modelId: 'model-1',
            warnings: ['fell back to lmstudio'],
        }, { status: 202 }));
        await expect(runFlow({ flowName: 'daily' })).resolves.toEqual({
            status: 'started',
            flowName: 'daily',
            conversationId: 'c1',
            inflightId: 'i1',
            providerId: 'lmstudio',
            modelId: 'model-1',
            warnings: ['fell back to lmstudio'],
        });
    });
});
