import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractYouTubeVideoId, fetchSponsorBlockSegments, mapSponsorBlockSegments } from '../sponsorBlock.js';

describe('SponsorBlock helpers', () => {
  it('extracts YouTube IDs from URLs', () => {
    assert.equal(extractYouTubeVideoId({ websiteUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }), 'abcdefghijk');
    assert.equal(extractYouTubeVideoId({ description: 'Watch https://youtu.be/ABCDEFGHI_1' }), 'ABCDEFGHI_1');
  });

  it('maps categories to Smart Skip segment types', () => {
    const [segment] = mapSponsorBlockSegments([{ category: 'sponsor', segment: [10, 20] }]);
    assert.equal(segment.type, 'sponsorship');
    assert.equal(segment.startMs, 10_000);
  });

  it('handles 404/no-segments as empty result', async () => {
    const segments = await fetchSponsorBlockSegments('abcdefghijk', async () => new Response('', { status: 404 }));
    assert.deepEqual(segments, []);
  });
});
