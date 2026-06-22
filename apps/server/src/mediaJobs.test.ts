import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createOrGetSilenceMapJob, parseSilenceDetect, renderClipFile, resolveSilenceMapConfig } from './mediaJobs.js';
import type { ServerClip } from './types.js';

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

describe('media URL safety', () => {
  it('fails clip rendering for private audio URLs before ffmpeg runs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daisypod-clip-test-'));
    const now = new Date().toISOString();
    const clip: ServerClip = {
      id: 'private-clip',
      episodeId: 'episode-one',
      podcastTitle: 'Podcast',
      episodeTitle: 'Episode',
      sourceAudioUrl: 'http://127.0.0.1/audio.mp3',
      startSec: 1,
      endSec: 5,
      title: 'Clip',
      createdAt: now,
      updatedAt: now
    };

    const result = await renderClipFile(clip, {
      dataDir: dir,
      publicUrl: 'https://pod.example.test',
      ffmpegPath: '/missing-ffmpeg-for-test',
      enabled: true
    });

    assert.equal(result.renderStatus, 'failed');
    assert.match(String(result.renderError), /Private network URLs are not allowed/);
  });

  it('fails silence-map jobs for private audio URLs before queueing ffmpeg work', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daisypod-silence-test-'));
    const job = await createOrGetSilenceMapJob(
      { episodeId: 'episode-one', audioUrl: 'http://[::1]/audio.mp3' },
      {
        dataDir: dir,
        publicUrl: 'https://pod.example.test',
        ffmpegPath: '/missing-ffmpeg-for-test'
      }
    );

    assert.equal(job.status, 'failed');
    assert.match(String(job.error), /Private network URLs are not allowed/);
  });
});
