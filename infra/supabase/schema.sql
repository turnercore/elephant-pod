-- Elephant Ears Supabase schema.
-- Run this in your self-hosted Supabase project after Auth is configured.

create extension if not exists pgcrypto;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  episode_local_id text not null,
  played boolean not null default false,
  played_at timestamptz,
  progress_sec integer not null default 0,
  inbox_state text not null default 'new',
  queued_at timestamptz,
  queue_position integer,
  downloaded boolean not null default false,
  downloaded_at timestamptz,
  favorite boolean not null default false,
  deleted_at timestamptz,
  clip_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(user_id, episode_local_id),
  check (inbox_state in ('new', 'queued', 'dismissed', 'archived'))
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  local_id text not null,
  deleted_at timestamptz not null,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, table_name, local_id),
  check (table_name in ('subscriptions', 'episodes', 'episode_states', 'clips'))
);

-- Optional unauthenticated public clip registry used by the app server.
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

alter table public.subscriptions enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_states enable row level security;
alter table public.user_settings enable row level security;
alter table public.clips enable row level security;
alter table public.sync_tombstones enable row level security;
alter table public.public_clips enable row level security;

drop policy if exists "subscriptions are owned by user" on public.subscriptions;
drop policy if exists "episodes are owned by user" on public.episodes;
drop policy if exists "states are owned by user" on public.episode_states;
drop policy if exists "settings are owned by user" on public.user_settings;
drop policy if exists "clips are owned by user" on public.clips;
drop policy if exists "tombstones are owned by user" on public.sync_tombstones;
drop policy if exists "public clips are readable" on public.public_clips;

create policy "subscriptions are owned by user" on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "episodes are owned by user" on public.episodes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "states are owned by user" on public.episode_states for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "settings are owned by user" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "clips are owned by user" on public.clips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tombstones are owned by user" on public.sync_tombstones for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "public clips are readable" on public.public_clips for select using (true);

create index if not exists idx_subscriptions_user_updated on public.subscriptions(user_id, updated_at desc);
create index if not exists idx_episodes_user_podcast on public.episodes(user_id, podcast_local_id, published_at desc);
create index if not exists idx_episode_states_queue on public.episode_states(user_id, queue_position) where queue_position is not null;
create index if not exists idx_clips_user_episode on public.clips(user_id, episode_local_id);
create index if not exists idx_tombstones_user_deleted on public.sync_tombstones(user_id, deleted_at desc);
