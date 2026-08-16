-- Where the passenger actually is, so the captain can verify the meeting point.
--
-- The dock they picked is the plan; this is the fact. "Nassau Cruise Port" is a
-- long stretch of concrete with several places a boat can pull in, and a
-- passenger who has never been here before doesn't know which one he means.
--
-- Foreground only, like Uber and inDrive: the phone reports where it is while
-- the passenger has the app open and is asking for a boat. Nothing is collected
-- in the background, and a booking goes through perfectly well without it — a
-- refused permission must never cost us a fare.

alter table bookings
  add column if not exists pickup_lat  double precision,
  add column if not exists pickup_lng  double precision,
  add column if not exists located_at  timestamptz;

comment on column bookings.pickup_lat is
  'Passenger''s own position when they asked, if they shared it. Null is normal.';
comment on column bookings.located_at is
  'When that position was taken. A stale fix is worse than none — check the age.';

-- Half a coordinate is not a location, and a swapped pair puts the passenger in
-- the Indian Ocean. Refuse both here so no interface can store one by accident.
alter table bookings drop constraint if exists bookings_location_complete;
alter table bookings add constraint bookings_location_complete
  check ((pickup_lat is null) = (pickup_lng is null));

alter table bookings drop constraint if exists bookings_location_on_earth;
alter table bookings add constraint bookings_location_on_earth
  check (
    (pickup_lat is null or pickup_lat between  -90 and  90) and
    (pickup_lng is null or pickup_lng between -180 and 180)
  );

-- Nobody needs to keep a passenger's coordinates after the boat has come and
-- gone. Dropping them on close-out means the trip history — which we keep
-- forever, for payouts — carries no position data at all.
create or replace function forget_location_when_closed() returns trigger as $$
begin
  if new.status in ('completed', 'cancelled')
     and old.status not in ('completed', 'cancelled') then
    new.pickup_lat := null;
    new.pickup_lng := null;
    new.located_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

comment on function forget_location_when_closed is
  'Clears the passenger position once the trip is closed. Kept only while it is useful.';

drop trigger if exists bookings_forget_location on bookings;
create trigger bookings_forget_location
  before update on bookings
  for each row execute function forget_location_when_closed();
