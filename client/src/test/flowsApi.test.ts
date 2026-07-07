import { getFetchMock, mockJsonResponse } from './support/fetchMock';
const mockFetch = getFetchMock();
beforeAll(() => {
    global.fetch = mockFetch;
});
beforeEach(() => {
    setScopedTestEnvValue("MODE", 'test');
    mockFetch.mockReset();
});
const { listFlows, getFlowDetails, runFlow } = await import('../api/flows');
describe('Flows API helpers', () => {
    it('calls GET /flows for listFlows', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({ flows: [] }));
        await listFlows();
        const [url, init] = mockFetch.mock.calls[0] as [
            string,
            RequestInit?
        ];
        expect(new URL(url).pathname).toBe('/flows');
        expect(init).toBeUndefined();
    });
    it('returns parsed flow summaries', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            flows: [
                {
                    name: 'daily',
                    description: 'Daily flow',
                    disabled: false,
                    sourceId: '/data/repo-a',
                    sourceLabel: 'Repo A',
                },
                {
                    name: 'broken',
                    description: 'Broken',
                    disabled: true,
                    error: 'Invalid flow file',
                },
                { name: 42 },
            ],
        }));
        const result = await listFlows();
        expect(result).toEqual({
            flows: [
                {
                    name: 'daily',
                    description: 'Daily flow',
                    disabled: false,
                    sourceId: '/data/repo-a',
                    sourceLabel: 'Repo A',
                },
                {
                    name: 'broken',
                    description: 'Broken',
                    disabled: true,
                    error: 'Invalid flow file',
                },
            ],
        });
    });
    it('throws when listFlows returns non-ok response', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({}, { status: 500 }));
        await expect(listFlows()).rejects.toThrow('Failed to load flows (500)');
    });
    it('preserves structured flow detail warnings and disabled reasons', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            flow: {
                name: 'daily',
                description: 'Daily flow',
                disabled: true,
                warnings: [
                    {
                        code: 'provider_unavailable',
                        message: 'Primary provider unavailable',
                        providerId: 'codex',
                        fallbackProviderId: 'lmstudio',
                    },
                    {
                        code: 'disabled_flow_step',
                        message: 'One step is currently disabled',
                    },
                    { code: 42, message: 'ignored invalid warning' },
                ],
                disabledReason: {
                    code: 'provider_unavailable',
                    message: 'No usable provider remains',
                    providerId: 'codex',
                },
                sourceId: '/data/repo-a',
                sourceLabel: 'Repo A',
            },
        }));
        const result = await getFlowDetails({
            flowName: 'daily',
            sourceId: '/data/repo-a',
        });
        const [url] = mockFetch.mock.calls[0] as [
            string,
            RequestInit?
        ];
        const parsedUrl = new URL(url);
        expect(parsedUrl.pathname).toBe('/flows/daily');
        expect(parsedUrl.searchParams.get('sourceId')).toBe('/data/repo-a');
        expect(result).toEqual({
            flow: {
                name: 'daily',
                description: 'Daily flow',
                disabled: true,
                warnings: [
                    {
                        code: 'provider_unavailable',
                        message: 'Primary provider unavailable',
                        providerId: 'codex',
                        fallbackProviderId: 'lmstudio',
                    },
                    {
                        code: 'disabled_flow_step',
                        message: 'One step is currently disabled',
                        providerId: undefined,
                        fallbackProviderId: undefined,
                    },
                ],
                disabledReason: {
                    code: 'provider_unavailable',
                    message: 'No usable provider remains',
                    providerId: 'codex',
                },
                sourceId: '/data/repo-a',
                sourceLabel: 'Repo A',
            },
        });
    });
    it('throws when flow details omit the disabled flag', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            flow: {
                name: 'daily',
                description: 'Daily flow',
            },
        }));
        await expect(getFlowDetails({ flowName: 'daily' })).rejects.toThrow('Invalid flow details response');
    });
    it('uses sourceId to disambiguate backward-compat flow detail arrays', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            flows: [
                {
                    name: 'daily',
                    description: 'Repo B flow',
                    disabled: false,
                    sourceId: '/data/repo-b',
                    sourceLabel: 'Repo B',
                },
                {
                    name: 'daily',
                    description: 'Repo A flow',
                    disabled: true,
                    sourceId: '/data/repo-a',
                    sourceLabel: 'Repo A',
                },
            ],
        }));
        const result = await getFlowDetails({
            flowName: 'daily',
            sourceId: '/data/repo-a',
        });
        expect(result).toEqual({
            flow: {
                name: 'daily',
                description: 'Repo A flow',
                disabled: true,
                warnings: [],
                disabledReason: undefined,
                sourceId: '/data/repo-a',
                sourceLabel: 'Repo A',
            },
        });
    });
    it('rejects ambiguous backward-compat flow detail arrays', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            flows: [
                {
                    name: 'daily',
                    description: 'Repo A flow',
                    disabled: false,
                    sourceId: '/data/repo-a',
                },
                {
                    name: 'daily',
                    description: 'Repo B flow',
                    disabled: true,
                    sourceId: '/data/repo-b',
                },
            ],
        }));
        await expect(getFlowDetails({ flowName: 'daily' })).rejects.toThrow('Invalid flow details response');
    });
    it('preserves providerId and launch warnings from the first flow run-start response', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            status: 'started',
            flowName: 'daily',
            conversationId: 'c1',
            inflightId: 'i1',
            providerId: 'lmstudio',
            modelId: 'gpt-5.2-codex',
            warnings: ['Primary provider unavailable, fell back to lmstudio.'],
        }, { status: 202 }));
        const result = await runFlow({ flowName: 'daily' });
        const [url, init] = mockFetch.mock.calls[0] as [
            string,
            RequestInit
        ];
        expect(new URL(url).pathname).toBe('/flows/daily/run');
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ 'content-type': 'application/json' });
        expect(JSON.parse(init.body as string)).toEqual({});
        expect(result).toEqual({
            status: 'started',
            flowName: 'daily',
            conversationId: 'c1',
            inflightId: 'i1',
            providerId: 'lmstudio',
            modelId: 'gpt-5.2-codex',
            warnings: ['Primary provider unavailable, fell back to lmstudio.'],
        });
    });
    it('surfaces structured errors for runFlow', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            code: 'RUN_IN_PROGRESS',
            message: 'Already running',
        }, { status: 409 }));
        await expect(runFlow({ flowName: 'daily' })).rejects.toMatchObject({
            status: 409,
            code: 'RUN_IN_PROGRESS',
        });
    });
    it('runFlow preserves server reason text when /flows/:name/run omits message', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            code: 'PROVIDER_UNAVAILABLE',
            reason: 'Codex is unavailable. Re-authenticate and try again.',
        }, { status: 503 }));
        await expect(runFlow({ flowName: 'daily' })).rejects.toMatchObject({
            status: 503,
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Codex is unavailable. Re-authenticate and try again.',
        });
    });
    it('runFlow preserves the normalized error identifier when the route returns an error-only shape', async () => {
        mockFetch.mockResolvedValue(mockJsonResponse({
            error: 'provider_unavailable',
            reason: 'Provider startup degraded.',
        }, { status: 503 }));
        await expect(runFlow({ flowName: 'daily' })).rejects.toMatchObject({
            status: 503,
            code: 'provider_unavailable',
            message: 'Provider startup degraded.',
        });
    });
});
