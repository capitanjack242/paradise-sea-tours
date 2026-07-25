-- 5 demo boats/captains for the dispatch roster.
-- Fake WhatsApp numbers (555 = the standard fictional-number exchange) —
-- replace with real captain numbers when known.

insert into boats (name, kind, capacity, is_active, captain_name, captain_whatsapp, description, home_dock) values
  ('Island Hopper',    'Center Console', 6,  true,
   'Andre Munroe', '+12425550201',
   '22ft center console, shaded T-top — quick harbour hops & airport transfers',
   'Nassau Cruise Port'),
  ('Conch Pearl',       'Cruiser', 8,  true,
   'Latoya Bain', '+12425550202',
   '26ft cruiser, cushioned bow seating & built-in cooler — beach days & small groups',
   'Potter''s Cay Dock'),
  ('Blue Wave',         'Center Console', 6,  true,
   'Devon Adderley', '+12425550203',
   '24ft center console, fast & stable — fishing charters & quick Paradise Island runs',
   'Montagu Dock'),
  ('Paradise Express',  'Pontoon', 12, true,
   'Patrice Knowles', '+12425550204',
   '28ft pontoon, shaded lounge seating — larger groups & events',
   'Baha Mar Dock'),
  ('Reef Runner',       'Cruiser', 8,  false,
   'Kervin Ferguson', '+12425550205',
   '24ft cruiser rigged for fishing/snorkeling, rod holders & dive ladder',
   'Nassau Cruise Port');
