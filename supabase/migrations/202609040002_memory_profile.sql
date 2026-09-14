-- Ticket 06: learner memory profile snapshots.
-- Supermemory computes the learner profile asynchronously, so the app keeps
-- the last confirmed snapshot. The profile panel shows this snapshot with a
-- stale state when a live fetch fails, and an updating state while local
-- learning events are still waiting to sync.

create table if not exists public.memory_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  container_tag text not null unique,
  static_json jsonb not null default '[]'::jsonb,
  dynamic_json jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists memory_profile_snapshots_set_updated_at on public.memory_profile_snapshots;
create trigger memory_profile_snapshots_set_updated_at before update on public.memory_profile_snapshots for each row execute function public.set_updated_at();
