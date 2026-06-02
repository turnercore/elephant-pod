-- Per-show Smart Skip preference overrides. Null means use the global app setting.

alter table public.podcast_preferences add column if not exists smart_skip_enabled boolean;
alter table public.podcast_preferences add column if not exists smart_skip_commercials boolean;
alter table public.podcast_preferences add column if not exists smart_skip_intro boolean;
alter table public.podcast_preferences add column if not exists smart_skip_outro boolean;
alter table public.podcast_preferences add column if not exists smart_skip_self_promos boolean;
alter table public.podcast_preferences add column if not exists smart_skip_silence boolean;
alter table public.podcast_preferences add column if not exists smart_skip_include_soft_matches boolean;
