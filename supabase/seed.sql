-- Seed the bookable offerings shown on the marketing site.
-- Prices in cents. Update with real rates as they firm up.

insert into services (slug, category, title, description, pricing_model, price_cents, from_point, to_point, est_minutes, capacity, sort) values
  -- routes (per person)
  ('paradise-island', 'route', 'Paradise Island & Atlantis', 'Atlantis, the beach club and the marina.', 'per_person', 1500, 'Nassau Cruise Port', 'Paradise Island', 10, null, 10),
  ('cabbage-beach',   'route', 'Cabbage Beach',              'One of Nassau''s best beaches by water.',   'per_person', 1500, 'Nassau Cruise Port', 'Cabbage Beach',   12, null, 20),
  ('rose-island',     'route', 'Rose Island & Cays',         'Quiet beaches, snorkeling and the Sandbar.', 'per_person', 2500, 'Nassau',             'Rose Island',     25, null, 30),

  -- private charters (per hour)
  ('charter-6',  'charter', '6-Guest Boat',     'Center console — harbour & island hops.', 'per_hour', 12000, null, null, null, 6,  40),
  ('charter-8',  'charter', '8-Guest Cruiser',  'Seating & cooler — beach days and cays.', 'per_hour', 15000, null, null, null, 8,  50),
  ('charter-lux','charter', 'Luxury Charter',   'Premium comfort for groups & events.',    'per_hour', 25000, null, null, null, 12, 60),

  -- fishing tours (per boat)
  ('fishing-reef',    'fishing', 'Reef Fishing',         'Bottom fishing on the reefs — family friendly.', 'per_boat', 40000, null, null, 240, null, 70),
  ('fishing-deepsea', 'fishing', 'Deep-Sea / Offshore',  'Troll the deep blue for mahi, tuna, wahoo.',     'per_boat', 70000, null, null, 240, null, 80),
  ('fishing-sunset',  'fishing', 'Sunset & Flats',       'Evening reef trips and bonefishing flats.',      'per_boat', null,  null, null, null, null, 90);
