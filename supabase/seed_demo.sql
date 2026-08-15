-- Demo data: clears the test bookings accumulated during the build, then seeds
-- a few weeks of plausible trade so every tab has something real to show.
--
-- DESTRUCTIVE. It removes ALL bookings — the wiring tests, the browser checks,
-- and anything genuine that happens to be in there. It's meant to be run while
-- the system is still empty of real work.
--
-- Everything it creates is tagged [DEMO] in dispatch_notes, so it comes out
-- again with one line (at the bottom of this file, commented).

begin;

-- Messages hang off bookings with on delete cascade, so they go too.
delete from bookings;

-- Dates are relative to whenever this runs, so the weeks always straddle
-- "now" the way they should: two settled weeks behind, this week in progress,
-- a couple of trips still ahead.
insert into bookings (
  contact_name, contact_phone, pickup, destination, scheduled_at,
  passengers, trip_type, status, quoted_price_cents,
  assigned_boat_id, assigned_captain_id, paid_out_at, notes, dispatch_notes
)
select
  v.name,
  v.phone,
  v.pickup,
  v.dest,
  date_trunc('day', now()) + (v.days || ' days')::interval + (v.hour || ' hours')::interval,
  v.pax,
  v.trip,
  v.status::booking_status,
  v.cents,
  bo.id,
  bo.owner_id,
  case when v.paid then date_trunc('day', now()) - interval '2 days' else null end,
  v.notes,
  '[DEMO] seeded sample data'
from (values
  -- ── two weeks back, settled ──────────────────────────────────────────────
  ('Marcus Rolle',     '+12425550122', 'Nassau Cruise Port', 'Paradise Island & Atlantis', -16,  9, 2, 'One way',    'completed',  3000, 'Blue Wave',        true,  null),
  ('Dana Whitfield',   '+12425550164', 'Nassau Cruise Port', 'Rose Island & Cays',         -15, 10, 4, 'One way',    'completed', 10000, 'Blue Wave',        true,  'Snorkel gear if possible'),
  ('Tom Braddock',     '+14155550132', 'Fish Fry Dock',      'Paradise Island & Atlantis', -15, 14, 2, 'Round trip', 'completed',  6000, 'Conch Pearl',      true,  null),
  ('Aaliyah Brown',    '+12425550199', 'Love Beach',         'Sandyport',                  -14, 11, 3, 'One way',    'completed',  4500, 'Island Hopper',    true,  null),
  ('Élodie Marchand',  '+33612345678', 'Nassau Cruise Port', 'Cabbage Beach',              -13, 12, 6, 'Round trip', 'completed', 18000, 'Blue Wave',        true,  'Celebrating a birthday'),

  -- ── last week, settled ───────────────────────────────────────────────────
  ('Devante Ferguson', '+12425550187', 'Potter''s Cay Dock', 'Rose Island & Cays',          -9, 8, 5, 'Round trip', 'completed', 25000, 'Reef Runner',      true,  null),
  ('Dana Whitfield',   '+12425550164', 'Nassau Cruise Port', 'Paradise Island & Atlantis',  -8, 16, 2, 'One way',    'completed',  3000, 'Blue Wave',        true,  null),
  ('Sarah Mitchell',   '+447911123456','Baha Mar Dock',      'The Sandbar',                 -8, 13, 8, 'One way',    'completed', 12000, 'Paradise Express', true,  'One wheelchair user in the party'),
  ('Kenji Watanabe',   '+819012345678','Nassau Cruise Port', 'Rose Island & Cays',          -7, 10, 2, 'One way',    'completed',  5000, 'Conch Pearl',      true,  null),
  ('Marcus Rolle',     '+12425550122', 'Green Parrot Dock',  'Paradise Island & Atlantis',  -6, 18, 4, 'One way',    'completed',  6000, 'Island Hopper',    true,  null),


  -- ── today and ahead ──────────────────────────────────────────────────────
  ('Sarah Mitchell',   '+447911123456','Nassau Cruise Port', 'Cabbage Beach',                1, 20, 2, 'One way',    'confirmed',  3000, 'Blue Wave',        false, null),
  ('Kenji Watanabe',   '+819012345678','Baha Mar Dock',      'The Sandbar',                  1, 11, 6, 'Round trip', 'confirmed', 18000, 'Conch Pearl',      false, null),
  ('Marcus Rolle',     '+12425550122', 'Nassau Cruise Port', 'Paradise Island & Atlantis',   2, 10, 2, 'One way',    'requested',  3000, null,               false, null),
  ('Priya Raghunath',  '+12425550143', 'Long Wharf Beach',   'Rose Island & Cays',           3, 13, 5, 'Round trip', 'requested', 25000, null,               false, 'First time in Nassau'),

  -- ── one that fell over, so Cancelled isn't empty ─────────────────────────
  ('Tom Braddock',     '+14155550132', 'Nassau Cruise Port', 'Rose Island & Cays',          -5, 12, 4, 'One way',    'cancelled', 10000, 'Blue Wave',        false, null)
) as v(name, phone, pickup, dest, days, hour, pax, trip, status, cents, boat, paid, notes)
left join boats bo on bo.name = v.boat;

