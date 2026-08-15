-- Friday payouts.
--
-- Marking the money as gone is recorded per trip rather than per week, which
-- sounds fussier but is the only version that survives real life: a trip
-- entered late, or corrected after the fact, lands in a week that was already
-- settled. Per trip, it simply shows up unpaid — because it is. Per week, it
-- would hide inside a box someone had already ticked.

alter table bookings
  add column if not exists paid_out_at timestamptz;

-- The payout view asks "which completed trips in this date range are unpaid",
-- for every boat, every week.
create index if not exists bookings_payout_idx
  on bookings (assigned_boat_id, scheduled_at)
  where status = 'completed';

-- A captain may move a trip along. Marking himself paid is not moving it along.
create or replace function guard_captain_booking_update() returns trigger as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.assigned_captain_id is distinct from old.assigned_captain_id
     or new.assigned_boat_id   is distinct from old.assigned_boat_id
     or new.quoted_price_cents is distinct from old.quoted_price_cents
     or new.paid_out_at        is distinct from old.paid_out_at
     or new.pickup             is distinct from old.pickup
     or new.destination        is distinct from old.destination
     or new.scheduled_at       is distinct from old.scheduled_at
     or new.passengers         is distinct from old.passengers
     or new.contact_name       is distinct from old.contact_name
     or new.contact_phone      is distinct from old.contact_phone
     or new.dispatch_notes     is distinct from old.dispatch_notes then
    raise exception 'Captains can only update the trip status';
  end if;

  if new.status not in ('in_progress', 'completed') then
    raise exception 'Captains can only mark a trip under way or finished';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
