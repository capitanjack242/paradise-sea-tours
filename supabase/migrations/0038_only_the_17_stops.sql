-- Only the 17 stops on Jack's sheet can be booked.
--
-- The other ten (Cabbage Beach, Atlantis, The Sandbar …) came from the first
-- draft of the site and have no fares. They are switched off rather than
-- deleted: past bookings name them, and switching one back on is
--   update docks set is_active = true where name = '…';
update docks set is_active = false
 where name not in (
   'Nassau Cruise Port', 'Paradise Island – Margaritaville', 'Paradise Island – Carnival',
   'Pearl Island', 'Floating Bar', 'Blue Lagoon', 'Señor Frog''s', 'Green Parrot',
   'Poop Deck', 'Fort Montagu', 'Pigs Beach', 'Rose Island – Goodies', 'Junkanoo Beach',
   'Arawak Cay / Fish Fry', 'Goodman''s Bay', 'Breezes', 'Baha Mar');
