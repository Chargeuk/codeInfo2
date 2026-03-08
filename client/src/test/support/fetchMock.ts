export type TestFetchMock = jest.MockedFunction<typeof fetch>;

export function getFetchMock(): TestFetchMock {
  return globalThis.fetch as TestFetchMock;
}
