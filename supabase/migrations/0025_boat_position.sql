-- Where the boat is, so a passenger can watch it coming.
--
-- The mirror of 0019. That one lets a passenger show the captain where they're
-- standing; this one lets a captain show the passenger where the boat is. Same
-- rules on both sides, because it's the same trade: a live position is useful
-- for exactly as long as the trip lasts and is nobody's business afterwards.
--
--   · The captain turns it on. It is off by default, per trip, and he can stop
--     it at any moment — a captain's whereabouts is not something the software
--     helps itself to.
--   · Only the passenger on that trip ever sees it, and only while the trip is
--     live. A stale fix is not shown at all: a pin that's twenty minutes old
--     tells a passenger something false about where the boat is.
--   · It is dropped when the trip closes, so trip history carries no position.
--
-- Foreground only, the same limitation the passenger side has: the phone
-- reports while the captain has the app open. Background location needs an
-- entitlement from both stores and a reason they accept, and that is a separate
-- job from this one.

alter table bookings
  add column if not exists boat_lat        double precision,
  add column if not exists boat_lng        double precision,
  add column if not exists boat_located_at timestamptz;

comment on column bookings.boat_lat is
  'Where the boat was when the captain last reported it. Null means he is not sharing.';
comment on column bookings.boat_located_at is
  'When that fix was taken. Anything older than a few minutes is not shown to the passenger.';

-- Half a coordinate is not a location, and a swapped pair puts the boat in the
-- Indian Ocean. Refused here so no interface can store one by accident.
alter table bookings drop constraint if exists bookings_boat_location_complete;
alter table bookings add constraint bookings_boat_location_complete
  check ((boat_lat is null) = (boat_lng is null));

alter table bookings drop constraint if exists bookings_boat_location_on_earth;
alter table bookings add constraint bookings_boat_location_on_earth
  check (
    (boat_lat is null or boat_lat between  -90 and  90) and
    (boat_lng is null or boat_lng between -180 and 180)
  );

-- 0019's trigger, extended: the boat's position goes the same way the
-- passenger's does when the trip closes out.
create or replace function forget_location_when_closed() returns trigger as $$
begin
  if new.status in ('completed', 'cancelled')
     and old.status not in ('completed', 'cancelled') then
    new.pickup_lat := null;
    new.pickup_lng := null;
    new.located_at := null;
    new.boat_lat := null;
    new.boat_lng := null;
    new.boat_located_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_forget_location on bookings;
create trigger bookings_forget_location
  before update on bookings
  for each row execute function forget_location_when_closed();

/* One door for reporting it.
   A captain updating his own row directly would be a wider grant than this
   needs — he'd be able to touch every other column too. This takes a position
   and nothing else, and refuses if the trip isn't his or isn't running. */
create or replace function report_boat_position(
  p_booking uuid,
  p_lat     double precision,
  p_lng     double precision
) returns void as $$
declare
  ok boolean;
begin
  if p_lat is null or p_lng is null then
    raise exception 'A position needs both a latitude and a longitude';
  end if;

  select true into ok
  from bookings b
  where b.id = p_booking
    and b.assigned_captain_id = auth.uid()
    and b.status in ('confirmed', 'in_progress');

  if not coalesce(ok, false) then
    raise exception 'That trip is not yours, or it is not running';
  end if;

  update bookings
     set boat_lat = p_lat, boat_lng = p_lng, boat_located_at = now()
   where id = p_booking;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function report_boat_position is
  'The assigned captain reports where the boat is, on a trip that is running. The only way this is set.';

revoke all on function report_boat_position(uuid, double precision, double precision) from public;
grant execute on function report_boat_position(uuid, double precision, double precision) to authenticated;

/* And one to stop, so putting the toggle off actually clears the pin rather
   than leaving the last known position sitting there going stale. */
create or replace function stop_sharing_boat_position(p_booking uuid)
returns void as $$
begin
  update bookings
     set boat_lat = null, boat_lng = null, boat_located_at = null
   where id = p_booking
     and assigned_captain_id = auth.uid();
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function stop_sharing_boat_position(uuid) from public;
grant execute on function stop_sharing_boat_position(uuid) to authenticated;

-- ── what the passenger sees ──────────────────────────────────────────────
-- The position is returned only while the trip is live AND the fix is recent.
-- Showing a pin from twenty minutes ago would tell someone standing on a dock
-- something false about where their boat is, which is worse than showing
-- nothing at all.
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
    'tip_cents',   b.tip_cents,
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
    'boat_lat', case when b.status in ('confirmed', 'in_progress')
                      and b.boat_located_at > now() - interval '5 minutes'
                     then b.boat_lat end,
    'boat_lng', case when b.status in ('confirmed', 'in_progress')
                      and b.boat_located_at > now() - interval '5 minutes'
                     then b.boat_lng end,
    'boat_located_at', case when b.status in ('confirmed', 'in_progress')
                             and b.boat_located_at > now() - interval '5 minutes'
                            then b.boat_located_at end,
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
