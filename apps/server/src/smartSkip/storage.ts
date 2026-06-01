import { hasLocalDatabase, queryDatabase, withDatabaseTransaction } from '../database.js';
import type { SmartSkipMediaVersion } from './mediaVersion.js';
import type { SmartSkipExternalTask, SmartSkipExternalTaskKind, SmartSkipJob, SmartSkipSegmentMap, SmartSkipTranscript } from './types.js';

const memory = {
  mediaVersions: new Map<string, SmartSkipMediaVersion>(),
  jobs: new Map<string, SmartSkipJob>(),
  maps: new Map<string, SmartSkipSegmentMap>(),
  transcripts: new Map<string, SmartSkipTranscript>(),
  externalTasks: new Map<string, SmartSkipExternalTask>()
};

export async function upsertMediaVersion(mediaVersion: SmartSkipMediaVersion): Promise<void> {
  if (!hasLocalDatabase()) {
    memory.mediaVersions.set(mediaVersion.id, mediaVersion);
    return;
  }
  await queryDatabase(
    `insert into public.smart_skip_media_versions
      (id, episode_local_id, podcast_local_id, audio_url, audio_url_hash, duration_ms, public_audio_url, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (episode_local_id, audio_url_hash) do update set
      podcast_local_id = excluded.podcast_local_id,
      audio_url = excluded.audio_url,
      duration_ms = excluded.duration_ms,
      public_audio_url = excluded.public_audio_url,
      updated_at = excluded.updated_at`,
    [
      mediaVersion.id,
      mediaVersion.episodeLocalId,
      mediaVersion.podcastLocalId ?? null,
      mediaVersion.audioUrl,
      mediaVersion.audioUrlHash,
      mediaVersion.durationMs ?? null,
      mediaVersion.publicAudioUrl ?? null,
      mediaVersion.createdAt,
      mediaVersion.updatedAt
    ]
  );
  memory.mediaVersions.set(mediaVersion.id, mediaVersion);
}

export async function upsertJob(job: SmartSkipJob): Promise<void> {
  if (!hasLocalDatabase()) {
    memory.jobs.set(job.id, job);
    return;
  }
  await queryDatabase(
    `insert into public.smart_skip_jobs
      (id, episode_local_id, media_version_id, priority, status, stage, request, error, attempts,
       locked_at, locked_until, worker_id, next_attempt_at, last_heartbeat_at, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (id) do update set
      media_version_id = excluded.media_version_id,
      priority = excluded.priority,
      status = excluded.status,
      stage = excluded.stage,
      request = excluded.request,
      error = excluded.error,
      attempts = excluded.attempts,
      locked_at = excluded.locked_at,
      locked_until = excluded.locked_until,
      worker_id = excluded.worker_id,
      next_attempt_at = excluded.next_attempt_at,
      last_heartbeat_at = excluded.last_heartbeat_at,
      updated_at = excluded.updated_at`,
    [
      job.id,
      job.episodeLocalId,
      job.mediaVersionId ?? null,
      job.priority,
      job.status,
      job.stage ?? null,
      JSON.stringify(job.request),
      job.error ?? null,
      job.attempts,
      job.lockedAt ?? null,
      job.lockedUntil ?? null,
      job.workerId ?? null,
      job.nextAttemptAt ?? null,
      job.lastHeartbeatAt ?? null,
      job.createdAt,
      job.updatedAt
    ]
  );
  memory.jobs.set(job.id, job);
}

export async function getJob(id: string): Promise<SmartSkipJob | null> {
  const cached = memory.jobs.get(id);
  if (cached) return cached;
  const rows = await queryDatabase<Record<string, unknown>>('select * from public.smart_skip_jobs where id = $1 limit 1', [id]);
  const row = rows?.[0];
  return row ? rowToJob(row) : null;
}

