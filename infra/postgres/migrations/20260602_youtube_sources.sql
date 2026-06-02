alter table public.subscriptions add column if not exists source_type text not null default 'rss';
alter table public.subscriptions add column if not exists source_url text;
alter table public.subscriptions add column if not exists external_id text;
alter table public.subscriptions drop constraint if exists subscriptions_source_type_check;
alter table public.subscriptions add constraint subscriptions_source_type_check check (source_type in ('rss', 'youtube-channel', 'youtube-playlist', 'youtube-ad-hoc'));

alter table public.episodes add column if not exists source_type text not null default 'rss';
alter table public.episodes add column if not exists source_url text;
alter table public.episodes add column if not exists external_id text;
alter table public.episodes add column if not exists extraction_status text not null default 'none';
alter table public.episodes drop constraint if exists episodes_source_type_check;
alter table public.episodes add constraint episodes_source_type_check check (source_type in ('rss', 'youtube'));
alter table public.episodes drop constraint if exists episodes_extraction_status_check;
alter table public.episodes add constraint episodes_extraction_status_check check (extraction_status in ('none', 'queued', 'processing', 'ready', 'failed'));

create index if not exists idx_subscriptions_user_source on public.subscriptions(user_id, source_type, external_id);
create index if not exists idx_episodes_user_source on public.episodes(user_id, source_type, external_id);
