import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAutoSkipTarget } from '../decisions';
import type { ResolvedSmartSkipSettings, SmartSkipSegmentMap } from '../types';

const settings: ResolvedSmartSkipSettings = {
  enabled: true,
  ads: true,
  sponsors: true,
  intros: false,
  outros: false,
  networkPromos: true,
  selfPromos: false,
  silence: false,
  softSkips: false,
  softPrompt: true
};

const map: SmartSkipSegmentMap = {
  schemaVersion: 'elephant.smart-skip.v1',
  episodeId: 'ep',
  mediaVersionId: 'mv',
  audioUrl: 'https://example.com/a.mp3',
  generatedAt: new Date().toISOString(),
  status: 'ready',
  segments: [
    { id: 'ad1', type: 'ad', startMs: 10_000, endMs: 20_000, confidence: 0.99, action: 'auto_skip', source: 'codex_segmenter', label: 'Ad' },
    { id: 'soft1', type: 'sponsorship', startMs: 25_000, endMs: 35_000, confidence: 0.9, action: 'soft_skip', source: 'codex_segmenter', label: 'Maybe sponsor' },
    { id: 'intro1', type: 'intro', startMs: 0, endMs: 5_000, confidence: 0.99, action: 'auto_skip', source: 'codex_segmenter', label: 'Intro' }
  ]
};

describe('findAutoSkipTarget', () => {
  it('returns null when Smart Skip is disabled', () => {
    assert.equal(findAutoSkipTarget({ currentTimeSec: 12, durationSec: 60, segmentMap: map, settings: { ...settings, enabled: false }, suppressedSegmentIds: new Set() }), null);
  });

  it('skips ads when settings allow and seeks to endMs', () => {
    const target = findAutoSkipTarget({ currentTimeSec: 12, durationSec: 60, segmentMap: map, settings, suppressedSegmentIds: new Set() });
    assert.equal(target?.segment.id, 'ad1');
    assert.equal(target?.seekToSec, 20);
  });

  it('does not skip disabled or suppressed segments', () => {
    assert.equal(findAutoSkipTarget({ currentTimeSec: 2, durationSec: 60, segmentMap: map, settings, suppressedSegmentIds: new Set() }), null);
    assert.equal(findAutoSkipTarget({ currentTimeSec: 12, durationSec: 60, segmentMap: map, settings, suppressedSegmentIds: new Set(['ad1']) }), null);
  });

  it('skips soft segments only when soft skips are enabled', () => {
    assert.equal(findAutoSkipTarget({ currentTimeSec: 26, durationSec: 60, segmentMap: map, settings, suppressedSegmentIds: new Set() }), null);
    const target = findAutoSkipTarget({ currentTimeSec: 26, durationSec: 60, segmentMap: map, settings: { ...settings, softSkips: true }, suppressedSegmentIds: new Set() });
    assert.equal(target?.segment.id, 'soft1');
    assert.equal(target?.seekToSec, 35);
  });

  it('ignores stale or processing maps', () => {
    assert.equal(findAutoSkipTarget({ currentTimeSec: 12, durationSec: 60, segmentMap: { ...map, status: 'processing' }, settings, suppressedSegmentIds: new Set() }), null);
  });
});
