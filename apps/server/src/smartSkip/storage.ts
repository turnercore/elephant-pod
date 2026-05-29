import { queryDatabase } from '../database.js';
import type { SmartSkipMediaVersion } from './mediaVersion.js';
import type { SmartSkipJob, SmartSkipSegmentMap, SmartSkipTranscript } from './types.js';

const memory = {
  mediaVersions: new Map<string, SmartSkipMediaVersion>(),
  jobs: new Map<string, SmartSkipJob>(),
  maps: new Map<string, SmartSkipSegmentMap>(),
  transcripts: new Map<string, SmartSkipTranscript>(),
  feedback: [] as Record<string, unknown>[]
};

export async function upsertMediaVersion(mediaVersion: SmartSkipMediaVersion): Promise<void> {
  memory.mediaVersions.set(mediaVersion.id, mediaVersion);
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
  ).catch(() => null);
}

export async function upsertJob(job: SmartSkipJob): Promise<void> {
  memory.jobs.set(job.id, job);
  await queryDatabase(
    `insert into public.smart_skip_jobs
      (id, episode_local_id, media_version_id, priority, status, stage, request, error, attempts, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (id) do update set
      media_version_id = excluded.media_version_id,
      priority = excluded.priority,
      status = excluded.status,
      stage = excluded.stage,
      request = excluded.request,
      error = excluded.error,
      attempts = excluded.attempts,
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
      job.createdAt,
      job.updatedAt
    ]
  ).catch(() => null);
}

export async function getJob(id: string): Promise<SmartSkipJob | null> {
  const cached = memory.jobs.get(id);
  if (cached) return cached;
  const rows = await queryDatabase<Record<string, unknown>>('select * from public.smart_skip_jobs where id = $1 limit 1', [id]).catch(() => null);
  const row = rows?.[0];
  return row ? rowToJob(row) : null;
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
  ).catch(() => null);
  const row = rows?.[0];
  return row ? rowToMap(row) : null;
}

export async function upsertSegmentMap(map: SmartSkipSegmentMap): Promise<void> {
  const mapId = `ssk_map_${map.mediaVersionId}`;
  memory.maps.set(mapId, map);
  await queryDatabase(
    `insert into public.smart_skip_segment_maps
      (id, episode_local_id, media_version_id, schema_version, status, generated_at, source_summary, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,now(),now())
     on conflict (episode_local_id, media_version_id) do update set
      status = excluded.status,
      generated_at = excluded.generated_at,
      source_summary = excluded.source_summary,
      updated_at = now()`,
    [mapId, map.episodeId, map.mediaVersionId, map.schemaVersion, map.status, map.generatedAt, JSON.stringify({ count: map.segments.length })]
  ).catch(() => null);
  for (const segment of map.segments) {
    await queryDatabase(
      `insert into public.smart_skip_segments
        (id, segment_map_id, type, subtype, start_ms, end_ms, confidence, action, source, label, evidence, original_start_ms, original_end_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        confidence = excluded.confidence,
        action = excluded.action,
        label = excluded.label,
        evidence = excluded.evidence,
        original_start_ms = excluded.original_start_ms,
        original_end_ms = excluded.original_end_ms`,
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
    ).catch(() => null);
  }
}

export async function upsertTranscript(transcript: SmartSkipTranscript): Promise<void> {
  memory.transcripts.set(transcript.mediaVersionId, transcript);
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
  ).catch(() => null);
}

export async function insertFeedback(feedback: Record<string, unknown>): Promise<void> {
  memory.feedback.push(feedback);
  await queryDatabase(
    `insert into public.smart_skip_feedback
      (id, user_id, episode_local_id, media_version_id, segment_id, feedback_type, actual_start_ms, actual_end_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      feedback.id,
      null,
      feedback.episodeId,
      feedback.mediaVersionId ?? null,
      feedback.segmentId ?? null,
      feedback.feedbackType,
      feedback.actualStartMs ?? null,
      feedback.actualEndMs ?? null
    ]
  ).catch(() => null);
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
