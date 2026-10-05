-- The real fares, from Jack's sheet (pickups.xlsx, 5 Oct 2026).
--
-- Sixteen destinations from Nassau Cruise Port, per person, each with a one-way
-- and a round-trip price. Two things the old price list couldn't express:
--
--   1. A round trip is its own price, not two one-ways. $10 out, $18 there and
--      back. quote_fare used to double the one-way; it now uses round_trip_cents
--      when a route has one, and doubles only when it doesn't.
--
--   2. Matching by exact stop name. The old matcher was fuzzy ("does one name
--      contain the other"), which was fine for three routes and wrong for
--      sixteen — "Nassau" would have matched anything with Nassau in it. Every
--      stop now comes from the docks table (0034), so the names are exact.
--
-- The three sample routes (Paradise Island & Atlantis, Cabbage Beach, Rose
-- Island & Cays — prices invented on day one) are switched off, not deleted:
-- old bookings still point at them. Trips between two stops that aren't on the
-- sheet arrive with no fare and the office quotes them, until they're priced.
--
-- Prices are BEFORE VAT, like every fare in the system: $10 + 10% VAT = $11.

-- ── round-trip price ─────────────────────────────────────────────────────
alter table services add column if not exists round_trip_cents int
  check (round_trip_cents is null or round_trip_cents > 0);

comment on column services.round_trip_cents is
  'Per-person price there and back, before VAT. Null means a round trip costs two one-ways.';

-- ── the stops ────────────────────────────────────────────────────────────
-- Where the sheet names a stop already on the list under another name, the
-- list takes the sheet's clearer wording. Bookings store the text they were
-- made with, so renaming a stop rewrites no history.
update docks set name = 'Paradise Island – Carnival'  where name = 'Carnival Restaurant, Paradise Island Marina';
update docks set name = 'Arawak Cay / Fish Fry'       where name = 'Fish Fry Dock';
update docks set name = 'Fort Montagu'                where name = 'Montagu Dock';
update docks set name = 'Breezes'                     where name = 'Breezes Beach';
update docks set name = 'Baha Mar'                    where name = 'Baha Mar Dock';
update docks set name = 'Green Parrot'                where name = 'Green Parrot Dock';
update docks set name = 'Poop Deck'                   where name = 'Poop Deck (East Bay Street)';

insert into docks (name, sort) values
  ('Nassau Cruise Port',                10),
  ('Paradise Island – Margaritaville',  20),
  ('Paradise Island – Carnival',        30),
  ('Pearl Island',                      40),
  ('Floating Bar',                      50),
  ('Blue Lagoon',                       60),
  ('Señor Frog''s',                     70),
  ('Green Parrot',                      80),
  ('Poop Deck',                         90),
  ('Fort Montagu',                     100),
  ('Pigs Beach',                       110),
  ('Rose Island – Goodies',            120),
  ('Junkanoo Beach',                   130),
  ('Arawak Cay / Fish Fry',            140),
  ('Goodman''s Bay',                   150),
  ('Breezes',                          160),
  ('Baha Mar',                         170)
on conflict (name) do update set sort = excluded.sort, is_active = true;

-- The rest stay bookable (the office quotes them) and sort after the priced stops.
update docks set sort = 200 + sort
 where name not in (
   'Nassau Cruise Port', 'Paradise Island – Margaritaville', 'Paradise Island – Carnival',
   'Pearl Island', 'Floating Bar', 'Blue Lagoon', 'Señor Frog''s', 'Green Parrot',
   'Poop Deck', 'Fort Montagu', 'Pigs Beach', 'Rose Island – Goodies', 'Junkanoo Beach',
   'Arawak Cay / Fish Fry', 'Goodman''s Bay', 'Breezes', 'Baha Mar')
   and sort < 200;

-- ── the fares ────────────────────────────────────────────────────────────
update services set is_active = false
 where slug in ('paradise-island', 'cabbage-beach', 'rose-island');

insert into services
  (slug, category, title, pricing_model, price_cents, round_trip_cents, from_point, to_point, sort)
values
  ('port-margaritaville', 'route', 'Paradise Island – Margaritaville', 'per_person', 1000, 1800, 'Nassau Cruise Port', 'Paradise Island – Margaritaville', 110),
  ('port-carnival',       'route', 'Paradise Island – Carnival',       'per_person', 1000, 1800, 'Nassau Cruise Port', 'Paradise Island – Carnival',       120),
  ('port-pearl-island',   'route', 'Pearl Island',                     'per_person', 3000, 4900, 'Nassau Cruise Port', 'Pearl Island',                     130),
  ('port-floating-bar',   'route', 'Floating Bar',                     'per_person', 2500, 4500, 'Nassau Cruise Port', 'Floating Bar',                     140),
  ('port-blue-lagoon',    'route', 'Blue Lagoon',                      'per_person', 3500, 6000, 'Nassau Cruise Port', 'Blue Lagoon',                      150),
  ('port-senor-frogs',    'route', 'Señor Frog''s',                    'per_person', 1000, 1800, 'Nassau Cruise Port', 'Señor Frog''s',                    160),
  ('port-green-parrot',   'route', 'Green Parrot',                     'per_person', 1000, 1800, 'Nassau Cruise Port', 'Green Parrot',                     170),
  ('port-poop-deck',      'route', 'Poop Deck',                        'per_person', 1200, 2000, 'Nassau Cruise Port', 'Poop Deck',                        180),
  ('port-fort-montagu',   'route', 'Fort Montagu',                     'per_person', 1600, 2800, 'Nassau Cruise Port', 'Fort Montagu',                     190),
  ('port-pigs-beach',     'route', 'Pigs Beach',                       'per_person', 2500, 4500, 'Nassau Cruise Port', 'Pigs Beach',                       200),
  ('port-rose-goodies',   'route', 'Rose Island – Goodies',            'per_person', 3500, 6000, 'Nassau Cruise Port', 'Rose Island – Goodies',            210),
  ('port-junkanoo-beach', 'route', 'Junkanoo Beach',                   'per_person', 1500, 2500, 'Nassau Cruise Port', 'Junkanoo Beach',                   220),
  ('port-fish-fry',       'route', 'Arawak Cay / Fish Fry',            'per_person', 1500, 2500, 'Nassau Cruise Port', 'Arawak Cay / Fish Fry',            230),
  ('port-goodmans-bay',   'route', 'Goodman''s Bay',                   'per_person', 3500, 6000, 'Nassau Cruise Port', 'Goodman''s Bay',                   240),
  ('port-breezes',        'route', 'Breezes',                          'per_person', 4000, 7000, 'Nassau Cruise Port', 'Breezes',                          250),
  ('port-baha-mar',       'route', 'Baha Mar',                         'per_person', 4000, 7000, 'Nassau Cruise Port', 'Baha Mar',                         260)
on conflict (slug) do update set
  title = excluded.title, pricing_model = excluded.pricing_model,
  price_cents = excluded.price_cents, round_trip_cents = excluded.round_trip_cents,
  from_point = excluded.from_point, to_point = excluded.to_point,
  sort = excluded.sort, is_active = true;

-- ── the quote ────────────────────────────────────────────────────────────
-- Exact stop names, either direction (a ride back costs the same as the ride
-- out). Charters stay with the office (0031).
create or replace function quote_fare(
  p_pickup      text,
  p_destination text,
  p_passengers  int,
  p_trip_type   text
) returns int as $$
  select greatest(coalesce(p_passengers, 1), 1)
         * case when p_trip_type = 'Round trip'
                then coalesce(s.round_trip_cents, s.price_cents * 2)
                else s.price_cents end
  from services s
  where s.category = 'route'
    and coalesce(p_trip_type, '') not ilike '%charter%'
    and s.is_active
    and s.price_cents is not null
    and (
         (lower(btrim(s.from_point)) = lower(btrim(p_pickup))
          and lower(btrim(s.to_point)) = lower(btrim(p_destination)))
      or (lower(btrim(s.from_point)) = lower(btrim(p_destination))
          and lower(btrim(s.to_point)) = lower(btrim(p_pickup)))
    )
  order by s.sort
  limit 1;
$$ language sql stable security definer set search_path = public;
