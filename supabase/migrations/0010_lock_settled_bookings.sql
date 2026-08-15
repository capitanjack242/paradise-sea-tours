-- A closed-out trip is a record of what happened, not a working document. The
-- fare on it is what the captain is owed on Friday, so it shouldn't be possible
-- to nudge it afterwards — by a stray keystroke or anything else.
--
-- Dispatch notes stay open: writing down what went wrong is something you can
-- only do after the fact. Status stays open too, so a trip closed out by
-- mistake can be reopened — and reopening is what you do before correcting a
-- fare, which makes the correction deliberate instead of accidental.

create or replace function guard_settled_booking() returns trigger as $$
begin
  if old.status not in ('completed', 'cancelled') then
    return new;
  end if;

  if new.quoted_price_cents  is distinct from old.quoted_price_cents
     or new.assigned_boat_id    is distinct from old.assigned_boat_id
     or new.assigned_captain_id is distinct from old.assigned_captain_id then
    raise exception 'This trip is closed out — reopen it before changing the fare or the boat';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_settled_guard on bookings;
create trigger bookings_settled_guard
  before update on bookings
  for each row execute function guard_settled_booking();