export async function recoverStaleJobs(maxAttempts = 3): Promise<void> {
  const now = new Date().toISOString();
  for (const job of memory.jobs.values()) {
    if (!isStaleLeasedJob(job)) continue;
    if (job.attempts >= maxAttempts) {
      memory.jobs.set(job.id, { ...job, status: 'failed', stage: 'failed', error: 'Smart Skip job exceeded retry limit.', workerId: undefined, lockedAt: undefined, lockedUntil: undefined, updatedAt: now });
    } else {
      memory.jobs.set(job.id, { ...job, status: 'queued', stage: 'requeued', workerId: undefined, lockedAt: undefined, lockedUntil: undefined, updatedAt: now });
    }
  }
  await queryDatabase(
    `update public.smart_skip_jobs
     set status = 'queued',
      worker_id = null,
      locked_at = null,
      locked_until = null,
      stage = 'requeued',
      updated_at = now()
     where status in ('leased', 'processing')
      and locked_until < now()
      and attempts < $1`,
    [maxAttempts]
  );
  await queryDatabase(
    `update public.smart_skip_jobs
     set status = 'failed',
      error = 'Smart Skip job exceeded retry limit.',
      worker_id = null,
      locked_at = null,
      locked_until = null,
      stage = 'failed',
      updated_at = now()
     where status in ('leased', 'processing')
      and locked_until < now()
      and attempts >= $1`,
    [maxAttempts]
  );
}

export async function claimNextJob(workerId: string, leaseMs = 15 * 60_000): Promise<SmartSkipJob | null> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + leaseMs).toISOString();
  if (!hasLocalDatabase()) {
    const queued = [...memory.jobs.values()]
      .filter((job) => job.status === 'queued' && (!job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now.getTime()))
      .sort((a, b) => b.priority - a.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    if (!queued) return null;
    const leased = { ...queued, status: 'leased' as const, workerId, lockedAt: now.toISOString(), lockedUntil, updatedAt: now.toISOString() };
    memory.jobs.set(leased.id, leased);
    return leased;
  }
  const rows = await queryDatabase<Record<string, unknown>>(
    `with next_job as (
      select id
      from public.smart_skip_jobs
      where status = 'queued'
        and (next_attempt_at is null or next_attempt_at <= now())
      order by priority desc, created_at asc
      for update skip locked
      limit 1
     )
     update public.smart_skip_jobs j
     set status = 'leased',
      worker_id = $1,
      locked_at = now(),
      locked_until = now() + ($2::text)::interval,
      updated_at = now()
     from next_job
     where j.id = next_job.id
     returning j.*`,
    [workerId, `${Math.max(1, Math.floor(leaseMs / 1000))} seconds`]
  );
  const row = rows?.[0];
  if (row) {
    const job = rowToJob(row);
    memory.jobs.set(job.id, job);
    return job;
  }
  return null;
}

export async function heartbeatJob(id: string, workerId: string, stage: string, leaseMs = 15 * 60_000): Promise<void> {
  const now = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + leaseMs).toISOString();
  const cached = memory.jobs.get(id);
  if (cached && cached.workerId === workerId) {
    memory.jobs.set(id, { ...cached, status: 'processing', stage, lastHeartbeatAt: now, lockedUntil, updatedAt: now });
  }
  await queryDatabase(
    `update public.smart_skip_jobs
     set status = 'processing',
      stage = $2,
      last_heartbeat_at = now(),
      locked_until = now() + ($4::text)::interval,
      updated_at = now()
     where id = $1
      and worker_id = $3`,
    [id, stage, workerId, `${Math.max(1, Math.floor(leaseMs / 1000))} seconds`]
  );
}

export async function getLatestSegmentMap(episodeId: string, audioUrl?: string): Promise<SmartSkipSegmentMap | null> {
  const maps = [...memory.maps.values()]
    .filter((map) => map.episodeId === episodeId && (!audioUrl || map.audioUrl === audioUrl))
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  if (maps[0]) return maps[0];
  const rows = await queryDatabase<Record<string, unknown>>(
    `select
      m.schema_version,
      m.episode_local_id,
      mv.podcast_local_id,
      m.media_version_id,
      mv.audio_url,
      mv.duration_ms,
      m.generated_at,
      m.status,
      coalesce(json_agg(json_build_object(
        'id', s.id,
        'type', s.type,
        'subtype', s.subtype,
        'startMs', s.start_ms,
        'endMs', s.end_ms,
        'confidence', s.confidence,
        'action', s.action,
        'source', s.source,
        'label', s.label,
        'evidence', s.evidence,
        'originalStartMs', s.original_start_ms,
        'originalEndMs', s.original_end_ms
      ) order by s.start_ms) filter (where s.id is not null), '[]') as segments
     from public.smart_skip_segment_maps m
     join public.smart_skip_media_versions mv on mv.id = m.media_version_id
     left join public.smart_skip_segments s on s.segment_map_id = m.id
     where m.episode_local_id = $1 and ($2::text is null or mv.audio_url = $2)
     group by m.id, mv.id
     order by m.updated_at desc
     limit 1`,
    [episodeId, audioUrl ?? null]
  );
  const row = rows?.[0];
  return row ? rowToMap(row) : null;
}

