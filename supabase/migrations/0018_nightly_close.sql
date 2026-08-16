-- Everyone goes off at 10pm, whether or not they remembered to.
--
-- Written as "switch off anyone whose availability predates the most recent
-- 10pm" rather than "at 10pm, switch everyone off". The difference matters: the
-- second only works if the job fires at exactly the right minute, and silently
-- leaves the fleet marked available all night if it doesn't. This version
-- corrects itself on the next run whenever that happens to be.
--
-- Times are Nassau's, not the server's. Nassau keeps daylight saving, so a
-- fixed UTC hour would drift an hour twice a year and close the fleet at 9pm
-- half the year.

create or replace function nassau_last_close() returns timestamptz as $$
  select case
    when (now() at time zone 'America/Nassau')::time >= time '22:00'
      -- Already past 10pm tonight, so tonight's close is the one that counts.
      then ((now() at time zone 'America/Nassau')::date + time '22:00')
             at time zone 'America/Nassau'
      -- Before 10pm, so the last close was yesterday's.
      else (((now() at time zone 'America/Nassau')::date - 1) + time '22:00')
             at time zone 'America/Nassau'
  end;
$$ language sql stable;

comment on function nassau_last_close is
  'The most recent 10pm in Nassau. Availability set before it has expired.';

create or replace function close_boats_for_the_night() returns integer as $$
declare
  closed integer;
begin
  update boats
  set is_available = false
  where is_available
    and (availability_changed_at is null or availability_changed_at < nassau_last_close());
  get diagnostics closed = row_count;
  return closed;
end;
$$ language plpgsql security definer set search_path = public;

comment on function close_boats_for_the_night is
  'Switches off any boat still marked available from before the last 10pm.';

-- Hourly rather than once at 10pm: a missed run costs an hour, not a night.
-- Running it at other times is harmless — before 10pm nothing has expired yet.
-- Requires pg_cron (Database → Extensions in the Supabase dashboard).
select cron.unschedule('close-boats-for-the-night')
where exists (select 1 from cron.job where jobname = 'close-boats-for-the-night');

select cron.schedule(
  'close-boats-for-the-night',
  '5 * * * *',
  $$select close_boats_for_the_night()$$
);
