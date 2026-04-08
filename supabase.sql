create table if not exists public.warehouse_items (
  device_code text primary key,
  department text not null,
  producer text not null,
  category text not null,
  name text not null,
  weight numeric not null check (weight >= 0),
  total_quantity integer not null check (total_quantity >= 0),
  current_quantity integer not null check (current_quantity >= 0 and current_quantity <= total_quantity),
  quantity integer not null check (quantity >= 0),
  updated_at timestamptz not null default now()
);

alter table public.warehouse_items add column if not exists total_quantity integer;
alter table public.warehouse_items add column if not exists current_quantity integer;

update public.warehouse_items
set total_quantity = coalesce(total_quantity, quantity, 0),
    current_quantity = coalesce(current_quantity, quantity, total_quantity, 0);

update public.warehouse_items
set total_quantity = greatest(total_quantity, current_quantity),
    current_quantity = least(current_quantity, greatest(total_quantity, current_quantity)),
    quantity = current_quantity;

alter table public.warehouse_items alter column total_quantity set default 0;
alter table public.warehouse_items alter column current_quantity set default 0;
alter table public.warehouse_items alter column total_quantity set not null;
alter table public.warehouse_items alter column current_quantity set not null;

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
  borrowed_total_quantity integer not null default 0,
  returned_quantity integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.rental_orders add column if not exists declared_return_date date;
alter table public.rental_orders add column if not exists actual_return_date date;
alter table public.rental_orders add column if not exists borrowed_total_quantity integer;
alter table public.rental_orders add column if not exists returned_quantity integer;

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

alter table public.rental_order_items drop constraint if exists rental_order_items_quantity_check;
alter table public.rental_order_items add constraint rental_order_items_quantity_check check (quantity >= 0);
alter table public.rental_order_items add column if not exists borrowed_quantity integer;
alter table public.rental_order_items add column if not exists returned_quantity integer;

update public.rental_order_items
set borrowed_quantity = coalesce(borrowed_quantity, quantity, 0),
    returned_quantity = coalesce(returned_quantity, 0);

update public.rental_order_items
set borrowed_quantity = greatest(coalesce(borrowed_quantity, 0), coalesce(returned_quantity, 0), coalesce(quantity, 0)),
    returned_quantity = least(greatest(coalesce(returned_quantity, 0), 0), greatest(coalesce(borrowed_quantity, 0), coalesce(quantity, 0))),
    quantity = greatest(coalesce(quantity, 0), 0);

alter table public.rental_order_items alter column borrowed_quantity set default 0;
alter table public.rental_order_items alter column returned_quantity set default 0;
alter table public.rental_order_items alter column borrowed_quantity set not null;
alter table public.rental_order_items alter column returned_quantity set not null;

with rental_totals as (
  select order_id, coalesce(sum(quantity), 0)::integer as total_quantity
  from public.rental_order_items
  group by order_id
)
update public.rental_orders as ro
set borrowed_total_quantity = coalesce(ro.borrowed_total_quantity, rt.total_quantity, 0),
    returned_quantity = coalesce(
      ro.returned_quantity,
      case when ro.actual_return_date is not null then coalesce(rt.total_quantity, 0) else 0 end,
      0
    )
from rental_totals as rt
where ro.id = rt.order_id;

update public.rental_orders
set borrowed_total_quantity = coalesce(borrowed_total_quantity, 0),
    returned_quantity = coalesce(
      returned_quantity,
      case when actual_return_date is not null then coalesce(borrowed_total_quantity, 0) else 0 end
    );

update public.rental_orders
set borrowed_total_quantity = greatest(borrowed_total_quantity, returned_quantity),
    returned_quantity = least(greatest(returned_quantity, 0), greatest(borrowed_total_quantity, returned_quantity));

alter table public.rental_orders alter column borrowed_total_quantity set default 0;
alter table public.rental_orders alter column returned_quantity set default 0;
alter table public.rental_orders alter column borrowed_total_quantity set not null;
alter table public.rental_orders alter column returned_quantity set not null;

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
