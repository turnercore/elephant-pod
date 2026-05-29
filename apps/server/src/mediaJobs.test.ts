import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSilenceDetect, resolveSilenceMapConfig } from './mediaJobs.js';

describe('resolveSilenceMapConfig', () => {
  it('uses defaults for unset env', () => {
    assert.deepEqual(resolveSilenceMapConfig({}), {
      thresholdDb: -42,
      minimumSilenceSec: 0.7,
      retainedSilenceSec: 0.25,
      analyzerVersion: 'v1'
    });
  });

  it('uses valid env values and clamps retained silence below the minimum', () => {
    assert.deepEqual(resolveSilenceMapConfig({
      SILENCE_THRESHOLD_DB: '-45',
      SILENCE_MINIMUM_SEC: '0.5',
      SILENCE_RETAINED_SEC: '0.6',
      SILENCE_ANALYZER_VERSION: 'v2'
    }), {
      thresholdDb: -45,
      minimumSilenceSec: 0.5,
      retainedSilenceSec: 0.49,
      analyzerVersion: 'v2'
    });
  });

  it('falls back when env values are invalid', () => {
    const config = resolveSilenceMapConfig({
      SILENCE_THRESHOLD_DB: 'loud',
      SILENCE_MINIMUM_SEC: '99',
      SILENCE_RETAINED_SEC: '-1'
    });
    assert.equal(config.thresholdDb, -42);
    assert.equal(config.minimumSilenceSec, 0.7);
    assert.equal(config.retainedSilenceSec, 0.25);
  });
});

describe('parseSilenceDetect', () => {
  it('shortens only the removable part of long silences', () => {
    const parsed = parseSilenceDetect(`
      [silencedetect @ 0x1] silence_start: 10
      [silencedetect @ 0x1] silence_end: 11 | silence_duration: 1
    `, 0.7, 0.25);
    assert.deepEqual(parsed.segments, [{
      silenceStartSec: 10,
      silenceEndSec: 11,
      skipFromSec: 10.25,
      skipToSec: 11,
      retainedSilenceSec: 0.25
    }]);
  });

  it('ignores silences below the minimum and invalid retained spans', () => {
    const parsed = parseSilenceDetect(`
      silence_start: 1
      silence_end: 1.4 | silence_duration: 0.4
      silence_start: 2
      silence_end: 2.2 | silence_duration: 0.2
    `, 0.7, 0.25);
    assert.deepEqual(parsed.segments, []);
  });

  it('recovers a missing start from silence duration', () => {
    const parsed = parseSilenceDetect('silence_end: 5 | silence_duration: 1.5', 0.7, 0.25);
    assert.deepEqual(parsed.segments[0], {
      silenceStartSec: 3.5,
      silenceEndSec: 5,
      skipFromSec: 3.75,
      skipToSec: 5,
      retainedSilenceSec: 0.25
    });
  });
});
