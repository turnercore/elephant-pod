-- Smart Skip V1 durable queue and segment-map storage.
-- Apply to existing Elephant Pod Postgres/Supabase databases before enabling
-- SMART_SKIP_ENABLED=true against real workers.

create extension if not exists pgcrypto;

create table if not exists public.smart_skip_media_versions (
  id text primary key,
  episode_local_id text not null,
  podcast_local_id text,
  audio_url text not null,
  audio_url_hash text not null,
  content_type text,
  content_length bigint,
  etag text,
  last_modified text,
  sha256_audio text,
  duration_ms integer,
  cached_audio_path text,
  public_audio_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(episode_local_id, audio_url_hash)
);

create table if not exists public.smart_skip_transcripts (
  id text primary key,
  media_version_id text not null references public.smart_skip_media_versions(id) on delete cascade,
  provider text not null,
  model text,
  language text,
  transcript_json jsonb not null,
  plain_text text,
  created_at timestamptz not null default now(),
  unique(media_version_id, provider, model)
);

create table if not exists public.smart_skip_segment_maps (
  id text primary key,
  episode_local_id text not null,
  media_version_id text not null references public.smart_skip_media_versions(id) on delete cascade,
  schema_version text not null default 'elephant.smart-skip.v1',
  status text not null,
  generated_at timestamptz,
  error text,
  source_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(episode_local_id, media_version_id)
);

create table if not exists public.smart_skip_segments (
  id text primary key,
  segment_map_id text not null references public.smart_skip_segment_maps(id) on delete cascade,
  type text not null,
  subtype text,
  start_ms integer not null,
  end_ms integer not null,
  confidence numeric not null,
  action text not null,
  source text not null,
  label text not null,
  evidence jsonb not null default '[]'::jsonb,
  original_start_ms integer,
  original_end_ms integer,
  created_at timestamptz not null default now(),
  check (start_ms >= 0),
  check (end_ms > start_ms),
  check (confidence >= 0 and confidence <= 1)
);

alter table public.smart_skip_segments drop constraint if exists smart_skip_segments_source_check;
alter table public.smart_skip_segments add constraint smart_skip_segments_source_check check (source in ('rss_metadata', 'whisper_transcript', 'codex_segmenter', 'silence_detector', 'boundary_refiner', 'ensemble'));

create table if not exists public.smart_skip_jobs (
  id text primary key,
  episode_local_id text not null,
  media_version_id text,
  priority integer not null default 50,
  status text not null,
  stage text,
  request jsonb not null,
  error text,
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_until timestamptz,
  worker_id text,
  next_attempt_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.smart_skip_jobs add column if not exists locked_at timestamptz;
alter table public.smart_skip_jobs add column if not exists locked_until timestamptz;
alter table public.smart_skip_jobs add column if not exists worker_id text;
alter table public.smart_skip_jobs add column if not exists next_attempt_at timestamptz;
alter table public.smart_skip_jobs add column if not exists last_heartbeat_at timestamptz;
alter table public.smart_skip_jobs drop constraint if exists smart_skip_jobs_status_check;
alter table public.smart_skip_jobs add constraint smart_skip_jobs_status_check check (status in ('queued', 'leased', 'processing', 'ready', 'failed', 'cancelled'));

drop table if exists public.smart_skip_feedback;

create index if not exists idx_smart_skip_maps_episode on public.smart_skip_segment_maps(episode_local_id, updated_at desc);
create index if not exists idx_smart_skip_jobs_status_priority on public.smart_skip_jobs(status, priority desc, created_at asc);
create index if not exists idx_smart_skip_jobs_locked_until on public.smart_skip_jobs(locked_until) where status in ('leased', 'processing');
create index if not exists idx_smart_skip_segments_map_start on public.smart_skip_segments(segment_map_id, start_ms);