export async function upsertSegmentMap(map: SmartSkipSegmentMap): Promise<void> {
  const mapId = `ssk_map_${map.mediaVersionId}`;
  if (!hasLocalDatabase()) {
    memory.maps.set(mapId, map);
    return;
  }
  const wrote = await withDatabaseTransaction(async (query) => {
    await query(
    `insert into public.smart_skip_segment_maps
      (id, episode_local_id, media_version_id, schema_version, status, generated_at, source_summary, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,now(),now())
     on conflict (episode_local_id, media_version_id) do update set
      status = excluded.status,
      generated_at = excluded.generated_at,
      source_summary = excluded.source_summary,
      updated_at = now()`,
    [mapId, map.episodeId, map.mediaVersionId, map.schemaVersion, map.status, map.generatedAt, JSON.stringify({ count: map.segments.length })]
    );
    await query('delete from public.smart_skip_segments where segment_map_id = $1', [mapId]);
    for (const segment of map.segments) {
      await query(
      `insert into public.smart_skip_segments
        (id, segment_map_id, type, subtype, start_ms, end_ms, confidence, action, source, label, evidence, original_start_ms, original_end_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do nothing`,
      [
        segment.id,
        mapId,
        segment.type,
        segment.subtype ?? null,
        segment.startMs,
        segment.endMs,
        segment.confidence,
        segment.action,
        segment.source,
        segment.label,
        JSON.stringify(segment.evidence || []),
        segment.originalStartMs ?? null,
        segment.originalEndMs ?? null
      ]
      );
    }
    return true;
  });
  void wrote;
  memory.maps.set(mapId, map);
}

export async function upsertExternalTask(task: SmartSkipExternalTask): Promise<void> {
  if (!hasLocalDatabase()) {
    memory.externalTasks.set(task.id, task);
    return;
  }
  await queryDatabase(
    `insert into public.smart_skip_external_tasks
      (id, job_id, kind, provider, external_id, status, input_file_id, output_file_id, error_file_id,
       result_json, error, submitted_at, last_checked_at, next_check_at, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (job_id, kind) do update set
      provider = excluded.provider,
      external_id = excluded.external_id,
      status = excluded.status,
      input_file_id = excluded.input_file_id,
      output_file_id = excluded.output_file_id,
      error_file_id = excluded.error_file_id,
      result_json = excluded.result_json,
      error = excluded.error,
      submitted_at = excluded.submitted_at,
      last_checked_at = excluded.last_checked_at,
      next_check_at = excluded.next_check_at,
      updated_at = excluded.updated_at`,
    [
      task.id,
      task.jobId,
      task.kind,
      task.provider,
      task.externalId,
      task.status,
      task.inputFileId ?? null,
      task.outputFileId ?? null,
      task.errorFileId ?? null,
      task.resultJson === undefined ? null : JSON.stringify(task.resultJson),
      task.error ?? null,
      task.submittedAt ?? null,
      task.lastCheckedAt ?? null,
      task.nextCheckAt ?? null,
      task.createdAt,
      task.updatedAt
    ]
  );
  memory.externalTasks.set(task.id, task);
}

export async function getExternalTaskForJob(jobId: string, kind: SmartSkipExternalTaskKind): Promise<SmartSkipExternalTask | null> {
  const cached = [...memory.externalTasks.values()].find((task) => task.jobId === jobId && task.kind === kind);
  if (cached) return cached;
  const rows = await queryDatabase<Record<string, unknown>>(
    `select * from public.smart_skip_external_tasks where job_id = $1 and kind = $2 limit 1`,
    [jobId, kind]
  );
  const row = rows?.[0];
  return row ? rowToExternalTask(row) : null;
}

