create table if not exists public.pool_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.pool_state enable row level security;

revoke all on table public.pool_state from anon, authenticated;

comment on table public.pool_state is
  'Server-only state document for the four-person family NFL pool.';
