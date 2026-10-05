-- Some stops are drop-off only.
--
-- Pearl Island, Floating Bar and Blue Lagoon are places people go, not places a
-- trip starts from (Jack, 5 Oct 2026). A round trip there is fine — the boat
-- that took them brings them back — but nobody books a pickup from one.
--
-- can_pickup on the dock decides it. The website and the app leave these off
-- the "Pick you up at" list, and a public booking that names one as its pickup
-- is refused here as well, so no route around the forms can book one. The
-- office can still book anything by hand.

alter table docks add column if not exists can_pickup boolean not null default true;

comment on column docks.can_pickup is
  'False for drop-off-only stops: offered as a destination, never as a pickup.';

update docks set can_pickup = false
 where name in ('Pearl Island', 'Floating Bar', 'Blue Lagoon');

create or replace function refuse_dropoff_only_pickup() returns trigger as $$
begin
  -- The same caller test as public_booking_intake (0031): only the public and
  -- signed-in non-staff are held to the forms' rules.
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       '') not in ('anon', 'authenticated')
     or is_admin() then
    return new;
  end if;

  if exists (select 1 from docks where name = new.pickup and not can_pickup) then
    raise exception 'We don''t pick up from %. Choose where you''re starting from, and pick % as where you''re going.',
      new.pickup, new.pickup;
  end if;
  return new;
end;
$$ language plpgsql stable security definer set search_path = public;

drop trigger if exists bookings_b_dropoff_only on bookings;
create trigger bookings_b_dropoff_only
  before insert on bookings
  for each row execute function refuse_dropoff_only_pickup();
