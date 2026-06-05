import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transcribeWithWhisper } from '../whisperClient.js';
import type { SmartSkipConfig } from '../config.js';

describe('Whisper client', () => {
  it('calls the internal JSON contract by default', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        mediaVersionId: 'mv',
        provider: 'whisper',
        segments: [{ startMs: 1000, endMs: 2000, text: 'hello' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const transcript = await transcribeWithWhisper({
        config: configFixture({ whisperFormat: 'contract' }),
        mediaVersion: mediaVersionFixture('mv', 'https://example.com/episode.mp3')
      });

      assert.equal(calls[0]?.url, 'http://whisper.test/v1/transcribe');
      assert.equal((calls[0]?.init?.headers as Record<string, string>)['Content-Type'], 'application/json');
      assert.equal(transcript.segments[0]?.text, 'hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('calls OpenAI-compatible multipart transcription and normalizes timestamps', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === 'https://cdn.example.com/episode.mp3') {
        return new Response(new Blob(['audio bytes'], { type: 'audio/mpeg' }), { status: 200 });
      }
      assert.equal(String(url), 'http://whisper.test/v1/audio/transcriptions');
      assert.ok(init?.body instanceof FormData);
      return new Response(JSON.stringify({
        model: 'large-v3-turbo',
        language: 'en',
        duration: 12.5,
        segments: [{ start: 1.25, end: 3.5, text: 'Sponsor read.' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const transcript = await transcribeWithWhisper({
        config: configFixture({ whisperFormat: 'openai', whisperModel: 'whisper-1' }),
        mediaVersion: mediaVersionFixture('mv-openai', 'https://cdn.example.com/episode.mp3')
      });

      assert.equal(calls[0]?.url, 'https://cdn.example.com/episode.mp3');
      assert.equal(calls[1]?.url, 'http://whisper.test/v1/audio/transcriptions');
      assert.equal(transcript.mediaVersionId, 'mv-openai');
      assert.equal(transcript.durationMs, 12500);
      assert.deepEqual(transcript.segments, [{ startMs: 1250, endMs: 3500, text: 'Sponsor read.' }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function configFixture(overrides: Partial<SmartSkipConfig>): SmartSkipConfig {
  return {
    enabled: true,
    requireAuth: true,
    whisperBaseUrl: 'http://whisper.test',
    whisperModel: 'large-v3-turbo',
    whisperFormat: 'contract',
    segmenterModel: 'mock',
    segmenterBatchEnabled: true,
    segmenterBatchCheckIntervalMinutes: 12,
    proactiveEnabled: false,
    activeUserDays: 30,
    proactiveRunsPerDay: 2,
    maxProactiveEpisodesPerShow: 3,
    maxBacklogPerUserPerDay: 25,
    processingConcurrency: 1,
    dataDir: '.data/test',
    publicUrl: 'http://localhost:8787',
    ...overrides
  };
}

function mediaVersionFixture(id: string, audioUrl: string) {
  return {
    id,
    episodeLocalId: 'ep',
    audioUrl,
    audioUrlHash: 'hash',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z'
  };
}
