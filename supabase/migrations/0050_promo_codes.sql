-- Ship codes: a promo code per ship and sailing, shared in that ship's
-- roll-call groups and ads. A booking made with one tells us which ship and
-- which group brought it, and takes a fixed amount off the booking's fare.
--
-- Paradise pays for the discount, not the captain (Jack, 21 Oct 2026). The
-- booking keeps the amount taken off (discount_cents), and the boat's share is
-- worked out on the fare before the discount: quoted_price_cents +
-- discount_cents. VAT is on what the passenger actually pays.
--
-- Codes are the office's to list. The public can only ask about one code it
-- already has (check_promo), never read the table.
--
-- Add a code (amount in cents, before VAT):
--   insert into promo_codes (code, label, discount_cents, valid_until)
--   values ('CELEB14NOV', 'Carnival Celebration, 14 Nov sailing roll call', 500, '2026-11-15');

create table if not exists promo_codes (
  code           text primary key
    check (code ~ '^[A-Z0-9-]{3,20}$'),
  label          text not null,
  discount_cents int  not null check (discount_cents > 0),
  valid_until    date,          -- last Nassau day it works; null = no end
  max_uses       int  check (max_uses is null or max_uses > 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table promo_codes is
  'Ship codes: a fixed amount off a booking, one code per ship, sailing or group. Office-only.';
comment on column promo_codes.code is 'What the passenger types: capitals, digits and dashes.';
comment on column promo_codes.label is 'Which ship, sailing or group it was made for.';
comment on column promo_codes.discount_cents is 'Taken off the booking''s fare, before VAT. Never more than the fare.';
comment on column promo_codes.max_uses is 'Bookings that may use it, cancelled ones not counted. Null = no limit.';

alter table promo_codes enable row level security;
drop policy if exists promo_codes_admin on promo_codes;
create policy promo_codes_admin on promo_codes for all using (is_admin()) with check (is_admin());
revoke all on promo_codes from anon, authenticated;
grant select, insert, update, delete on promo_codes to authenticated;

-- ── on the booking ───────────────────────────────────────────────────────
alter table bookings
  add column if not exists promo_code     text,
  add column if not exists discount_cents int not null default 0;

alter table bookings drop constraint if exists bookings_discount_sane;
alter table bookings add constraint bookings_discount_sane check (
      discount_cents >= 0
  and length(coalesce(promo_code, '')) <= 20
);

comment on column bookings.promo_code is
  'The ship code the passenger booked with, if any. Office-only.';
comment on column bookings.discount_cents is
  'Taken off the fare by the promo code. quoted_price_cents is after it; the boat''s share is on quoted_price_cents + discount_cents, so Paradise pays for the discount.';

-- Captains are paid on the fare before the discount, so they read the amount.
-- The code itself stays the office's (0031 locks new columns by default).
grant select (discount_cents) on bookings to authenticated;

/* The discount a code gives today, or null if it doesn't work: unknown,
   switched off, past its last day (in Nassau), or used up. */
create or replace function promo_discount(p_code text) returns int as $$
  select p.discount_cents
    from promo_codes p
   where p.code = upper(btrim(p_code))
     and p.is_active
     and (p.valid_until is null
          or (now() at time zone 'America/Nassau')::date <= p.valid_until)
     and (p.max_uses is null
          or (select count(*) from bookings b
               where b.promo_code = p.code and b.status <> 'cancelled') < p.max_uses);
$$ language sql stable security definer set search_path = public;

revoke all on function promo_discount(text) from public, anon, authenticated;

/* For the booking form: what this one code is worth right now, or null.
   Answers only about the code asked for, so the list can't be read. */
create or replace function check_promo(p_code text) returns int as $$
  select promo_discount(p_code);
$$ language sql stable security definer set search_path = public;

comment on function check_promo is
  'The amount (cents) a promo code takes off a booking today, or null if it doesn''t work.';
revoke all on function check_promo(text) from public;
grant execute on function check_promo(text) to anon, authenticated;

/* Takes the code off the fare as the booking comes in. Runs after the fare is
   filled from the price list (bookings_autoquote) and before VAT is stamped.
   A charter has no automatic fare: the code is kept, and the office takes it
   off when quoting. */
create or replace function apply_promo_code() returns trigger as $$
declare
  off int;
begin
  new.promo_code := nullif(upper(btrim(coalesce(new.promo_code, ''))), '');
  if new.promo_code is null then
    new.discount_cents := 0;
    return new;
  end if;

  off := promo_discount(new.promo_code);
  if off is null then
    -- Said plainly, because a passenger reads this.
    raise exception 'That promo code isn''t valid or has expired.';
  end if;

  if new.quoted_price_cents is not null then
    new.discount_cents := least(off, new.quoted_price_cents);
    new.quoted_price_cents := new.quoted_price_cents - new.discount_cents;
  else
    new.discount_cents := 0;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- "c_" sorts after bookings_autoquote and bookings_b_dropoff_only, and before
-- bookings_stamp_receipt and bookings_stamp_vat.
drop trigger if exists bookings_c_promo on bookings;
create trigger bookings_c_promo
  before insert on bookings
  for each row execute function apply_promo_code();


-- ── the public-booking cleaner (0048), letting the code through ──────────
/* The code is the passenger's to type; the discount it gives is worked out
   above, never taken from the caller. Otherwise 0048 as it was. */
create or replace function public_booking_intake() returns trigger as $$
declare
  col text;
  def text;
  val jsonb;
begin
  -- The caller's role, straight from the request's token. Read directly rather
  -- than through auth.role(), whose definition has changed between platform
  -- versions; a caller with no token at all (SQL editor, service jobs) has none.
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       '') not in ('anon', 'authenticated')
     or is_admin() then
    return new;
  end if;

  -- Everything that is the office's, the captain's or the payment provider's
  -- to set. Listed as what a passenger MAY send (below), everything else reset.
  new := jsonb_populate_record(null::bookings, jsonb_build_object(
    'contact_name',    new.contact_name,
    'contact_phone',   new.contact_phone,
    'pickup',          new.pickup,
    'destination',     new.destination,
    'scheduled_at',    new.scheduled_at,
    'return_at',       new.return_at,
    'passengers',      new.passengers,
    'trip_type',       new.trip_type,
    'notes',           new.notes,
    'pickup_lat',      new.pickup_lat,
    'pickup_lng',      new.pickup_lng,
    'located_at',      new.located_at,
    'source',          left(new.source, 100),
    'source_medium',   left(new.source_medium, 100),
    'source_campaign', left(new.source_campaign, 100),
    'promo_code',      left(upper(btrim(new.promo_code)), 20)
  ));
  -- jsonb_populate_record leaves every other column null rather than applying
  -- its default. Put each column's own default back, read from the table, so a
  -- column added later (with "not null default …") can't make every public
  -- booking fail. Fresh id, fresh token, status 'requested', zero money.
  for col, def in
    select a.attname, pg_get_expr(d.adbin, d.adrelid)
      from pg_attribute a
      join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.bookings'::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
  loop
    if to_jsonb(new) ->> col is null then
      execute format('select to_jsonb(%s)', def) into val;
      new := jsonb_populate_record(new, jsonb_build_object(col, val));
    end if;
  end loop;

  -- Said plainly, because a passenger reads these.
  if length(coalesce(new.contact_name, '')) > 100 then
    raise exception 'That name is too long.';
  end if;
  if length(coalesce(new.contact_phone, '')) > 30 then
    raise exception 'That phone number is too long.';
  end if;
  if length(coalesce(new.pickup, '')) > 200 or length(coalesce(new.destination, '')) > 200 then
    raise exception 'Choose your pickup and destination from the list.';
  end if;
  if length(coalesce(new.notes, '')) > 1000 then
    raise exception 'Your note is too long — keep it under 1,000 characters.';
  end if;
  if new.trip_type is not null
     and new.trip_type not in ('One way', 'Round trip', 'Private charter (whole boat)') then
    raise exception 'Choose one way, round trip or charter.';
  end if;
  if new.passengers < 1 or new.passengers > 50 then
    raise exception 'How many people are coming?';
  end if;

  -- A person asks for a boat or two. Something asking for twenty a minute is a
  -- script, and every one of those rings the office's phone on Telegram.
  if new.contact_phone is not null and (
       select count(*) from bookings
        where contact_phone = new.contact_phone
          and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'You''ve just asked for a few boats — we''ll be in touch shortly. Call us if it''s urgent.';
  end if;
  if (select count(*) from bookings where created_at > now() - interval '10 minutes') >= 50 then
    raise exception 'We''re very busy right now — please call us to book.';
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;


-- ── request_boat (0048), plus the promo code ─────────────────────────────
/* Dropped and made again, as in 0048, so the API never sees two versions.
   The new argument defaults to null: older app builds book as before. */
drop function if exists request_boat(text, text, text, text, timestamptz, timestamptz,
                                     int, text, text, double precision, double precision, timestamptz,
                                     text, text, text);

create or replace function request_boat(
  p_contact_name    text,
  p_contact_phone   text,
  p_pickup          text,
  p_destination     text,
  p_scheduled_at    timestamptz,
  p_return_at       timestamptz default null,
  p_passengers      int         default 1,
  p_trip_type       text        default 'One way',
  p_notes           text        default null,
  p_pickup_lat      double precision default null,
  p_pickup_lng      double precision default null,
  p_located_at      timestamptz default null,
  p_source          text        default null,
  p_source_medium   text        default null,
  p_source_campaign text        default null,
  p_promo_code      text        default null
) returns uuid as $$
declare
  new_token uuid;
begin
  -- Said plainly, because a passenger reads these.
  if length(btrim(coalesce(p_contact_name, ''))) = 0 then
    raise exception 'We need a name so your captain knows who to look for.';
  end if;
  if length(btrim(coalesce(p_contact_phone, ''))) < 7 then
    raise exception 'We need a number we can reach you on.';
  end if;
  if length(btrim(coalesce(p_pickup, ''))) = 0
     or length(btrim(coalesce(p_destination, ''))) = 0 then
    raise exception 'Tell us where to pick you up and where you are going.';
  end if;
  if btrim(p_pickup) = btrim(p_destination) then
    raise exception 'Your pickup and destination are the same.';
  end if;
  if p_scheduled_at is null or p_scheduled_at <= now() then
    raise exception 'Please choose a time in the future.';
  end if;
  if p_return_at is not null and p_return_at <= p_scheduled_at then
    raise exception 'Your return time is before you have set off.';
  end if;
  if coalesce(p_passengers, 0) < 1 or p_passengers > 50 then
    raise exception 'How many people are coming?';
  end if;

  -- Only the fields a passenger gets to choose. The fare, the tax rate, the
  -- status and the boat are all set by triggers or by dispatch, and there is
  -- deliberately no argument here that could reach them. The source is never
  -- a reason to refuse a booking: too long is cut, blank is null.
  insert into bookings (
    contact_name, contact_phone, pickup, destination, scheduled_at, return_at,
    passengers, trip_type, notes, pickup_lat, pickup_lng, located_at,
    source, source_medium, source_campaign, promo_code
  ) values (
    btrim(p_contact_name), btrim(p_contact_phone), p_pickup, p_destination,
    p_scheduled_at, p_return_at, p_passengers, p_trip_type,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_pickup_lat, p_pickup_lng, p_located_at,
    left(nullif(btrim(coalesce(p_source, '')), ''), 100),
    left(nullif(btrim(coalesce(p_source_medium, '')), ''), 100),
    left(nullif(btrim(coalesce(p_source_campaign, '')), ''), 100),
    nullif(upper(btrim(coalesce(p_promo_code, ''))), '')
  )
  returning access_token into new_token;

  return new_token;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function request_boat is
  'Creates a booking and returns its access token — the key to that one trip, and only the one it just made.';

revoke all on function request_boat(text, text, text, text, timestamptz, timestamptz,
                                    int, text, text, double precision, double precision, timestamptz,
                                    text, text, text, text)
  from public;
grant execute on function request_boat(text, text, text, text, timestamptz, timestamptz,
                                       int, text, text, double precision, double precision, timestamptz,
                                       text, text, text, text)
  to anon, authenticated;
