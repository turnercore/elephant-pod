import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFeedXml, parseFeedXmlWithExternalChapters } from './rss.js';

describe('rss parser native contract', () => {
  it('preserves inline Podcasting 2.0 and Podlove chapter metadata', () => {
    const result = parseFeedXml(
      `
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:psc="http://podlove.org/simple-chapters">
        <channel>
          <title>Chapter Show</title>
          <item>
            <title>Chapter Episode One</title>
            <guid>episode-one</guid>
            <podcast:chapters>
              <podcast:chapter startTime="00:00:00" title="Opening" url="https://example.com/opening" />
              <podcast:chapter startTime="01:02:03.5" title="Deep Dive" />
            </podcast:chapters>
            <enclosure url="https://media.example.com/one.mp3" type="audio/mpeg" />
          </item>
          <item>
            <title>Chapter Episode Two</title>
            <guid>episode-two</guid>
            <psc:chapters>
              <psc:chapter start="90" title="Second Start" href="https://example.com/second" />
            </psc:chapters>
            <enclosure url="https://media.example.com/two.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>
      `,
      'https://example.com/feed.xml'
    );

    assert.equal(result.episodes[0].chapters.length, 2);
    assert.equal(result.episodes[0].chapters[0].title, 'Opening');
    assert.equal(result.episodes[0].chapters[0].startsAt, 0);
    assert.equal(result.episodes[0].chapters[0].url, 'https://example.com/opening');
    assert.equal(result.episodes[0].chapters[1].title, 'Deep Dive');
    assert.equal(result.episodes[0].chapters[1].startsAt, 3723.5);
    assert.equal(result.episodes[1].chapters[0].title, 'Second Start');
    assert.equal(result.episodes[1].chapters[0].startsAt, 90);
    assert.equal(result.episodes[1].chapters[0].url, 'https://example.com/second');
  });

  it('resolves external Podcasting 2.0 chapter JSON without requiring the native client to fetch it', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          version: '1.2.0',
          chapters: [
            { startTime: 0, title: 'Cold Open', url: 'https://example.com/cold-open' },
            { startTime: '00:12:34.5', title: 'Main Topic' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    const xml = `
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel>
          <title>External Chapter Show</title>
          <item>
            <title>Episode With External Chapters</title>
            <guid>external-one</guid>
            <podcast:chapters url="/chapters/external-one.json" type="application/json" />
            <enclosure url="https://media.example.com/external-one.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>
    `;

    const localOnly = parseFeedXml(xml, 'https://example.com/feed.xml');
    assert.equal(localOnly.episodes[0].chapters.length, 0);
    assert.equal(localOnly.externalChapterRefs.length, 1);

    const result = await parseFeedXmlWithExternalChapters(xml, 'https://example.com/feed.xml', fetcher);

    assert.deepEqual(calls, ['https://example.com/chapters/external-one.json']);
    assert.equal(result.episodes[0].chapters.length, 2);
    assert.equal(result.episodes[0].chapters[0].title, 'Cold Open');
    assert.equal(result.episodes[0].chapters[0].startsAt, 0);
    assert.equal(result.episodes[0].chapters[0].url, 'https://example.com/cold-open');
    assert.equal(result.episodes[0].chapters[1].title, 'Main Topic');
    assert.equal(result.episodes[0].chapters[1].startsAt, 754.5);
  });

  it('keeps RSS import usable when optional external chapters fail', async () => {
    const fetcher = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const result = await parseFeedXmlWithExternalChapters(
      `
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel>
          <title>Offline Chapter Show</title>
          <item>
            <title>Episode Without Reachable Chapters</title>
            <guid>external-missing</guid>
            <podcast:chapters url="https://cdn.example.com/missing.json" type="application/json" />
            <enclosure url="https://media.example.com/missing.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>
      `,
      'https://example.com/feed.xml',
      fetcher
    );

    assert.equal(result.episodes.length, 1);
    assert.equal(result.episodes[0].chapters.length, 0);
  });
});
