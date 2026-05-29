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
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, local_id),
  unique(user_id, feed_url)
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, local_id)
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
create index if not exists idx_episodes_user_podcast on public.episodes(user_id, podcast_local_id, published_at desc);
create index if not exists idx_episode_states_queue on public.episode_states(user_id, queue_position) where queue_position is not null;
create index if not exists idx_episode_states_inbox on public.episode_states(user_id, inbox_position) where inbox_position is not null;
create index if not exists idx_podcast_preferences_user_updated on public.podcast_preferences(user_id, updated_at desc);
create index if not exists idx_clips_user_episode on public.clips(user_id, episode_local_id);
create index if not exists idx_tombstones_user_deleted on public.sync_tombstones(user_id, deleted_at desc);
