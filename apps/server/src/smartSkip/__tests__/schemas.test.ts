import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { segmenterResponseSchema, smartSkipSegmentSchema, whisperResponseSchema } from '../schemas.js';

describe('Smart Skip schemas', () => {
  it('validates Whisper responses', () => {
    const parsed = whisperResponseSchema.parse({
      mediaVersionId: 'mv',
      provider: 'whisper',
      model: 'large-v3-turbo',
      segments: [{ startMs: 1000, endMs: 2000, text: 'hello' }]
    });
    assert.equal(parsed.segments[0].text, 'hello');
  });

  it('validates segmenter responses', () => {
    const parsed = segmenterResponseSchema.parse({
      segments: [{ type: 'sponsorship', startMs: 1000, endMs: 5000, confidence: 0.95, label: 'Sponsor' }]
    });
    assert.equal(parsed.segments[0].action, 'auto_skip');
  });

  it('rejects invalid ranges and unknown categories', () => {
    assert.throws(() => smartSkipSegmentSchema.parse({ id: 'x', type: 'ad', startMs: 2, endMs: 1, confidence: 1, action: 'auto_skip', source: 'codex_segmenter', label: 'Ad' }));
    assert.throws(() => segmenterResponseSchema.parse({ segments: [{ type: 'chapter', startMs: 1, endMs: 2, confidence: 1, label: 'Bad' }] }));
  });
});
