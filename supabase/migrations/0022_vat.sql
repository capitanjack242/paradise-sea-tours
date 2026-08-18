-- 10% VAT, added on top of every fare.
--
-- Three rules, and the reasons they are rules rather than a number typed into
-- five screens:
--
--   1. The price list stays ex-VAT. A $15 seat is a $15 fare and $1.50 of tax,
--      not $13.64 of fare hidden inside $15. Every screen shows both.
--
--   2. Commission is taken on the fare, never on the fare plus VAT. The VAT is
--      the government's money passing through the account; a commission on it
--      would be a cut of a tax bill. So a $100 trip is $110 to the passenger,
--      $10 to the government, $25 to Paradise at a 25% rate, $75 to the boat.
--
--   3. The rate is stamped onto the trip, the same way commission is. If the
--      Bahamas moves VAT next year, what a passenger was charged this year
--      must not move with it.

-- ── the rate itself ──────────────────────────────────────────────────────
-- One row, so the website, both apps and dispatch cannot disagree about the
-- rate, and changing it is an edit rather than a release.
create table if not exists app_settings (
  id      boolean primary key default true check (id),
  vat_pct numeric(5,2) not null default 10
    check (vat_pct >= 0 and vat_pct < 100),
  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

comment on table app_settings is
  'Company-wide numbers that must not be hard-coded. One row, always.';
comment on column app_settings.vat_pct is
  'Bahamas VAT, added on top of the fare. Set to 0 if the company is not VAT-registered.';

alter table app_settings enable row level security;

-- The rate is public: the booking form has to show the customer the tax before
-- they commit, and it is a published government rate, not a secret.
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select using (true);

drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for update
  using (is_admin()) with check (is_admin());

grant select on app_settings to anon, authenticated;
grant update on app_settings to authenticated;

create or replace function current_vat_pct() returns numeric as $$
  select coalesce((select vat_pct from app_settings where id), 0);
$$ language sql stable security definer set search_path = public;

-- ── what each trip was taxed at ──────────────────────────────────────────
alter table bookings
  add column if not exists vat_pct numeric(5,2) not null default 0;

alter table bookings drop constraint if exists bookings_vat_sane;
alter table bookings add constraint bookings_vat_sane
  check (vat_pct >= 0 and vat_pct < 100);

comment on column bookings.vat_pct is
  'The VAT rate this trip was taken at. Stamped on the way in and left alone.';

-- Default 0 is doing real work: every booking already in the table was quoted
-- and, in some cases, paid without VAT. Backfilling 10% onto them would invent
-- a debt on trips that are settled and would make the board show money
-- outstanding that nobody ever asked for.

-- Derived, never stored twice: dispatch can still edit a fare, and the tax has
-- to follow it. Two expressions rather than one referencing the other, because
-- a generated column may not read another generated column.
alter table bookings
  add column if not exists vat_cents int
    generated always as (
      case when quoted_price_cents is null then null
           else (round(quoted_price_cents * vat_pct / 100.0))::int end
    ) stored;

alter table bookings
  add column if not exists total_cents int
    generated always as (
      case when quoted_price_cents is null then null
           else quoted_price_cents + (round(quoted_price_cents * vat_pct / 100.0))::int end
    ) stored;

comment on column bookings.total_cents is
  'Fare plus VAT — what the passenger actually owes. Never the base for commission.';

-- Nobody picks their own tax rate, so this overwrites rather than fills. The
-- booking form runs on the public key; if the rate were merely a default, an
-- insert could set it to zero.
create or replace function stamp_vat() returns trigger as $$
begin
  new.vat_pct := current_vat_pct();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_stamp_vat on bookings;
create trigger bookings_stamp_vat
  before insert on bookings
  for each row execute function stamp_vat();

-- A closed-out trip's tax is as fixed as its fare and its commission.
create or replace function guard_settled_booking() returns trigger as $$
begin
  if old.status not in ('completed', 'cancelled') then
    return new;
  end if;

  if new.quoted_price_cents  is distinct from old.quoted_price_cents
     or new.vat_pct             is distinct from old.vat_pct
     or new.commission_pct      is distinct from old.commission_pct
     or new.assigned_boat_id    is distinct from old.assigned_boat_id
     or new.assigned_captain_id is distinct from old.assigned_captain_id then
    raise exception 'This trip is closed out — reopen it before changing the fare, the tax or the boat';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_settled_guard on bookings;
create trigger bookings_settled_guard
  before update on bookings
  for each row execute function guard_settled_booking();

-- ── the passenger's door ─────────────────────────────────────────────────
-- Same function, three more figures. What is owed is now the total, not the
-- fare: a passenger who paid the fare and not the tax has not paid.
create or replace function trip_thread(p_token uuid)
returns jsonb as $$
  select case when b.id is null then null else jsonb_build_object(
    'pickup',      b.pickup,
    'destination', b.destination,
    'scheduled_at', b.scheduled_at,
    'return_at',   b.return_at,
    'passengers',  b.passengers,
    'trip_type',   b.trip_type,
    'status',      b.status,
    'fare_cents',  b.quoted_price_cents,
    'vat_pct',     b.vat_pct,
    'vat_cents',   b.vat_cents,
    'total_cents', b.total_cents,
    'boat',        bo.name,
    'captain',     bo.captain_name,
    'paid_at',     b.paid_at,
    'amount_paid_cents', b.amount_paid_cents,
    'balance_cents', greatest(coalesce(b.total_cents, 0)
                              - coalesce(b.amount_paid_cents, 0), 0),
    'can_reply',   b.status not in ('completed', 'cancelled'),
    'can_message_captain',
      b.paid_at is not null
      and b.assigned_captain_id is not null
      and b.status not in ('completed', 'cancelled'),
    'messages',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'sender', m.sender, 'body', m.body,
               'channel', m.channel, 'at', m.created_at
             ) order by m.created_at)
      from messages m where m.booking_id = b.id
    ), '[]'::jsonb)
  ) end
  from bookings b
  left join boats bo on bo.id = b.assigned_boat_id
  where b.access_token = p_token;
$$ language sql stable security definer set search_path = public;
