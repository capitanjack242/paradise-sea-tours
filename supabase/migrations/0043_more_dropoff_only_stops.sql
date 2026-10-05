-- Pigs Beach and Rose Island – Goodies are drop-off only too (Jack, 5 Oct 2026).
-- Same rule as 0040: still destinations, never a pickup on a public booking.
update docks set can_pickup = false
 where name in ('Pigs Beach', 'Rose Island – Goodies');
