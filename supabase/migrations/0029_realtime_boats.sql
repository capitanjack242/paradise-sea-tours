-- Let dispatch hear about boats as they change.
--
-- The realtime publication carried bookings (0007) and messages (0013) but never
-- boats, so a captain switching on, or a position landing every 45 seconds,
-- reached the database and stopped there. Dispatch loaded the fleet once at
-- sign-in and drew that snapshot for the rest of the day — the map I built
-- against it could not have moved a pin without a page reload.
--
-- Realtime respects row-level security, so a subscriber only hears about boats
-- they could read anyway: dispatch the fleet, a captain his own.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'boats'
  ) then
    alter publication supabase_realtime add table boats;
  end if;
end $$;
