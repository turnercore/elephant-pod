-- Durable client action queue for conflict-resistant sync.

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

create index if not exists idx_sync_actions_user_created on public.sync_actions(user_id, created_at, sequence);
create index if not exists idx_sync_actions_user_entity on public.sync_actions(user_id, entity_type, entity_id, created_at desc);
