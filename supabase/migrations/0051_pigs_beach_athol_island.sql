-- "Pigs Beach" becomes "Pigs Beach (Athol Island)" (Jack, 3 Nov 2026), so
-- visitors know which island the pigs are on.
--
-- Fares match stops by exact name (0037), so the dock and every route that
-- goes there are renamed together, in one transaction. It is drop-off only
-- (0043), so it only ever appears as a route's to_point. Bookings already made
-- keep the name they were made with; their price was fixed when they were made.
--
-- The website's page for the stop moves from /boat-to/pigs-beach/ to
-- /boat-to/pigs-beach-athol-island/; web/_redirects sends the old address on.

update docks set name = 'Pigs Beach (Athol Island)' where name = 'Pigs Beach';

update services
   set to_point = 'Pigs Beach (Athol Island)',
       title    = case when title = 'Pigs Beach' then 'Pigs Beach (Athol Island)' else title end
 where to_point = 'Pigs Beach';
