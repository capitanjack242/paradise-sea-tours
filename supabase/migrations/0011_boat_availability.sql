-- Captains say whether they're working today, and dispatch can see it before
-- offering anyone a run.
--
-- Default is false rather than true: a boat is only available once somebody has
-- actually said so. A stamp goes with it, because "available" set at 7am today
-- and "available" left on since last Tuesday are not the same claim, and
-- dispatch needs to tell them apart.

alter table boats
  add column if not exists is_available boolean not null default false,
  add column if not exists availability_changed_at timestamptz;

-- Stamped here rather than by the client, so the time is the moment the
-- database saw the change and not whatever a phone's clock believes.
create or replace function stamp_boat_availability() returns trigger as $$
begin
  if new.is_available is distinct from old.is_available then
    new.availability_changed_at := now();
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists boats_availability_stamp on boats;
create trigger boats_availability_stamp
  before update on boats
  for each row execute function stamp_boat_availability();

-- The owner policy lets a captain write to their own boat, which would include
-- renaming it or changing its capacity. Availability is the only part of it
-- that is theirs to change.
create or replace function guard_captain_boat_update() returns trigger as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.name        is distinct from old.name
     or new.kind     is distinct from old.kind
     or new.capacity is distinct from old.capacity
     or new.owner_id is distinct from old.owner_id
     or new.is_active is distinct from old.is_active
     or new.captain_name     is distinct from old.captain_name
     or new.captain_whatsapp is distinct from old.captain_whatsapp
     or new.home_dock is distinct from old.home_dock
     or new.photo_url is distinct from old.photo_url then
    raise exception 'Captains can only change whether they are available';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists boats_captain_guard on boats;
create trigger boats_captain_guard
  before update on boats
  for each row execute function guard_captain_boat_update();
