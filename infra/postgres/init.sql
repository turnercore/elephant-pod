-- Elephant Pod local Postgres schema.
-- This stores app metadata and sync state locally; auth remains on Supabase.

create extension if not exists pgcrypto;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  local_id text not null,
  title text not null,
  author text,
  description text,
  image_url text,
  feed_url text not null,
  website_url text,
  tags text[] not null default '{}',
  source_type text not null default 'rss',
  source_url text,
  external_id text,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, local_id),
  unique(user_id, feed_url),
  check (source_type in ('rss', 'youtube-channel', 'youtube-playlist', 'youtube-ad-hoc'))
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  local_id text not null,
  podcast_local_id text not null,
  podcast_title text not null,
  title text not null,
  description text,
  audio_url text not null,
  website_url text,
  image_url text,
  published_at timestamptz,
  duration_sec integer,
  explicit boolean default false,
  chapters jsonb not null default '[]'::jsonb,
  guid text not null,
  enclosure_length bigint,
  source_type text not null default 'rss',
  source_url text,
  external_id text,
  extraction_status text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, local_id),
  check (source_type in ('rss', 'youtube')),
  check (extraction_status in ('none', 'queued', 'processing', 'ready', 'failed'))
);

create table if not exists public.episode_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  episode_local_id text not null,
  played boolean not null default false,
  played_at timestamptz,
  last_played_at timestamptz,
  progress_sec integer not null default 0,
  inbox_state text not null default 'new',
  inbox_position integer,
  queued_at timestamptz,
  queue_position integer,
  downloaded boolean not null default false,
  downloaded_at timestamptz,
  favorite boolean not null default false,
  deleted_at timestamptz,
  clip_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(user_id, episode_local_id),
  check (inbox_state in ('new', 'dismissed', 'archived')),
  check (inbox_position is null or queue_position is null)
);

create table if not exists public.podcast_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  podcast_local_id text not null,
  playback_rate numeric,
  skip_forward_sec integer,
  skip_back_sec integer,
  skip_intro_sec integer not null default 0,
  skip_outro_sec integer not null default 0,
  silence_shortening boolean,
  smart_skip_enabled boolean,
  smart_skip_commercials boolean,
  smart_skip_intro boolean,
  smart_skip_outro boolean,
  smart_skip_self_promos boolean,
  smart_skip_silence boolean,
  smart_skip_include_soft_matches boolean,
  sort_direction text not null default 'newest',
  add_new_episodes_to_inbox boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(user_id, podcast_local_id),
  check (playback_rate is null or (playback_rate >= 0.5 and playback_rate <= 3.5)),
  check (skip_forward_sec is null or skip_forward_sec >= 0),
  check (skip_back_sec is null or skip_back_sec >= 0),
  check (skip_intro_sec >= 0),
  check (skip_outro_sec >= 0),
  check (sort_direction in ('newest', 'oldest'))
);

create table if not exists public.user_settings (
  user_id uuid primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  local_id text not null,
  episode_local_id text not null,
  podcast_title text not null,
  episode_title text not null,
  source_audio_url text not null,
  start_sec integer not null,
  end_sec integer not null,
  title text not null,
  note text,
  public_url text,
  rendered_audio_url text,
  rendered_video_url text,
  render_status text,
  render_error text,
  file_size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, local_id),
  check (end_sec > start_sec),
  check (render_status is null or render_status in ('local-only', 'pending', 'rendering', 'ready', 'failed', 'time-range-only'))
);

create table if not exists public.sync_tombstones (
  id text primary key,
  user_id uuid not null,
  table_name text not null,
  local_id text not null,
  deleted_at timestamptz not null,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, table_name, local_id),
  check (table_name in ('subscriptions', 'episodes', 'episode_states', 'clips'))
);

create table if not exists public.sync_actions (
  id text primary key,
  user_id uuid not null,
  device_id text not null,
  sequence bigint not null default 0,
  entity_type text not null,
  entity_id text not null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  applied_at timestamptz,
  check (entity_type in ('episode_state')),
  check (action_type in ('episode-state-updated'))
);

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

create index if not exists idx_subscriptions_user_updated on public.subscriptions(user_id, updated_at desc);
create index if not exists idx_subscriptions_user_source on public.subscriptions(user_id, source_type, external_id);
create index if not exists idx_episodes_user_podcast on public.episodes(user_id, podcast_local_id, published_at desc);
create index if not exists idx_episodes_user_source on public.episodes(user_id, source_type, external_id);
create index if not exists idx_episode_states_queue on public.episode_states(user_id, queue_position) where queue_position is not null;
create index if not exists idx_episode_states_inbox on public.episode_states(user_id, inbox_position) where inbox_position is not null;
create index if not exists idx_podcast_preferences_user_updated on public.podcast_preferences(user_id, updated_at desc);
create index if not exists idx_clips_user_episode on public.clips(user_id, episode_local_id);
create index if not exists idx_tombstones_user_deleted on public.sync_tombstones(user_id, deleted_at desc);
create index if not exists idx_sync_actions_user_created on public.sync_actions(user_id, created_at, sequence);
create index if not exists idx_sync_actions_user_entity on public.sync_actions(user_id, entity_type, entity_id, created_at desc);

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
