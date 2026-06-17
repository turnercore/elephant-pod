import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServerCapabilities } from './capabilities.js';

describe('server capabilities native contract', () => {
  it('reports native-facing optional backend features without exposing secrets', () => {
    const capabilities = buildServerCapabilities({
      youtubeImportEnabled: false,
      smartSkipEnabled: true
    });

    assert.deepEqual(capabilities, {
      youtubeImport: {
        enabled: false
      },
      podcastIndex: {
        enabled: true
      },
      clips: {
        enabled: true
      },
      silenceMaps: {
        enabled: true
      },
      smartSkip: {
        enabled: true
      }
    });
    assert.equal(JSON.stringify(capabilities).includes('PODCASTINDEX'), false);
    assert.equal(JSON.stringify(capabilities).includes('API_KEY'), false);
  });
});
