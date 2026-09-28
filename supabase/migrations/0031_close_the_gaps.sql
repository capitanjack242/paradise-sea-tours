-- Close the gaps the September review found.
--
-- Five separate holes, one file, because they share a cause: the booking row
-- has grown from a dozen columns to fifty, and the rules guarding it were each
-- written as a list of what NOT to allow. Every column added since was allowed
-- by default. So this turns the two guards that matter into lists of what IS
-- allowed, and a column added next month starts out locked instead of open.
--
--   1. The website could not book a priced route. 0030's insert rule demanded
--      "no fare", but the autoquote trigger fills the fare in before the rule is
--      checked — so every booking for a route with a published price was
--      refused, and the customer was told to phone. Only unpriced routes and the
--      app (which books through request_boat) got through.
--
--   2. A stranger could still create a booking that looked settled: marked
--      paid, with money against it, a tip, a rating, a commission rate. The
--      insert rule only named the fields that existed when it was written.
--
--   3. A captain could edit the money on his own trips — set the commission to
--      0 just before closing it out, type in a tip, mark it paid. Same cause:
--      the captain guard listed forbidden columns, and the money columns came
--      later.
--
--   4. A captain could read the passenger's trip link, phone number and the
--      office's private notes. The link is the whole key to the trip: with it he
--      could read the passenger's conversation with the office, rate himself
--      five stars, and write as the passenger.
--
--   5. Charters were priced as per-seat rides. quote_fare didn't know about
--      them, so a whole-boat charter between two docks on the price list got the
--      per-person fare put on it, which the website promises it won't.


-- ── 5. charters are quoted by a person ───────────────────────────────────
create or replace function quote_fare(
  p_pickup      text,
  p_destination text,
  p_passengers  int,
  p_trip_type   text
) returns int as $$
  select s.price_cents
         * greatest(coalesce(p_passengers, 1), 1)
         * case when p_trip_type = 'Round trip' then 2 else 1 end
  from services s
  where s.category = 'route'
    -- A charter is the whole boat by the hour, not seats on a route. The price
    -- list has nothing to say about it, so it arrives with no fare and dispatch
    -- quotes it — the same as any route the list doesn't cover.
    and coalesce(p_trip_type, '') not ilike '%charter%'
    and s.is_active
    and s.price_cents is not null
    and s.from_point is not null
    and s.to_point is not null
    and (
      (    (p_pickup      ilike '%' || s.from_point || '%' or s.from_point ilike '%' || p_pickup      || '%')
       and (p_destination ilike '%' || s.to_point   || '%' or s.to_point   ilike '%' || p_destination || '%'))
      or
      (    (p_destination ilike '%' || s.from_point || '%' or s.from_point ilike '%' || p_destination || '%')
       and (p_pickup      ilike '%' || s.to_point   || '%' or s.to_point   ilike '%' || p_pickup      || '%'))
    )
  order by s.sort
  limit 1;
$$ language sql stable security definer set search_path = public;


-- ── 1 & 2. what a stranger's booking may carry ───────────────────────────
/* Rather than refuse a booking that arrives with a fare or a paid stamp on it,
   wipe those fields and carry on. The website and the app never send them, so
   nothing honest is lost; anything dishonest simply doesn't stick.

   Runs first of the insert triggers ("a_" sorts before "autoquote"), so the
   price list is applied to a clean row and nothing a caller sent survives into
   it. Applies to the public key and to signed-in non-staff. The office, and
   anything server-side (SQL editor, the service role), are left alone. */
create or replace function public_booking_intake() returns trigger as $$
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
    'contact_name',  new.contact_name,
    'contact_phone', new.contact_phone,
    'pickup',        new.pickup,
    'destination',   new.destination,
    'scheduled_at',  new.scheduled_at,
    'return_at',     new.return_at,
    'passengers',    new.passengers,
    'trip_type',     new.trip_type,
    'notes',         new.notes,
    'pickup_lat',    new.pickup_lat,
    'pickup_lng',    new.pickup_lng,
    'located_at',    new.located_at
  ));
  -- jsonb_populate_record leaves unnamed columns null rather than applying
  -- their defaults, so the ones with defaults are put back by hand.
  new.id           := gen_random_uuid();
  new.status       := 'requested';
  new.access_token := gen_random_uuid();
  new.tip_cents    := 0;
  new.vat_pct      := 0;  -- stamped properly by bookings_stamp_vat, which runs after
  new.created_at   := now();
  new.updated_at   := now();
  new.passengers   := coalesce(new.passengers, 1);

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

