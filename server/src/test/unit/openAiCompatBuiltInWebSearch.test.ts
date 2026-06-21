import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCodexWebSearchMode,
  shouldForceUnslothBuiltInWebSearch,
} from '../../chat/openAiCompatBuiltInWebSearch.js';

test('resolveCodexWebSearchMode treats canonical web_search as authoritative when invalid', () => {
  assert.equal(
    resolveCodexWebSearchMode({
      runtimeConfig: {
        web_search: 'disable',
        web_search_mode: 'live',
      },
    }),
    undefined,
  );
});

test('shouldForceUnslothBuiltInWebSearch does not fall through to web_search_mode when canonical web_search is invalid', () => {
  assert.equal(
    shouldForceUnslothBuiltInWebSearch({
      endpoint: { supportsBuiltInWebSearch: true },
      runtimeConfig: {
        web_search: 'disable',
        web_search_mode: 'live',
      },
    }),
    false,
  );
});
