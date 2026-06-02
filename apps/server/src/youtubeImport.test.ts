import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importYoutubeMetadata, isYoutubeImportConfigured } from './youtubeImport.js';

const previousEnv = { ...process.env };
const noYtDlpRunner = async () => [];

afterEach(() => {
  process.env = { ...previousEnv };
});

describe('isYoutubeImportConfigured', () => {
  it('can be disabled explicitly', () => {
    assert.equal(isYoutubeImportConfigured({}), true);
    assert.equal(isYoutubeImportConfigured({ YOUTUBE_IMPORT_ENABLED: 'false' } as NodeJS.ProcessEnv), false);
    assert.equal(isYoutubeImportConfigured({ YOUTUBE_IMPORT_ENABLED: 'true' } as NodeJS.ProcessEnv), true);
  });
});

describe('importYoutubeMetadata', () => {
  it('creates a synthetic podcast episode without queuing audio extraction', async () => {
    const calls: string[] = [];
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://www.youtube.com/oembed')) {
        return jsonResponse({
          title: 'A video episode',
          author_name: 'Channel Name',
          author_url: 'https://www.youtube.com/@channel',
          thumbnail_url: 'https://img.example/video.jpg'
        });
      }
      if (url === 'https://www.youtube.com/watch?v=abc123') {
        return textResponse('<html><meta property="og:description" content="Episode description"><meta property="og:image" content="https://img.example/video.jpg"></html>');
      }
      if (url.endsWith('/history')) return jsonResponse({ done: [] });
      throw new Error(`Unexpected URL ${url}`);
    };

    const imported = await importYoutubeMetadata('https://www.youtube.com/watch?v=abc123', { publicUrl: 'https://pod.example' }, fetchMock as typeof fetch);

    assert.ok(calls.some((url) => url.startsWith('https://www.youtube.com/oembed')));
    assert.ok(!calls.some((url) => url.endsWith('/add')));
    assert.equal(imported.podcast.title, 'Channel Name');
    assert.equal(imported.podcast.sourceType, 'youtube-ad-hoc');
    assert.match(imported.podcast.feedUrl, /^https:\/\/pod\.example\/api\/youtube\/feed\.xml/);
    assert.equal(imported.episodes.length, 1);
    assert.equal(imported.episodes[0].title, 'A video episode');
    assert.equal(imported.episodes[0].sourceType, 'youtube');
    assert.equal(imported.episodes[0].extractionStatus, 'none');
    assert.match(imported.episodes[0].audioUrl, /^https:\/\/pod\.example\/media\/youtube\/ep_/);
  });

  it('creates playlist episodes from YouTube feed metadata', async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://www.youtube.com/feeds/videos.xml?playlist_id=PL123') {
        return textResponse(`<?xml version="1.0"?>
          <feed>
            <title>Podcast Playlist</title>
            <author><name>Playlist Author</name></author>
            <entry>
              <yt:videoId>v1</yt:videoId>
              <title>Episode 1</title>
              <link href="https://www.youtube.com/watch?v=v1&amp;list=PL123" />
              <published>2026-06-01T00:00:00Z</published>
              <media:group><media:description>One</media:description><media:thumbnail url="https://img.example/1.jpg" /></media:group>
            </entry>
            <entry>
              <yt:videoId>v2</yt:videoId>
              <title>Episode 2</title>
              <link href="https://www.youtube.com/watch?v=v2&amp;list=PL123" />
              <published>2026-06-02T00:00:00Z</published>
              <media:group><media:description>Two</media:description><media:thumbnail url="https://img.example/2.jpg" /></media:group>
            </entry>
          </feed>`);
      }
      if (url === 'https://www.youtube.com/watch?v=v1&list=PL123' || url === 'https://www.youtube.com/watch?v=v2&list=PL123') return textResponse('<html><link rel="canonical" href="https://www.youtube.com/watch?v=regular"></html>');
      if (url.endsWith('/history')) return jsonResponse({ done: [] });
      throw new Error(`Unexpected URL ${url}`);
    };

    const imported = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PL123', { publicUrl: 'https://pod.example', ytDlpRunner: noYtDlpRunner }, fetchMock as typeof fetch);

    assert.equal(imported.podcast.sourceType, 'youtube-playlist');
    assert.equal(imported.podcast.title, 'Podcast Playlist');
    assert.equal(imported.episodes.length, 2);
    assert.equal(imported.episodes[0].extractionStatus, 'none');
  });

  it('expands playlist episodes with yt-dlp flat metadata when available', async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLBIG') {
        return textResponse(`<?xml version="1.0"?>
          <feed>
            <title>Big Playlist</title>
            <author><name>Playlist Author</name></author>
            <entry>
              <yt:videoId>v1</yt:videoId>
              <title>RSS Episode 1</title>
              <link href="https://www.youtube.com/watch?v=v1&amp;list=PLBIG" />
              <published>2026-06-01T00:00:00Z</published>
            </entry>
          </feed>`);
      }
      if (url.endsWith('/history')) return jsonResponse({ done: [] });
      throw new Error(`Unexpected URL ${url}`);
    };
    const ytDlpRunner = async (url: string) => {
      assert.equal(url, 'https://www.youtube.com/playlist?list=PLBIG');
      return [
        { id: 'v1', title: 'Flat Episode 1', url: 'https://www.youtube.com/watch?v=v1', upload_date: '20260601', duration: 1200 },
        { id: 'v2', title: 'Flat Episode 2', url: 'https://www.youtube.com/watch?v=v2', upload_date: '20260602', duration: 1400 },
        { id: 'short1', title: 'Short clip #shorts', url: 'https://www.youtube.com/watch?v=short1', upload_date: '20260603' }
      ];
    };

    const imported = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PLBIG', { publicUrl: 'https://pod.example', ytDlpRunner }, fetchMock as typeof fetch);

    assert.equal(imported.episodes.length, 2);
    assert.equal(imported.episodes[0].title, 'Flat Episode 1');
    assert.equal(imported.episodes[1].title, 'Flat Episode 2');
    assert.equal(imported.episodes[1].publishedAt, '2026-06-02T00:00:00Z');
  });

  it('imports a direct video as its canonical channel feed when the channel is known', async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://www.youtube.com/oembed')) {
        return jsonResponse({
          title: 'Requested video',
          author_name: 'Channel Name',
          thumbnail_url: 'https://img.example/video.jpg'
        });
      }
      if (url === 'https://www.youtube.com/watch?v=abc123') {
        return textResponse('<html><meta property="og:description" content="Episode description"><script>{"channelId":"UCVIDEO"}</script></html>');
      }
      if (url === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCVIDEO') {
        return textResponse(`<?xml version="1.0"?>
          <feed>
            <title>Channel Name</title>
            <author><name>Channel Name</name></author>
            <entry>
              <yt:videoId>abc123</yt:videoId>
              <yt:channelId>UCVIDEO</yt:channelId>
              <title>Requested video from RSS</title>
              <link href="https://www.youtube.com/watch?v=abc123" />
              <published>2026-06-01T00:00:00Z</published>
            </entry>
          </feed>`);
      }
      if (url.endsWith('/history')) return jsonResponse({ done: [] });
      throw new Error(`Unexpected URL ${url}`);
    };
    const ytDlpRunner = async (url: string) => {
      assert.equal(url, 'https://www.youtube.com/channel/UCVIDEO');
      return [
        { id: 'abc123', title: 'Requested video', url: 'https://www.youtube.com/watch?v=abc123', upload_date: '20260601', duration: 900 },
        { id: 'next456', title: 'Next channel video', url: 'https://www.youtube.com/watch?v=next456', upload_date: '20260602', duration: 1200 }
      ];
    };

    const imported = await importYoutubeMetadata('https://www.youtube.com/watch?v=abc123', { publicUrl: 'https://pod.example', ytDlpRunner }, fetchMock as typeof fetch);

    assert.equal(imported.podcast.sourceType, 'youtube-channel');
    assert.equal(imported.podcast.sourceUrl, 'https://www.youtube.com/channel/UCVIDEO');
    assert.equal(imported.episodes.length, 2);
    assert.equal(imported.episodes[0].durationSec, 900);
  });

  it('stores synthetic feeds and reuses them for later imports', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elephant-pod-youtube-feed-'));
    let ytDlpCalls = 0;
    try {
      const fetchMock = async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLSTORE') {
          return textResponse(`<?xml version="1.0"?>
            <feed>
              <title>Stored Playlist</title>
              <author><name>Playlist Author</name></author>
              <entry>
                <yt:videoId>v1</yt:videoId>
                <title>RSS Episode 1</title>
                <link href="https://www.youtube.com/watch?v=v1" />
                <published>2026-06-01T00:00:00Z</published>
              </entry>
            </feed>`);
        }
        if (url.endsWith('/history')) return jsonResponse({ done: [] });
        throw new Error(`Unexpected URL ${url}`);
      };
      const ytDlpRunner = async () => {
        ytDlpCalls += 1;
        return [
          { id: 'v1', title: 'Flat Episode 1', url: 'https://www.youtube.com/watch?v=v1', upload_date: '20260601' },
          { id: 'v2', title: 'Flat Episode 2', url: 'https://www.youtube.com/watch?v=v2', upload_date: '20260602' }
        ];
      };

      const first = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PLSTORE', { publicUrl: 'https://pod.example', dataDir, ytDlpRunner }, fetchMock as typeof fetch);
      const second = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PLSTORE', { publicUrl: 'https://pod.example', dataDir, ytDlpRunner }, fetchMock as typeof fetch);

      assert.equal(ytDlpCalls, 1);
      assert.equal(first.episodes.length, 2);
      assert.equal(second.episodes.length, 2);
      assert.equal(second.episodes[1].title, 'Flat Episode 2');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('dedupes a direct video against an existing stored channel feed', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elephant-pod-youtube-video-dedupe-'));
    let ytDlpCalls = 0;
    try {
      const fetchMock = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith('https://www.youtube.com/oembed')) {
          return jsonResponse({ title: 'Video', author_name: 'Channel Name' });
        }
        if (url === 'https://www.youtube.com/watch?v=abc123' || url === 'https://www.youtube.com/channel/UCVIDEO') {
          return textResponse('<html><link type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCVIDEO"><script>{"channelId":"UCVIDEO"}</script></html>');
        }
        if (url === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCVIDEO') {
          return textResponse(`<?xml version="1.0"?>
            <feed>
              <title>Channel Name</title>
              <author><name>Channel Name</name></author>
              <entry>
                <yt:videoId>abc123</yt:videoId>
                <yt:channelId>UCVIDEO</yt:channelId>
                <title>Video</title>
                <link href="https://www.youtube.com/watch?v=abc123" />
                <published>2026-06-01T00:00:00Z</published>
              </entry>
            </feed>`);
        }
        if (url.endsWith('/history')) return jsonResponse({ done: [] });
        throw new Error(`Unexpected URL ${url}`);
      };
      const ytDlpRunner = async () => {
        ytDlpCalls += 1;
        return [{ id: 'abc123', title: 'Video', url: 'https://www.youtube.com/watch?v=abc123', upload_date: '20260601', duration: 900 }];
      };

      const channel = await importYoutubeMetadata('https://www.youtube.com/channel/UCVIDEO', { publicUrl: 'https://pod.example', dataDir, ytDlpRunner }, fetchMock as typeof fetch);
      const video = await importYoutubeMetadata('https://www.youtube.com/watch?v=abc123', { publicUrl: 'https://pod.example', dataDir, ytDlpRunner }, fetchMock as typeof fetch);

      assert.equal(ytDlpCalls, 1);
      assert.equal(video.podcast.id, channel.podcast.id);
      assert.equal(video.podcast.sourceUrl, channel.podcast.sourceUrl);
      assert.equal(video.episodes.length, 1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('canonicalizes equivalent channel URLs to one synthetic show', async () => {
    const channelPage = '<html><link type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCJETBRAINS"></html>';
    const channelFeed = `<?xml version="1.0"?>
      <feed>
        <title>JetBrains</title>
        <author><name>JetBrains TV</name></author>
        <entry>
          <yt:videoId>jb1</yt:videoId>
          <yt:channelId>UCJETBRAINS</yt:channelId>
          <title>Episode 1</title>
          <link href="https://www.youtube.com/watch?v=jb1" />
          <published>2026-06-01T00:00:00Z</published>
          <media:group><media:description>One</media:description></media:group>
        </entry>
      </feed>`;
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://www.youtube.com/@JetBrainsTV' || url === 'https://www.youtube.com/@JetBrainsTV/featured' || url === 'https://www.youtube.com/@JetBrainsTV/playlists') return textResponse(channelPage);
      if (url === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJETBRAINS') return textResponse(channelFeed);
      if (url === 'https://www.youtube.com/watch?v=jb1') return textResponse('<html><link rel="canonical" href="https://www.youtube.com/watch?v=jb1"></html>');
      if (url.endsWith('/history')) return jsonResponse({ done: [] });
      throw new Error(`Unexpected URL ${url}`);
    };

    const [bare, featured, playlists] = await Promise.all([
      importYoutubeMetadata('https://www.youtube.com/@JetBrainsTV', { publicUrl: 'https://pod.example', ytDlpRunner: noYtDlpRunner }, fetchMock as typeof fetch),
      importYoutubeMetadata('https://www.youtube.com/@JetBrainsTV/featured', { publicUrl: 'https://pod.example', ytDlpRunner: noYtDlpRunner }, fetchMock as typeof fetch),
      importYoutubeMetadata('https://www.youtube.com/@JetBrainsTV/playlists', { publicUrl: 'https://pod.example', ytDlpRunner: noYtDlpRunner }, fetchMock as typeof fetch)
    ]);

    assert.equal(featured.podcast.id, bare.podcast.id);
    assert.equal(playlists.podcast.id, bare.podcast.id);
    assert.equal(bare.podcast.sourceUrl, 'https://www.youtube.com/channel/UCJETBRAINS');
    assert.equal(featured.podcast.sourceUrl, bare.podcast.sourceUrl);
    assert.equal(playlists.podcast.feedUrl, bare.podcast.feedUrl);
  });

  it('omits Shorts from playlist synthetic podcasts', async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLSHORTS') {
        return textResponse(`<?xml version="1.0"?>
          <feed>
            <title>Mixed Playlist</title>
            <author><name>Playlist Author</name></author>
            <entry>
              <yt:videoId>regular1</yt:videoId>
              <title>Long Episode</title>
              <link href="https://www.youtube.com/watch?v=regular1&amp;list=PLSHORTS" />
              <published>2026-06-01T00:00:00Z</published>
              <media:group><media:description>One</media:description></media:group>
            </entry>
            <entry>
              <yt:videoId>short1</yt:videoId>
              <title>Quick clip #Shorts</title>
              <link href="https://www.youtube.com/watch?v=short1&amp;list=PLSHORTS" />
              <published>2026-06-02T00:00:00Z</published>
              <media:group><media:description>Two</media:description></media:group>
            </entry>
            <entry>
              <yt:videoId>short2</yt:videoId>
              <title>Canonical short</title>
              <link href="https://www.youtube.com/watch?v=short2&amp;list=PLSHORTS" />
              <published>2026-06-03T00:00:00Z</published>
              <media:group><media:description>Three</media:description></media:group>
            </entry>
          </feed>`);
      }
      if (url === 'https://www.youtube.com/watch?v=regular1&list=PLSHORTS') return textResponse('<html><link rel="canonical" href="https://www.youtube.com/watch?v=regular1"></html>');
      if (url === 'https://www.youtube.com/watch?v=short2&list=PLSHORTS') return textResponse('<html><link rel="canonical" href="https://www.youtube.com/shorts/short2"></html>');
      if (url.endsWith('/history')) return jsonResponse({ done: [] });
      throw new Error(`Unexpected URL ${url}`);
    };

    const imported = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PLSHORTS', { publicUrl: 'https://pod.example', ytDlpRunner: noYtDlpRunner }, fetchMock as typeof fetch);

    assert.equal(imported.episodes.length, 1);
    assert.equal(imported.episodes[0].title, 'Long Episode');
  });

  it('rejects direct Shorts URLs', async () => {
    await assert.rejects(
      () => importYoutubeMetadata('https://www.youtube.com/shorts/abc123', { publicUrl: 'https://pod.example' }, (() => {
        throw new Error('Shorts URL should not fetch metadata.');
      }) as typeof fetch),
      /Shorts are not imported/
    );
  });

  it('caches YouTube thumbnails under the server media route', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elephant-pod-youtube-'));
    const calls: string[] = [];
    try {
      const fetchMock = async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith('https://www.youtube.com/oembed')) {
          return jsonResponse({
            title: 'A video episode',
            author_name: 'Channel Name',
            thumbnail_url: 'https://img.example/large-video.jpg'
          });
        }
        if (url === 'https://www.youtube.com/watch?v=abc123') {
          return textResponse('<html><meta property="og:description" content="Episode description"></html>');
        }
        if (url === 'https://i.ytimg.com/vi/abc123/mqdefault.jpg') {
          return binaryResponse(Buffer.from('small thumbnail'), 'image/jpeg');
        }
        if (url.endsWith('/history')) return jsonResponse({ done: [] });
        throw new Error(`Unexpected URL ${url}`);
      };

      const imported = await importYoutubeMetadata('https://www.youtube.com/watch?v=abc123', { publicUrl: 'https://pod.example', dataDir }, fetchMock as typeof fetch);

      assert.ok(calls.includes('https://i.ytimg.com/vi/abc123/mqdefault.jpg'));
      assert.match(imported.podcast.imageUrl || '', /^https:\/\/pod\.example\/media\/youtube-thumbnails\/thumb_/);
      assert.match(imported.episodes[0].imageUrl || '', /^https:\/\/pod\.example\/media\/youtube-thumbnails\/thumb_/);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function textResponse(payload: string): Response {
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/plain' }
  });
}

function binaryResponse(payload: Buffer, contentType: string): Response {
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(payload.byteLength) }
  });
}
