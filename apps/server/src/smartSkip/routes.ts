import type { Express, RequestHandler } from 'express';
import type { SmartSkipConfig } from './config.js';
import { createOrGetSmartSkipJob } from './jobs.js';
import { getJob, getLatestSegmentMap } from './storage.js';

export function registerSmartSkipRoutes(app: Express, config: SmartSkipConfig, authMiddleware?: RequestHandler): void {
  const maybeAuth = config.requireAuth && authMiddleware ? [authMiddleware] : [];

  app.post('/api/smart-skip/process', ...maybeAuth, async (req, res) => {
    try {
      const { job, segmentMap } = await createOrGetSmartSkipJob(req.body, config);
      res.status(job.status === 'ready' ? 200 : 202).json({
        jobId: job.id,
        status: job.status === 'queued' ? 'queued' : job.status,
        segmentMap: segmentMap?.status === 'ready' ? segmentMap : null,
        error: job.error
      });
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : 'Invalid Smart Skip request.' });
    }
  });

  app.get('/api/smart-skip/jobs/:id', ...maybeAuth, async (req, res) => {
    const job = await getJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: 'Smart Skip job not found.' });
      return;
    }
    res.json({ jobId: job.id, status: job.status, stage: job.stage, error: job.error ?? null });
  });

  app.get('/api/smart-skip/episodes/:episodeId/segment-map', ...maybeAuth, async (req, res) => {
    const map = await getLatestSegmentMap(String(req.params.episodeId), typeof req.query.audioUrl === 'string' ? req.query.audioUrl : undefined);
    if (!map) {
      res.json({ status: config.enabled ? 'missing' : 'unavailable', segmentMap: null });
      return;
    }
    res.json({ status: map.status, segmentMap: map.status === 'ready' ? map : null });
  });

}
