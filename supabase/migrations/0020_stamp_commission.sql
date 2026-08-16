-- Remember the commission rate a trip was actually closed out at.
--
-- The rate lived only on the boat, and every screen read it live. That meant
-- changing a boat's rate rewrote history: a captain paid $315 in July would
-- open the app in August, after a rate change, and see July showing $300. The
-- number he was paid and the number on his screen would disagree, and the
-- screen would be wrong.
--
-- So the rate is stamped onto the trip when it completes, the same way the
-- fare is locked at that moment. A live trip still reads the boat's current
-- rate — nothing is owed yet, so there is nothing to protect.

alter table bookings
  add column if not exists commission_pct numeric(5,2);

alter table bookings drop constraint if exists bookings_commission_sane;
alter table bookings add constraint bookings_commission_sane
  check (commission_pct is null or (commission_pct >= 0 and commission_pct < 100));

comment on column bookings.commission_pct is
  'The rate this trip was closed out at. Null while it is still running — read the boat.';

-- Trips already completed get today's rate written onto them. It is the rate
-- they were paid at, and freezing it here is what stops the next rate change
-- from moving them. Deliberately before the guard below is replaced, or the
-- guard would refuse this.
update bookings b
   set commission_pct = boats.commission_pct
  from boats
 where boats.id = b.assigned_boat_id
   and b.status = 'completed'
   and b.commission_pct is null;

create or replace function stamp_commission_on_close() returns trigger as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.commission_pct is null then
    select boats.commission_pct into new.commission_pct
      from boats where boats.id = new.assigned_boat_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

comment on function stamp_commission_on_close is
  'Writes the boat''s rate onto the trip as it completes, so later rate changes leave it alone.';

drop trigger if exists bookings_stamp_commission on bookings;
create trigger bookings_stamp_commission
  before update on bookings
  for each row execute function stamp_commission_on_close();

-- 0010's guard, extended: a closed-out trip's commission is now as fixed as
-- its fare. Reopen the trip first if it genuinely needs correcting, which is
-- what makes the correction deliberate rather than accidental.
create or replace function guard_settled_booking() returns trigger as $$
begin
  if old.status not in ('completed', 'cancelled') then
    return new;
  end if;

  if new.quoted_price_cents  is distinct from old.quoted_price_cents
     or new.commission_pct      is distinct from old.commission_pct
     or new.assigned_boat_id    is distinct from old.assigned_boat_id
     or new.assigned_captain_id is distinct from old.assigned_captain_id then
    raise exception 'This trip is closed out — reopen it before changing the fare or the boat';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The function above is only half of it: 0010 created the trigger, and
-- replacing a function does not attach one. Recreated here so this migration
-- stands on its own.
drop trigger if exists bookings_settled_guard on bookings;
create trigger bookings_settled_guard
  before update on bookings
  for each row execute function guard_settled_booking();
