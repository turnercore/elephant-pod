import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { refineSegments } from '../boundaryRefiner.js';

describe('refineSegments', () => {
  it('snaps to nearby silence and clamps to duration', () => {
    const [segment] = refineSegments({
      episodeId: 'ep',
      mediaVersionId: 'mv',
      durationMs: 20_000,
      segments: [{ type: 'sponsorship', startMs: 1100, endMs: 19_900, confidence: 0.95, action: 'auto_skip', source: 'codex_segmenter', label: 'Sponsor' }],
      silenceMap: [{ startMs: 1000, endMs: 3000 }, { startMs: 18_000, endMs: 20_000 }]
    });
    assert.equal(segment.startMs, 1000);
    assert.equal(segment.endMs, 20_000);
  });

  it('merges adjacent same-type segments and downgrades low confidence auto skip', () => {
    const [segment] = refineSegments({
      episodeId: 'ep',
      mediaVersionId: 'mv',
      segments: [
        { type: 'ad', startMs: 1000, endMs: 3000, confidence: 0.91, action: 'auto_skip', source: 'codex_segmenter', label: 'Ad' },
        { type: 'ad', startMs: 4000, endMs: 6000, confidence: 0.97, action: 'auto_skip', source: 'codex_segmenter', label: 'Ad' }
      ]
    });
    assert.equal(segment.startMs, 1000);
    assert.equal(segment.endMs, 6000);
    assert.equal(segment.action, 'soft_skip');
  });
});
