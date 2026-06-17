create table if not exists public.snapchess_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.snapchess_state enable row level security;

drop policy if exists "service role full access" on public.snapchess_state;

create policy "service role full access"
on public.snapchess_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