comment on function public_booking_intake is
  'Resets everything on a public booking that is not the passenger''s to set, and refuses floods. Staff and server-side inserts pass untouched.';

drop trigger if exists bookings_a_public_intake on bookings;
create trigger bookings_a_public_intake
  before insert on bookings
  for each row execute function public_booking_intake();

-- The phone-number check above looks this up on every public booking.
create index if not exists bookings_phone_recent_idx on bookings (contact_phone, created_at);

-- 0030's rule, minus the one condition that could never be met: the fare is
-- filled from the price list before this is checked, so "no fare" refused
-- every priced route. The intake trigger has already reset the fare, so the
-- only fare that can be on the row here is the price list's own.
drop policy if exists bookings_public_insert on bookings;
create policy bookings_public_insert on bookings for insert with check (
  is_admin() or (
        status = 'requested'
    and assigned_boat_id    is null
    and assigned_captain_id is null
    and cancellation_reason is null
    and customer_id         is null
    and paid_at             is null
    and coalesce(amount_paid_cents, 0) = 0
    and tip_cents = 0
  )
);

-- The same limits for everyone, office included, so no path stores a novel.
-- NOT VALID: checked on every new write, without judging rows already there.
alter table bookings drop constraint if exists bookings_lengths_sane;
alter table bookings add constraint bookings_lengths_sane check (
      length(coalesce(contact_name, ''))  <= 100
  and length(coalesce(contact_phone, '')) <= 30
  and length(coalesce(notes, ''))         <= 1000
) not valid;


-- ── 3. what a captain may change on his own trip ─────────────────────────
/* Written as what he MAY change, so a column added later is locked until
   someone decides otherwise. He may answer an offer and move the trip along —
   aboard, then finished. Nothing else on the row is his.

   The generated money columns and updated_at are left out of the comparison:
   they are worked out by the database, not sent by anyone. */
create or replace function guard_captain_booking_update() returns trigger as $$
declare
  touched text[];
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  select array_agg(n.key order by n.key) into touched
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in (
      'status', 'captain_response', 'response_by', 'responded_at', 'decline_reason',
      'updated_at', 'vat_cents', 'total_cents'
    );

  if touched is not null then
    raise exception 'Captains can only answer an offer or move the trip along (not %)',
      array_to_string(touched, ', ');
  end if;

  -- Aboard only once the office has confirmed it; finished only once it was
  -- confirmed or under way. A captain cannot close out a trip nobody promised.
  if new.status is distinct from old.status then
    if not (
         (new.status = 'in_progress' and old.status = 'confirmed')
      or (new.status = 'completed'   and old.status in ('confirmed', 'in_progress'))
    ) then
      raise exception 'Captains can only mark a confirmed trip under way, then finished';
    end if;
  end if;

  -- An answer from a captain is his own, and only to a run he was asked about.
  if new.captain_response is distinct from old.captain_response
     or new.responded_at is distinct from old.responded_at
     or new.decline_reason is distinct from old.decline_reason then
    if old.offered_at is null then
      raise exception 'That run has not been offered to you';
    end if;
    if new.response_by is distinct from 'captain' then
      raise exception 'Captains answer as themselves';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;


-- ── 4. what a captain may read ───────────────────────────────────────────
/* Row-level security decides which trips a captain sees. Which COLUMNS of them
   he sees is a separate question, and the answer was "all of them". Three are
   the office's:

     access_token   — the passenger's key to their own trip
     contact_phone  — nobody is given a passenger's number; messages are the channel
     dispatch_notes — the office's private notes

   Column privileges belong to a database role, and the office and the captains
   share one ("authenticated"), so the table itself now withholds those three
   from everybody signed in. The office reads the full row through
   staff_bookings() below, which checks is_admin() for itself.

   Worked out from the table rather than typed, so it matches the columns that
   exist today. A column added later is NOT readable until it is granted —
   locked by default, the same principle as the guards above. */
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bookings'
    and column_name not in ('access_token', 'contact_phone', 'dispatch_notes');

  execute 'revoke select on bookings from anon, authenticated';
  execute format('grant select (%s) on bookings to authenticated', cols);
end $$;

/* The office's full view of the bookings. setof bookings, so it always carries
   every column the table has, and the API can still join boats onto it. */
create or replace function staff_bookings() returns setof bookings as $$
  select * from bookings where is_admin();
$$ language sql stable security definer set search_path = public;

comment on function staff_bookings is
  'Every booking with every column, for the office only. Captains read the table, which withholds the passenger''s link, number and the office notes.';

revoke all on function staff_bookings() from public, anon;
grant execute on function staff_bookings() to authenticated;
