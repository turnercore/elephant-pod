import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importYoutubeMetadata, isYoutubeImportConfigured } from './youtubeImport.js';

const previousEnv = { ...process.env };

afterEach(() => {
  process.env = { ...previousEnv };
});

describe('isYoutubeImportConfigured', () => {
  it('requires METUBE_BASE_URL', () => {
    assert.equal(isYoutubeImportConfigured({}), false);
    assert.equal(isYoutubeImportConfigured({ METUBE_BASE_URL: 'http://metube:8081' } as NodeJS.ProcessEnv), true);
  });
});

describe('importYoutubeMetadata', () => {
  it('creates a synthetic podcast episode without queuing audio extraction', async () => {
    process.env.METUBE_BASE_URL = 'http://metube.local';
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
    process.env.METUBE_BASE_URL = 'http://metube.local';
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

    const imported = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PL123', { publicUrl: 'https://pod.example' }, fetchMock as typeof fetch);

    assert.equal(imported.podcast.sourceType, 'youtube-playlist');
    assert.equal(imported.podcast.title, 'Podcast Playlist');
    assert.equal(imported.episodes.length, 2);
    assert.equal(imported.episodes[0].extractionStatus, 'none');
  });

  it('omits Shorts from playlist synthetic podcasts', async () => {
    process.env.METUBE_BASE_URL = 'http://metube.local';
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

    const imported = await importYoutubeMetadata('https://www.youtube.com/playlist?list=PLSHORTS', { publicUrl: 'https://pod.example' }, fetchMock as typeof fetch);

    assert.equal(imported.episodes.length, 1);
    assert.equal(imported.episodes[0].title, 'Long Episode');
  });

  it('rejects direct Shorts URLs', async () => {
    process.env.METUBE_BASE_URL = 'http://metube.local';
    await assert.rejects(
      () => importYoutubeMetadata('https://www.youtube.com/shorts/abc123', { publicUrl: 'https://pod.example' }, (() => {
        throw new Error('Shorts URL should not fetch metadata.');
      }) as typeof fetch),
      /Shorts are not imported/
    );
  });

  it('caches YouTube thumbnails under the server media route', async () => {
    process.env.METUBE_BASE_URL = 'http://metube.local';
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