-- ── run earlier today, not yet paid ────────────────────────────────────────
-- Placed hours before now rather than days, so they always land inside the pay
-- week currently running whatever day this is run. Anchored to a date instead,
-- a Saturday run would drop half of them into the week already settled.
insert into bookings (
  contact_name, contact_phone, pickup, destination, scheduled_at,
  passengers, trip_type, status, quoted_price_cents,
  assigned_boat_id, assigned_captain_id, dispatch_notes
)
select v.name, v.phone, v.pickup, v.dest, now() - (v.hours_ago || ' hours')::interval,
       v.pax, v.trip, 'completed'::booking_status, v.cents, bo.id, bo.owner_id,
       '[DEMO] seeded sample data'
from (values
  ('Tom Braddock',     '+14155550132', 'Nassau Cruise Port', 'Rose Island & Cays',         9, 4, 'One way',    10000, 'Blue Wave'),
  ('Aaliyah Brown',    '+12425550199', 'Fish Fry Dock',      'Cabbage Beach',              7, 2, 'Round trip',  6000, 'Conch Pearl'),
  ('Devante Ferguson', '+12425550187', 'Nassau Cruise Port', 'Paradise Island & Atlantis', 5, 3, 'One way',     4500, 'Blue Wave'),
  ('Élodie Marchand',  '+33612345678', 'Montagu Dock',       'Rose Island & Cays',         3, 2, 'One way',     5000, 'Island Hopper')
) as v(name, phone, pickup, dest, hours_ago, pax, trip, cents, boat)
left join boats bo on bo.name = v.boat;

-- Tonight's trip: a few hours out whatever time this is run, so the captain
-- board always has something live on it.
insert into bookings (
  contact_name, contact_phone, pickup, destination, scheduled_at,
  passengers, trip_type, status, quoted_price_cents,
  assigned_boat_id, assigned_captain_id, notes, dispatch_notes
)
select 'Dana Whitfield', '+12425550164', 'Nassau Cruise Port', 'Rose Island & Cays',
       now() + interval '3 hours', 4, 'One way', 'confirmed'::booking_status, 10000,
       bo.id, bo.owner_id, 'Anniversary — snorkel gear if possible', '[DEMO] seeded sample data'
from boats bo where bo.name = 'Blue Wave';

-- ── a couple of live conversations ─────────────────────────────────────────
-- Tonight's trip, mid-exchange: the passenger has asked something nobody has
-- answered, so dispatch and the captain both see it flagged as waiting.
insert into messages (booking_id, sender, body, created_at)
select b.id, m.sender, m.body, now() - (m.mins || ' minutes')::interval
from bookings b
cross join (values
  ('dispatch', 'Your boat is confirmed — Blue Wave, Capt. Devon Adderley. He''ll meet you at the dock.', 95),
  ('customer', 'Perfect. Where exactly do we find him?', 70),
  ('captain',  'Dock 3, past the yellow gate. Blue boat, name''s Blue Wave on the side.', 55),
  ('customer', 'Found it. Four of us, one with a bad knee — is boarding easy?', 12)
) as m(sender, body, mins)
where b.contact_name = 'Dana Whitfield'
  and b.status = 'confirmed'
  and b.dispatch_notes like '[DEMO]%';

-- A finished trip with something left over, showing dispatch can still speak
-- on a closed thread when the captain no longer can.
insert into messages (booking_id, sender, body, created_at)
select b.id, m.sender, m.body, now() - (m.mins || ' minutes')::interval
from bookings b
cross join (values
  ('customer', 'Think I left a blue jacket on the boat!', 2800),
  ('dispatch', 'We have it at the office — we''ll hold it for you.', 2700)
) as m(sender, body, mins)
where b.contact_name = 'Élodie Marchand'
  and b.status = 'completed'
  and b.dispatch_notes like '[DEMO]%'
  and b.scheduled_at < now() - interval '10 days';

commit;

-- What landed.
select
  count(*)                                            as bookings,
  count(*) filter (where status = 'completed')        as completed,
  count(*) filter (where status = 'confirmed')        as confirmed,
  count(*) filter (where status = 'requested')        as awaiting,
  count(*) filter (where status = 'cancelled')        as cancelled,
  count(distinct contact_phone)                       as clients,
  (select count(*) from messages)                     as messages,
  '$' || (sum(quoted_price_cents) filter (where status = 'completed' and paid_out_at is null) / 100)::text
                                                      as owed_this_week
from bookings;

-- To remove all of this again:
--   delete from bookings where dispatch_notes like '[DEMO]%';
