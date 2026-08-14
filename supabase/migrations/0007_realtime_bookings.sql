-- Let the dispatch view receive live booking changes instead of polling.
-- Realtime still enforces RLS: only staff (is_admin) receive these events,
-- because the bookings_read policy gates who can see each row.
alter publication supabase_realtime add table bookings;
