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

create table if not exists public.rental_orders (
  id uuid primary key default gen_random_uuid(),
  contractor_name text not null,
  contractor_contact text,
  contractor_phone text,
  contractor_email text,
  declared_return_date date,
  actual_return_date date,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.rental_orders add column if not exists declared_return_date date;
alter table public.rental_orders add column if not exists actual_return_date date;

create table if not exists public.rental_order_items (
  id bigserial primary key,
  order_id uuid not null references public.rental_orders(id) on delete cascade,
  device_code text not null references public.warehouse_items(device_code),
  department text not null,
  category text not null,
  producer text not null,
  name text not null,
  quantity integer not null check (quantity > 0)
);

alter table public.rental_orders enable row level security;
alter table public.rental_order_items enable row level security;

drop policy if exists "anon_read_rental_orders" on public.rental_orders;
create policy "anon_read_rental_orders"
  on public.rental_orders
  for select
  to anon
  using (true);

drop policy if exists "anon_write_rental_orders" on public.rental_orders;
create policy "anon_write_rental_orders"
  on public.rental_orders
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon_read_rental_items" on public.rental_order_items;
create policy "anon_read_rental_items"
  on public.rental_order_items
  for select
  to anon
  using (true);

drop policy if exists "anon_write_rental_items" on public.rental_order_items;
create policy "anon_write_rental_items"
  on public.rental_order_items
  for all
  to anon
  using (true)
  with check (true);