export async function upsertTranscript(transcript: SmartSkipTranscript): Promise<void> {
  if (!hasLocalDatabase()) {
    memory.transcripts.set(transcript.mediaVersionId, transcript);
    return;
  }
  await queryDatabase(
    `insert into public.smart_skip_transcripts
      (id, media_version_id, provider, model, language, transcript_json, plain_text)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (media_version_id, provider, model) do update set
      language = excluded.language,
      transcript_json = excluded.transcript_json,
      plain_text = excluded.plain_text`,
    [
      `ssk_tx_${transcript.mediaVersionId}_${transcript.provider}_${transcript.model || 'default'}`,
      transcript.mediaVersionId,
      transcript.provider,
      transcript.model ?? null,
      transcript.language ?? null,
      JSON.stringify(transcript),
      transcript.segments.map((segment) => segment.text).join('\n')
    ]
  );
  memory.transcripts.set(transcript.mediaVersionId, transcript);
}

export async function getTranscript(mediaVersionId: string): Promise<SmartSkipTranscript | null> {
  const cached = memory.transcripts.get(mediaVersionId);
  if (cached) return cached;
  const rows = await queryDatabase<Record<string, unknown>>(
    `select transcript_json from public.smart_skip_transcripts
     where media_version_id = $1
     order by created_at desc
     limit 1`,
    [mediaVersionId]
  );
  const value = rows?.[0]?.transcript_json;
  if (!value) return null;
  const transcript = value as SmartSkipTranscript;
  memory.transcripts.set(mediaVersionId, transcript);
  return transcript;
}

function rowToJob(row: Record<string, unknown>): SmartSkipJob {
  return {
    id: String(row.id),
    episodeLocalId: String(row.episode_local_id),
    mediaVersionId: typeof row.media_version_id === 'string' ? row.media_version_id : undefined,
    priority: Number(row.priority),
    status: row.status as SmartSkipJob['status'],
    stage: typeof row.stage === 'string' ? row.stage : undefined,
    request: row.request as SmartSkipJob['request'],
    error: typeof row.error === 'string' ? row.error : undefined,
    attempts: Number(row.attempts || 0),
    lockedAt: row.locked_at ? String(row.locked_at) : undefined,
    lockedUntil: row.locked_until ? String(row.locked_until) : undefined,
    workerId: typeof row.worker_id === 'string' ? row.worker_id : undefined,
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : undefined,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToExternalTask(row: Record<string, unknown>): SmartSkipExternalTask {
  const resultJson = row.result_json;
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    kind: row.kind as SmartSkipExternalTask['kind'],
    provider: String(row.provider),
    externalId: String(row.external_id),
    status: row.status as SmartSkipExternalTask['status'],
    inputFileId: typeof row.input_file_id === 'string' ? row.input_file_id : undefined,
    outputFileId: typeof row.output_file_id === 'string' ? row.output_file_id : undefined,
    errorFileId: typeof row.error_file_id === 'string' ? row.error_file_id : undefined,
    resultJson: resultJson === null || resultJson === undefined ? undefined : resultJson,
    error: typeof row.error === 'string' ? row.error : undefined,
    submittedAt: row.submitted_at ? String(row.submitted_at) : undefined,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : undefined,
    nextCheckAt: row.next_check_at ? String(row.next_check_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToMap(row: Record<string, unknown>): SmartSkipSegmentMap {
  return {
    schemaVersion: 'elephant.smart-skip.v1',
    episodeId: String(row.episode_local_id),
    podcastId: typeof row.podcast_local_id === 'string' ? row.podcast_local_id : undefined,
    mediaVersionId: String(row.media_version_id),
    audioUrl: String(row.audio_url),
    durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
    generatedAt: new Date(String(row.generated_at)).toISOString(),
    status: row.status as SmartSkipSegmentMap['status'],
    segments: Array.isArray(row.segments) ? row.segments.map((segment) => ({
      ...(segment as SmartSkipSegmentMap['segments'][number]),
      confidence: Number((segment as { confidence: unknown }).confidence)
    })) : []
  };
}

function isStaleLeasedJob(job: SmartSkipJob): boolean {
  return (job.status === 'leased' || job.status === 'processing') && Boolean(job.lockedUntil) && new Date(job.lockedUntil!).getTime() < Date.now();
}
