import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSegmentMap, stableSegmentId } from '../segmentMap.js';

describe('segment maps', () => {
  it('creates stable segment IDs and sorts by startMs', () => {
    const id = stableSegmentId('ep', 'mv', { type: 'ad', startMs: 10, endMs: 20, source: 'codex_segmenter' });
    const map = createSegmentMap({
      episodeId: 'ep',
      mediaVersionId: 'mv',
      audioUrl: 'https://example.com/a.mp3',
      segments: [
        { id: '', type: 'ad', startMs: 10, endMs: 20, confidence: 1, action: 'auto_skip', source: 'codex_segmenter', label: 'Ad' },
        { id: '', type: 'intro', startMs: 1, endMs: 5, confidence: 1, action: 'label_only', source: 'rss_metadata', label: 'Intro' }
      ]
    });
    assert.equal(map.segments[0].type, 'intro');
    assert.equal(map.segments[1].id, id);
  });
});
