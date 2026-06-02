import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyAddPodcastInput } from './addPodcastOmnibar';

describe('classifyAddPodcastInput', () => {
  it('recognizes RSS-style HTTP URLs', () => {
    assert.deepEqual(classifyAddPodcastInput('https://example.com/feed.xml'), {
      kind: 'rss-url',
      value: 'https://example.com/feed.xml'
    });
  });

  it('recognizes YouTube videos', () => {
    assert.deepEqual(classifyAddPodcastInput('https://www.youtube.com/watch?v=abc123'), {
      kind: 'youtube-url',
      value: 'https://www.youtube.com/watch?v=abc123',
      youtubeKind: 'video'
    });
    assert.deepEqual(classifyAddPodcastInput('https://www.youtube.com/shorts/abc123'), {
      kind: 'youtube-url',
      value: 'https://www.youtube.com/shorts/abc123',
      youtubeKind: 'video'
    });
  });

  it('recognizes YouTube playlists and podcast playlists', () => {
    assert.equal(classifyAddPodcastInput('https://www.youtube.com/playlist?list=PL123').youtubeKind, 'playlist');
    assert.equal(classifyAddPodcastInput('https://www.youtube.com/podcast/PL123').youtubeKind, 'playlist');
  });

  it('recognizes YouTube channels', () => {
    assert.equal(classifyAddPodcastInput('https://www.youtube.com/@elephanthand').youtubeKind, 'channel');
    assert.equal(classifyAddPodcastInput('https://www.youtube.com/channel/UC123').youtubeKind, 'channel');
  });

  it('treats plain text as PodcastIndex search', () => {
    assert.deepEqual(classifyAddPodcastInput('history podcasts'), {
      kind: 'search',
      value: 'history podcasts'
    });
  });
});
