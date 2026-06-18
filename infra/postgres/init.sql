-- DaisyPod server Postgres schema.
-- Personal podcast state sync is owned by the native iOS app's local SQLite
-- store plus CloudKit private database records. The server database only stores
-- backend-owned artifacts such as public clips and Smart Skip processing data.

create extension if not exists pgcrypto;

create table if not exists public.daisy_accounts (
  id uuid primary key default gen_random_uuid(),
  apple_sub text not null unique,
  email text,
  email_verified boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.daisy_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.daisy_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_daisy_sessions_account on public.daisy_sessions(account_id, created_at desc);

create table if not exists public.public_clips (
  id text primary key,
  title text not null,
  note text,
  podcast_title text not null,
  episode_title text not null,
  source_audio_url text not null,
  start_sec integer not null,
  end_sec integer not null,
  public_url text,
  rendered_audio_url text,
  rendered_video_url text,
  render_status text,
  render_error text,
  file_size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_sec > start_sec)
);

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
  schema_version text not null default 'daisypod.smart-skip.v1',
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
  check (confidence >= 0 and confidence <= 1),
  check (source in ('rss_metadata', 'whisper_transcript', 'codex_segmenter', 'silence_detector', 'boundary_refiner', 'ensemble'))
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
  updated_at timestamptz not null default now(),
  check (status in ('queued', 'leased', 'processing', 'ready', 'failed', 'cancelled'))
);

create table if not exists public.smart_skip_external_tasks (
  id text primary key,
  job_id text not null references public.smart_skip_jobs(id) on delete cascade,
  kind text not null,
  provider text not null,
  external_id text not null,
  status text not null,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  result_json jsonb,
  error text,
  submitted_at timestamptz,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, kind),
  unique(provider, external_id),
  check (kind in ('segmenter_batch')),
  check (status in ('submitted', 'validating', 'in_progress', 'finalizing', 'completed', 'failed', 'expired', 'cancelled'))
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
create index if not exists idx_smart_skip_external_tasks_next_check on public.smart_skip_external_tasks(next_check_at) where status in ('submitted', 'validating', 'in_progress', 'finalizing');
create index if not exists idx_smart_skip_segments_map_start on public.smart_skip_segments(segment_map_id, start_ms);
