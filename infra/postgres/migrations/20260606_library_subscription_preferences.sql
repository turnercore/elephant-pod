alter table public.podcast_preferences add column if not exists in_library boolean not null default false;
alter table public.podcast_preferences add column if not exists was_subscribed_before_library_removal boolean not null default false;
