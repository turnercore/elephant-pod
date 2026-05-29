import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { priorityByReason } from '../jobs.js';

describe('Smart Skip jobs', () => {
  it('prioritizes now playing and queue over inbox/backlog', () => {
    assert.ok(priorityByReason.nowPlaying > priorityByReason.queue);
    assert.ok(priorityByReason.queue > priorityByReason.inbox);
    assert.ok(priorityByReason.inbox > priorityByReason.backlog);
  });
});
