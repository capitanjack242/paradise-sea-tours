-- A round trip's return time was being written into the notes field as prose:
--   "Return leg: 4:00 PM"
-- which meant the one piece of information that decides whether a captain goes
-- back for someone lived in a free-text box, below whatever else they'd typed.
-- Easy to skim past, impossible to sort or filter by, and invisible to anything
-- that isn't a human reading carefully.

alter table bookings
  add column if not exists return_at timestamptz;

-- Nothing sensible can be recovered from the old prose — it was written in the
-- customer's own locale with no date attached — so existing rows keep their
-- note and gain no return_at. Dispatch still sees the text on those.
comment on column bookings.return_at is
  'Round trips only: when the boat collects them again. Null for one-way and charters.';

-- Finding the return legs still to run is the question a dispatcher asks all
-- afternoon.
create index if not exists bookings_return_idx
  on bookings (return_at)
  where return_at is not null and status not in ('completed', 'cancelled');

-- A return before the outbound is a typo, not a booking. Cheap to refuse here
-- so no interface can create one by accident.
alter table bookings drop constraint if exists bookings_return_after_departure;
alter table bookings add constraint bookings_return_after_departure
  check (return_at is null or scheduled_at is null or return_at > scheduled_at);
