-- Where every boat is, so the office can see the fleet and a passenger can
-- watch theirs coming.
--
-- The position belongs to the boat, not to a trip. That is the whole point:
-- dispatch needs to see an idle boat as much as a working one, and a boat
-- sitting at the fuel dock with nothing on isn't attached to any booking.
--
-- It reports while the captain is switched on. Availability is already the
-- captain's own switch — the one he uses to say he is working today — and
-- hanging position on it means the software never follows a man who has
-- finished for the day. Switching off wipes the last position with it, so
-- there is no lingering pin on somebody who is at home.
--
--   · Dispatch sees every boat that is on.
--   · A passenger sees only the boat on their own live trip, and only a fix
--     under five minutes old — a stale pin tells someone standing on a dock
--     something untrue.
--
-- Foreground only for now: the phone reports while the captain has the app
-- open. Reporting with the app closed needs a background-location entitlement
-- from both stores, which is a separate job with its own review risk.

alter table boats
  add column if not exists last_lat        double precision,
  add column if not exists last_lng        double precision,
  add column if not exists last_located_at timestamptz;

comment on column boats.last_lat is
  'Where this boat last reported in. Null when the captain is switched off.';
comment on column boats.last_located_at is
  'When that fix was taken. Anything old is shown with its age, never as current.';

-- Half a coordinate is not a location, and a swapped pair puts the boat in the
-- Indian Ocean. Refused here so no interface can store one by accident.
alter table boats drop constraint if exists boats_position_complete;
alter table boats add constraint boats_position_complete
  check ((last_lat is null) = (last_lng is null));

alter table boats drop constraint if exists boats_position_on_earth;
alter table boats add constraint boats_position_on_earth
  check (
    (last_lat is null or last_lat between  -90 and  90) and
    (last_lng is null or last_lng between -180 and 180)
  );

/* One door for reporting it.

   A captain updating his boat row directly would be a wider grant than this
   needs — 0017's guard already stops him changing his own commission, and this
   keeps the same discipline. It takes a position and nothing else, and refuses
   unless he owns the boat and is switched on. */
create or replace function report_boat_position(
  p_lat double precision,
  p_lng double precision
) returns void as $$
declare
  mine uuid;
begin
  if p_lat is null or p_lng is null then
    raise exception 'A position needs both a latitude and a longitude';
  end if;

  select id into mine
  from boats
  where owner_id = auth.uid()
    and is_available
  limit 1;

  if mine is null then
    raise exception 'No boat of yours is switched on';
  end if;

  update boats
     set last_lat = p_lat, last_lng = p_lng, last_located_at = now()
   where id = mine;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function report_boat_position is
  'The captain reports where his boat is, while it is switched on. The only way this is set.';

revoke all on function report_boat_position(double precision, double precision) from public;
grant execute on function report_boat_position(double precision, double precision) to authenticated;

/* Switching off wipes the position with it.

   Availability already flips in two places — the captain's own switch, and the
   10pm close in 0018 — and both must forget where he was. A trigger catches
   every path at once, including any we add later. */
create or replace function forget_position_when_off() returns trigger as $$
begin
  if old.is_available and not new.is_available then
    new.last_lat := null;
    new.last_lng := null;
    new.last_located_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

comment on function forget_position_when_off is
  'Drops a boat''s position the moment it goes unavailable. Nobody is followed off the clock.';

drop trigger if exists boats_forget_position on boats;
create trigger boats_forget_position
  before update on boats
  for each row execute function forget_position_when_off();

-- 0017's guard lists what a captain may not change about his boat. The position
-- is not on that list — reporting it is the one thing he is meant to do — but
-- it goes through the function above rather than a direct write.

-- ── what the passenger sees ──────────────────────────────────────────────
-- Their own boat, only while their trip is running, and only a recent fix.
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
                      and bo.last_located_at > now() - interval '5 minutes'
                     then bo.last_lat end,
    'boat_lng', case when b.status in ('confirmed', 'in_progress')
                      and bo.last_located_at > now() - interval '5 minutes'
                     then bo.last_lng end,
    'boat_located_at', case when b.status in ('confirmed', 'in_progress')
                             and bo.last_located_at > now() - interval '5 minutes'
                            then bo.last_located_at end,
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

-- The public website reads boats through 0006's public_boats view, which names
-- its columns one by one. The coordinates added above are therefore not in it
-- and cannot leak to the publishable key — and the view is deliberately left
-- untouched here, because recreating it would drop its security_invoker
-- setting and the website's boat list with it.
