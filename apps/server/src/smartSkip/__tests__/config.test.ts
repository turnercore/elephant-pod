import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readSmartSkipConfig } from '../config.js';

const options = { dataDir: '.data/test', publicUrl: 'http://localhost:8787' };

describe('Smart Skip config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_MINUTES', () => {
    process.env.SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_MINUTES = '15';
    const config = readSmartSkipConfig(options);
    assert.equal(config.segmenterBatchCheckIntervalMinutes, 15);
  });

  it('falls back to legacy hours value when minutes is unset', () => {
    delete process.env.SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_MINUTES;
    process.env.SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_HOURS = '1';
    const config = readSmartSkipConfig(options);
    assert.equal(config.segmenterBatchCheckIntervalMinutes, 60);
  });
});
