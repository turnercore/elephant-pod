import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readServerMaxJobs, ServerJobLimiter } from './serverJobs.js';

describe('readServerMaxJobs', () => {
  it('defaults to one job', () => {
    assert.equal(readServerMaxJobs({}), 1);
  });

  it('accepts a bounded positive integer', () => {
    assert.equal(readServerMaxJobs({ SERVER_MAX_JOBS: '3' } as NodeJS.ProcessEnv), 3);
  });

  it('falls back for invalid values', () => {
    assert.equal(readServerMaxJobs({ SERVER_MAX_JOBS: '0' } as NodeJS.ProcessEnv), 1);
    assert.equal(readServerMaxJobs({ SERVER_MAX_JOBS: 'many' } as NodeJS.ProcessEnv), 1);
  });
});

describe('ServerJobLimiter', () => {
  it('runs one queued job at a time when maxJobs is one', async () => {
    const limiter = new ServerJobLimiter(1);
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = limiter.run('youtube-audio', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
    });
    const second = limiter.run('clip-render', async () => {
      events.push('second:start');
    });

    await waitFor(() => events.includes('first:start'));
    assert.deepEqual(events, ['first:start']);
    assert.equal(limiter.activeCount(), 1);
    assert.equal(limiter.queuedCount(), 1);

    releaseFirst?.();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
    assert.equal(limiter.activeCount(), 0);
    assert.equal(limiter.queuedCount(), 0);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for predicate.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
