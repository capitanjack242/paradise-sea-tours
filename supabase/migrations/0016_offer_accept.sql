-- Asking a captain, and recording the answer.
--
-- Nothing is promised to a passenger until a captain has said yes. That already
-- happens — Shavane rings them — but it lived in his head, so nobody else could
-- see whether a boat had actually agreed. This makes the asking and the answer
-- into data.
--
-- It records WHO answered as well as what: a captain tapping accept in the app,
-- and Shavane writing down what he was told on the phone, are both valid and
-- shouldn't look identical afterwards. Most captains have no app yet, so the
-- phone route is the normal one for now, not a fallback.

alter table bookings
  add column if not exists offered_at      timestamptz,
  add column if not exists responded_at    timestamptz,
  add column if not exists captain_response text
    check (captain_response in ('accepted', 'declined')),
  add column if not exists response_by     text
    check (response_by in ('captain', 'dispatch')),
  add column if not exists decline_reason  text;

comment on column bookings.response_by is
  'captain = tapped it themselves; dispatch = the office recorded a phone call.';

-- Changing the boat means asking somebody else. The old answer belonged to the
-- old captain and must not carry over — done here rather than in the interface
-- so it holds however the boat gets changed.
create or replace function reset_offer_on_reassign() returns trigger as $$
begin
  if new.assigned_boat_id is distinct from old.assigned_boat_id then
    new.offered_at       := null;
    new.responded_at     := null;
    new.captain_response := null;
    new.response_by      := null;
    new.decline_reason   := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_offer_reset on bookings;
create trigger bookings_offer_reset
  before update on bookings
  for each row execute function reset_offer_on_reassign();

-- A captain may now answer as well as move a trip along.
--
-- The status rule also gets a fix it needed anyway: it used to reject any
-- captain update whose status wasn't in_progress or completed, which caught
-- updates that didn't touch status at all. Accepting a run doesn't change the
-- status, so under the old rule it would have been refused.
create or replace function guard_captain_booking_update() returns trigger as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.assigned_captain_id is distinct from old.assigned_captain_id
     or new.assigned_boat_id   is distinct from old.assigned_boat_id
     or new.quoted_price_cents is distinct from old.quoted_price_cents
     or new.paid_out_at        is distinct from old.paid_out_at
     or new.offered_at         is distinct from old.offered_at
     or new.pickup             is distinct from old.pickup
     or new.destination        is distinct from old.destination
     or new.scheduled_at       is distinct from old.scheduled_at
     or new.return_at          is distinct from old.return_at
     or new.passengers         is distinct from old.passengers
     or new.contact_name       is distinct from old.contact_name
     or new.contact_phone      is distinct from old.contact_phone
     or new.dispatch_notes     is distinct from old.dispatch_notes then
    raise exception 'Captains can only answer an offer or move the trip along';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('in_progress', 'completed') then
    raise exception 'Captains can only mark a trip under way or finished';
  end if;

  -- An answer from a captain is their own, and only to a run they were asked
  -- about.
  if new.captain_response is distinct from old.captain_response then
    if old.offered_at is null then
      raise exception 'That run has not been offered to you';
    end if;
    if new.response_by is distinct from 'captain' then
      raise exception 'Captains answer as themselves';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The question dispatch asks all day: who has been asked and hasn't answered.
create index if not exists bookings_awaiting_captain_idx
  on bookings (offered_at)
  where offered_at is not null and captain_response is null;
