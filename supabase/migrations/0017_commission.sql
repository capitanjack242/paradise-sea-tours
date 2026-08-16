-- Paradise takes a commission on every ride, so a boat's earnings and what a
-- boat is actually handed on Friday are two different numbers. Both screens
-- showed the first one and called it the second.
--
-- The rate lives on the boat rather than in code: it can change without a
-- release, dispatch and the captain app read the same figure so they can't
-- disagree, and a captain on a different deal is a row edit rather than a
-- special case.
--
-- Default is 0 deliberately. Until somebody sets a real rate, every screen
-- shows the full fare exactly as it does today — no invented percentage
-- quietly deducted from what a captain thinks he's owed.

alter table boats
  add column if not exists commission_pct numeric(5,2) not null default 0
    check (commission_pct >= 0 and commission_pct < 100);

comment on column boats.commission_pct is
  'Percent of the fare Paradise keeps. 0 = the boat is paid the whole fare.';

-- A captain may set his availability. He may not set his own commission.
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
     or new.commission_pct   is distinct from old.commission_pct
     or new.captain_name     is distinct from old.captain_name
     or new.captain_whatsapp is distinct from old.captain_whatsapp
     or new.home_dock is distinct from old.home_dock
     or new.photo_url is distinct from old.photo_url then
    raise exception 'Captains can only change whether they are available';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Set the real rate once it's agreed, e.g. 25% across the fleet:
--   update boats set commission_pct = 25;
