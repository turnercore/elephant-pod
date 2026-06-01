import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOrGetSmartSkipJob, priorityByReason } from '../jobs.js';
import { claimNextJob, getJob, recoverStaleJobs, upsertJob } from '../storage.js';
import type { SmartSkipConfig } from '../config.js';
import type { SmartSkipJob, SmartSkipProcessRequest } from '../types.js';

describe('Smart Skip jobs', () => {
  it('prioritizes now playing and queue over inbox/backlog', () => {
    assert.ok(priorityByReason.nowPlaying > priorityByReason.queue);
    assert.ok(priorityByReason.queue > priorityByReason.inbox);
    assert.ok(priorityByReason.inbox > priorityByReason.backlog);
  });

  it('enqueues process requests without processing them inline', async () => {
    const request = requestFixture(`ep-enqueue-${Date.now()}`);
    const { job, segmentMap } = await createOrGetSmartSkipJob(request, configFixture());
    assert.equal(job.status, 'queued');
    assert.equal(job.stage, 'queued');
    assert.equal(segmentMap, null);
  });

  it('claims queued jobs by priority and marks stale leases failed after retries', async () => {
    const suffix = Date.now();
    await upsertJob(jobFixture(`ssk_job_low_${suffix}`, 10));
    await upsertJob(jobFixture(`ssk_job_high_${suffix}`, 999));

    const claimed = await claimNextJob('worker-test', 1000);
    assert.equal(claimed?.id, `ssk_job_high_${suffix}`);
    assert.equal(claimed?.status, 'leased');

    await upsertJob({
      ...jobFixture(`ssk_job_stale_${suffix}`, 50),
      status: 'processing',
      attempts: 3,
      workerId: 'old-worker',
      lockedAt: new Date(Date.now() - 30_000).toISOString(),
      lockedUntil: new Date(Date.now() - 20_000).toISOString()
    });
    await recoverStaleJobs(3);
    const stale = await getJob(`ssk_job_stale_${suffix}`);
    assert.equal(stale?.status, 'failed');
  });
});

function requestFixture(episodeId: string): SmartSkipProcessRequest {
  return {
    episodeId,
    podcastTitle: 'Podcast',
    episodeTitle: 'Episode',
    audioUrl: `https://example.com/${episodeId}.mp3`,
    priority: 'queue'
  };
}

function jobFixture(id: string, priority: number): SmartSkipJob {
  const now = new Date().toISOString();
  return {
    id,
    episodeLocalId: id,
    mediaVersionId: `mv_${id}`,
    priority,
    status: 'queued',
    stage: 'queued',
    request: requestFixture(id),
    attempts: 0,
    createdAt: now,
    updatedAt: now
  };
}

function configFixture(): SmartSkipConfig {
  return {
    enabled: true,
    requireAuth: true,
    whisperModel: 'mock',
    segmenterModel: 'mock',
    proactiveEnabled: false,
    activeUserDays: 30,
    proactiveRunsPerDay: 2,
    maxProactiveEpisodesPerShow: 3,
    maxBacklogPerUserPerDay: 25,
    processingConcurrency: 1,
    dataDir: '.data/test',
    publicUrl: 'http://localhost:8787'
  };
}
