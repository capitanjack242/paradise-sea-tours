-- Paradise Sea Express — initial schema
-- Core: profiles, boats, services (offerings), bookings, payments.

-- ── enums ────────────────────────────────────────────────────────────────
create type user_role     as enum ('customer', 'captain', 'admin');
create type service_category as enum ('route', 'charter', 'fishing');
create type pricing_model  as enum ('per_person', 'per_hour', 'per_boat');
create type booking_status as enum
  ('requested','quoted','confirmed','assigned','in_progress','completed','cancelled');
create type payment_status as enum ('pending','paid','refunded','failed');

-- ── profiles (extends auth.users) ────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  role        user_role not null default 'customer',
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ── boats ────────────────────────────────────────────────────────────────
create table boats (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references profiles on delete set null,
  name        text not null,
  kind        text,                 -- e.g. "Center Console", "Cruiser"
  capacity    int  not null default 6,
  photo_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── services: every bookable offering (routes, charters, fishing) ─────────
create table services (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  category      service_category not null,
  title         text not null,
  description   text,
  pricing_model pricing_model not null,
  price_cents   int,                 -- null = "by quote"
  currency      text not null default 'USD',
  from_point    text,                -- routes
  to_point      text,                -- routes
  est_minutes   int,                 -- routes
  capacity      int,                 -- charters/fishing
  is_active     boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

-- ── bookings ──────────────────────────────────────────────────────────────
-- customer_id is nullable so the public site can submit guest bookings.
create table bookings (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid references profiles on delete set null,
  service_id          uuid references services on delete set null,
  status              booking_status not null default 'requested',
  pickup              text,
  destination         text,
  scheduled_at        timestamptz,
  passengers          int not null default 1,
  trip_type           text,          -- one way / round trip / charter
  contact_name        text,
  contact_phone       text,
  notes               text,
  quoted_price_cents  int,
  assigned_captain_id uuid references profiles on delete set null,
  assigned_boat_id    uuid references boats on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index bookings_status_idx       on bookings (status, scheduled_at);
create index bookings_customer_idx     on bookings (customer_id);
create index bookings_captain_idx      on bookings (assigned_captain_id);

-- keep updated_at fresh
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
create trigger bookings_updated_at before update on bookings
  for each row execute function set_updated_at();

-- ── payments ──────────────────────────────────────────────────────────────
create table payments (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references bookings on delete cascade,
  amount_cents             int not null,
  currency                 text not null default 'USD',
  status                   payment_status not null default 'pending',
  stripe_payment_intent_id text,
  created_at               timestamptz not null default now()
);

-- ── helper: is the current user an admin? ─────────────────────────────────
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- ── auto-create a profile row when a user signs up ────────────────────────
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.phone);
  return new;
end; $$ language plpgsql security definer;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ── Row Level Security ────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table boats    enable row level security;
alter table services enable row level security;
alter table bookings enable row level security;
alter table payments enable row level security;

-- profiles: read/update your own; admins everything
create policy profiles_self_read   on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_self_update on profiles for update using (id = auth.uid() or is_admin());

-- services: anyone can read active offerings; only admins write
create policy services_public_read on services for select using (is_active or is_admin());
create policy services_admin_write on services for all using (is_admin()) with check (is_admin());

-- boats: public can read active; owner or admin manage
create policy boats_public_read on boats for select using (is_active or owner_id = auth.uid() or is_admin());
create policy boats_owner_write on boats for all using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- bookings:
--  • anyone (incl. anonymous web visitor) may CREATE a booking request
--  • customers read their own; assigned captains read theirs; admins read all
create policy bookings_public_insert on bookings for insert with check (true);
create policy bookings_read on bookings for select using (
  customer_id = auth.uid() or assigned_captain_id = auth.uid() or is_admin()
);
create policy bookings_staff_update on bookings for update using (
  assigned_captain_id = auth.uid() or is_admin()
) with check (assigned_captain_id = auth.uid() or is_admin());

-- payments: customer of the booking, or admin
create policy payments_read on payments for select using (
  is_admin() or exists (
    select 1 from bookings b where b.id = payments.booking_id and b.customer_id = auth.uid()
  )
);
create policy payments_admin_write on payments for all using (is_admin()) with check (is_admin());
