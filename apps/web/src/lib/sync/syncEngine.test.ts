import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EpisodeState } from '@/types/domain';
import { mergeRemoteEpisodeState, shouldKeepPendingActionOverRemote } from './syncEngine';

describe('mergeRemoteEpisodeState', () => {
  it('keeps device-local download fields when pulling remote episode state', () => {
    const merged = mergeRemoteEpisodeState(
      stateFixture({
        downloaded: true,
        downloadedAt: '2026-06-05T10:00:00.000Z',
        downloadPath: '/local/episode.mp3',
        downloadBytes: 42,
        downloadBackend: 'tauri-filesystem',
        downloadSource: 'manual'
      }),
      stateFixture({
        progressSec: 120,
        queuePosition: 4,
        downloaded: false,
        downloadedAt: undefined,
        downloadPath: undefined,
        downloadBytes: undefined,
        downloadBackend: undefined,
        downloadSource: undefined
      })
    );

    assert.equal(merged.progressSec, 120);
    assert.equal(merged.queuePosition, 4);
    assert.equal(merged.downloaded, true);
    assert.equal(merged.downloadPath, '/local/episode.mp3');
    assert.equal(merged.downloadBackend, 'tauri-filesystem');
    assert.equal(merged.downloadSource, 'manual');
  });

  it('protects actively playing local state from a newer remote row', () => {
    const merged = mergeRemoteEpisodeState(
      stateFixture({
        played: false,
        progressSec: 320,
        inboxState: 'archived',
        queuePosition: 1,
        queuedAt: '2026-06-05T10:00:00.000Z',
        updatedAt: '2026-06-05T10:00:00.000Z'
      }),
      stateFixture({
        played: true,
        playedAt: '2026-06-05T10:02:00.000Z',
        progressSec: 20,
        inboxState: 'new',
        inboxPosition: 9,
        queuePosition: undefined,
        queuedAt: undefined,
        updatedAt: '2026-06-05T10:02:00.000Z'
      }),
      { activeEpisodeId: 'episode-1', activeProgressSec: 345, activePlaying: true }
    );

    assert.equal(merged.played, false);
    assert.equal(merged.playedAt, undefined);
    assert.equal(merged.progressSec, 345);
    assert.equal(merged.inboxState, 'archived');
    assert.equal(merged.inboxPosition, undefined);
    assert.equal(merged.queuePosition, 1);
    assert.equal(merged.queuedAt, '2026-06-05T10:00:00.000Z');
  });
});

describe('shouldKeepPendingActionOverRemote', () => {
  it('keeps a local pending action when it is newer than the remote snapshot', () => {
    assert.equal(shouldKeepPendingActionOverRemote('2026-06-05T10:03:00.000Z', '2026-06-05T10:02:00.000Z'), true);
  });

  it('does not let an older local pending action beat a newer remote snapshot', () => {
    assert.equal(shouldKeepPendingActionOverRemote('2026-06-05T10:01:00.000Z', '2026-06-05T10:02:00.000Z'), false);
  });
});

function stateFixture(overrides: Partial<EpisodeState> = {}): EpisodeState {
  return {
    episodeId: 'episode-1',
    played: false,
    progressSec: 0,
    inboxState: 'archived',
    downloaded: false,
    favorite: false,
    clipCount: 0,
    updatedAt: '2026-06-05T10:00:00.000Z',
    ...overrides
  };
}
