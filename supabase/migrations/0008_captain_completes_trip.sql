-- Completing a trip belongs to the captain who ran it, not to dispatch.
--
-- The existing update policy already lets the assigned captain edit their own
-- bookings, but it lets them edit *any* column — including the fare and who the
-- boat is. A captain marking "dropped off" should not be able to re-price the
-- trip they just ran, so narrow it to the status field alone.

create or replace function guard_captain_booking_update() returns trigger as $$
begin
  -- No JWT means this is running server-side (SQL editor, migration, service
  -- role). The public/anon path is already blocked by the update policy, which
  -- requires the row's captain or an admin, so this is not a way in.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.assigned_captain_id is distinct from old.assigned_captain_id
     or new.assigned_boat_id   is distinct from old.assigned_boat_id
     or new.quoted_price_cents is distinct from old.quoted_price_cents
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

drop trigger if exists bookings_captain_guard on bookings;
create trigger bookings_captain_guard
  before update on bookings
  for each row execute function guard_captain_booking_update();

-- A captain signs in to their own board, so they need to see the boats they own
-- (dispatch assigns by boat; the captain link is derived from boats.owner_id).
drop policy if exists boats_staff_read on boats;
create policy boats_staff_read on boats for select
  using (owner_id = auth.uid() or is_admin());
