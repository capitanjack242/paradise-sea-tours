-- Rate first, tip second.
--
-- 0026 put tipping after the ride. This puts the rating in front of it, the way
-- Uber does: the passenger says how the captain did and how the trip went, and
-- only then is a tip offered — which is also the honest order, because a tip is
-- a verdict and the rating is where the verdict is actually made. A bad trip
-- shouldn't have a tip button as its first question.
--
-- Two scores, not one. The captain and the boat are different things and are
-- fixed by different people: a captain can be excellent on a boat that is late,
-- dirty or too small, and dispatch needs to know which of those it is looking at.

alter table bookings
  add column if not exists rating_captain smallint,
  add column if not exists rating_ride    smallint,
  add column if not exists rating_note    text,
  add column if not exists rated_at       timestamptz;

alter table bookings drop constraint if exists bookings_rating_sane;
alter table bookings add constraint bookings_rating_sane check (
  (rating_captain is null or rating_captain between 1 and 5)
  and (rating_ride is null or rating_ride between 1 and 5)
  and (rating_note is null or length(rating_note) <= 1000)
  -- A rating time with no rating, or a rating with no time, is a bug either way.
  and ((rated_at is null) = (rating_captain is null and rating_ride is null))
);

comment on column bookings.rating_captain is 'How the captain did, 1-5. Null until the passenger says.';
comment on column bookings.rating_ride    is 'How the trip itself was, 1-5 — the boat, the timing, the crossing.';
comment on column bookings.rating_note    is 'Anything they wanted to add. Optional, and often the useful part.';

-- ── the passenger writes it through their token ──────────────────────────
-- Same door as the rest of the trip page: no account, no table access, one
-- security-definer function that decides for itself what is allowed.
create or replace function trip_rate(
  p_token uuid,
  p_captain int,
  p_ride int,
  p_note text default null
) returns void as $$
declare
  target uuid;
begin
  if p_captain is null or p_ride is null then
    raise exception 'Rate both the captain and the trip.';
  end if;
  if p_captain not between 1 and 5 or p_ride not between 1 and 5 then
    raise exception 'A rating is between 1 and 5.';
  end if;

  -- The same week tipping is open for. Rating a months-old trip helps nobody,
  -- and the captain it would land on may have moved on.
  select id into target
  from bookings
  where access_token = p_token
    and status = 'completed'
    and completed_at > now() - interval '7 days';

  if target is null then
    raise exception 'That trip is closed.';
  end if;

  -- Deliberately allowed to be changed within the window: a mis-tapped star
  -- should be fixable, and a passenger who cools off is entitled to the change.
  update bookings
     set rating_captain = p_captain,
         rating_ride    = p_ride,
         rating_note    = nullif(btrim(coalesce(p_note, '')), ''),
         rated_at       = now()
   where id = target;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function trip_rate(uuid, int, int, text) from public;
grant execute on function trip_rate(uuid, int, int, text) to anon, authenticated;

comment on function trip_rate is
  'The passenger rates their captain and their trip, through the trip token, inside the week after it.';

-- ── what the passenger sees ──────────────────────────────────────────────
-- Supersedes 0026's version. Only two things change: the ratings come back, and
-- a tip is not offered until they exist.
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
    'completed_at', b.completed_at,
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
    'rating_captain', b.rating_captain,
    'rating_ride',    b.rating_ride,
    'rating_note',    b.rating_note,
    'rated_at',       b.rated_at,
    -- Open for the week after the ride, whether or not they have rated yet:
    -- a rating can be changed while the memory of the trip is still fresh.
    'can_rate', coalesce(
      b.status = 'completed'
      and b.assigned_boat_id is not null
      and b.completed_at > now() - interval '7 days', false),
    -- A tip is offered after the ride, to someone who ran it, for a week — and
    -- only once they've said how it went. Rate first, tip if it was warranted.
    'can_tip', coalesce(
      b.status = 'completed'
      and b.assigned_boat_id is not null
      and b.completed_at > now() - interval '7 days'
      and b.rated_at is not null, false),
    'can_reply', coalesce(
      b.status <> 'cancelled'
      and (b.status <> 'completed'
           or b.completed_at > now() - interval '7 days'), false),
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

-- ── what a captain is scored at ──────────────────────────────────────────
-- Read by dispatch and by the captain's own app. An average over few trips says
-- very little, so the count comes with it and the caller can decide what to show.
create or replace function boat_ratings()
returns table (
  boat_id uuid,
  rated_trips int,
  captain_avg numeric(3,2),
  ride_avg numeric(3,2)
) as $$
  select b.assigned_boat_id,
         count(*)::int,
         round(avg(b.rating_captain)::numeric, 2),
         round(avg(b.rating_ride)::numeric, 2)
  from bookings b
  where b.rated_at is not null
    and b.assigned_boat_id is not null
    -- Security definer, so it has to do its own scoping: dispatch sees the
    -- fleet, a captain sees his own boat and nobody else's score.
    and (is_admin() or exists (
          select 1 from boats bo
           where bo.id = b.assigned_boat_id and bo.owner_id = auth.uid()))
  group by b.assigned_boat_id;
$$ language sql stable security definer set search_path = public;

revoke all on function boat_ratings() from public;
grant execute on function boat_ratings() to authenticated;

comment on function boat_ratings is
  'Per-boat rating averages with the number of trips behind them. Staff only.';
