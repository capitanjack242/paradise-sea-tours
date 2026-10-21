-- Where a booking came from, so marketing can be judged by the rides it brings.
--
-- The website remembers how a visitor arrived — a tagged link from a dock QR
-- code, the Instagram bio or a hotel's card (?utm_source=cruise-port&
-- utm_medium=qr&utm_campaign=launch), or failing that the site that sent them
-- (google.com) — and hands it over with the booking. Google Analytics counts
-- visitors; this puts the source on the trip itself, next to the fare.
--
-- Three plain columns rather than one string, so they can be counted.
-- Office-only: not granted to "authenticated" (0031 locks a new column by
-- default), so captains don't see it. The office reads it through
-- staff_bookings(), which returns every column.

alter table bookings
  add column if not exists source          text,
  add column if not exists source_medium   text,
  add column if not exists source_campaign text;

comment on column bookings.source is
  'Where the passenger came from: the utm_source of the link they arrived on (cruise-port, instagram), or else the site that sent them (google.com). Null when unknown.';
comment on column bookings.source_medium is
  'The utm_medium of that link (qr, social, referral). Null for an untagged visit.';
comment on column bookings.source_campaign is
  'The utm_campaign of that link (launch). Null for an untagged visit.';

alter table bookings drop constraint if exists bookings_source_lengths_sane;
alter table bookings add constraint bookings_source_lengths_sane check (
      length(coalesce(source, ''))          <= 100
  and length(coalesce(source_medium, ''))   <= 100
  and length(coalesce(source_campaign, '')) <= 100
);


-- ── the public-booking cleaner (0035), letting the source through ────────
/* A public booking is rebuilt from the passenger's own fields, and anything
   else is reset — so without this the source would be wiped on the way in.
   The source is the passenger's browser's to tell us; it decides nothing about
   the trip, so it is allowed through, cut to length. Otherwise 0035 as it was. */
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
    'source_campaign', left(new.source_campaign, 100)
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


-- ── request_boat (0024), plus the source ─────────────────────────────────
/* Dropped and made again rather than replaced: adding arguments makes a second
   function beside the old one, and the API can't choose between two that both
   fit a call. The three new arguments default to null, so the app, which
   doesn't send them, books exactly as before. */
drop function if exists request_boat(text, text, text, text, timestamptz, timestamptz,
                                     int, text, text, double precision, double precision, timestamptz);

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
  p_source_campaign text        default null
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
    source, source_medium, source_campaign
  ) values (
    btrim(p_contact_name), btrim(p_contact_phone), p_pickup, p_destination,
    p_scheduled_at, p_return_at, p_passengers, p_trip_type,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_pickup_lat, p_pickup_lng, p_located_at,
    left(nullif(btrim(coalesce(p_source, '')), ''), 100),
    left(nullif(btrim(coalesce(p_source_medium, '')), ''), 100),
    left(nullif(btrim(coalesce(p_source_campaign, '')), ''), 100)
  )
  returning access_token into new_token;

  return new_token;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function request_boat is
  'Creates a booking and returns its access token — the key to that one trip, and only the one it just made.';

revoke all on function request_boat(text, text, text, text, timestamptz, timestamptz,
                                    int, text, text, double precision, double precision, timestamptz,
                                    text, text, text)
  from public;
grant execute on function request_boat(text, text, text, text, timestamptz, timestamptz,
                                       int, text, text, double precision, double precision, timestamptz,
                                       text, text, text)
  to anon, authenticated;
