create table if not exists public.warehouse_items (
  device_code text primary key,
  department text not null,
  producer text not null,
  category text not null,
  name text not null,
  weight numeric not null check (weight >= 0),
  quantity integer not null check (quantity >= 0),
  updated_at timestamptz not null default now()
);

alter table public.warehouse_items enable row level security;

drop policy if exists "anon_read_items" on public.warehouse_items;

create policy "anon_read_items"
  on public.warehouse_items
  for select
  to anon
  using (true);

drop policy if exists "anon_write_items" on public.warehouse_items;

create policy "anon_write_items"
  on public.warehouse_items
  for all
  to anon
  using (true)
  with check (true);
