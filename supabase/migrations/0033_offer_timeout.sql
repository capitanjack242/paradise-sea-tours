-- An offer nobody answers stops being an offer.
--
-- Until now a run offered to a captain who never replied sat on the board as
-- "waiting on an answer" for ever. Dispatch had to notice, and a passenger had
-- to wait while nobody did. The run alert itself gives up after ten minutes
-- (notify-captain's ttl), so a captain who hasn't answered by then almost
-- certainly never saw it.
--
-- After fifteen minutes the offer is closed as 'no_answer'. Dispatch sees it in
-- red with "Ask again", or picks another boat. The captain can no longer take a
-- run the office may already have given to someone else — he calls the office.

alter table bookings drop constraint if exists bookings_captain_response_check;
alter table bookings add constraint bookings_captain_response_check
  check (captain_response in ('accepted', 'declined', 'no_answer'));

alter table bookings drop constraint if exists bookings_response_by_check;
alter table bookings add constraint bookings_response_by_check
  check (response_by in ('captain', 'dispatch', 'system'));

comment on column bookings.response_by is
  'captain = tapped it themselves; dispatch = the office recorded a phone call; system = nobody answered in time.';

/* How long an offer stays open. One place, so the board and the database
   can't disagree about it. */
create or replace function offer_timeout() returns interval as $$
  select interval '15 minutes';
$$ language sql immutable;

create or replace function expire_unanswered_offers() returns integer as $$
declare
  closed integer;
begin
  update bookings
     set captain_response = 'no_answer',
         response_by      = 'system',
         responded_at     = now()
   where offered_at is not null
     and captain_response is null
     and offered_at < now() - offer_timeout()
     and status not in ('completed', 'cancelled');
  get diagnostics closed = row_count;
  return closed;
end;
$$ language plpgsql security definer set search_path = public;

comment on function expire_unanswered_offers is
  'Closes offers nobody answered within offer_timeout(). Run every minute by pg_cron.';

-- Every minute: an offer closes at most a minute late. Needs pg_cron, which
-- 0018 already relies on.
select cron.unschedule('expire-unanswered-offers')
where exists (select 1 from cron.job where jobname = 'expire-unanswered-offers');

select cron.schedule('expire-unanswered-offers', '* * * * *', $$select expire_unanswered_offers()$$);

/* The captain guard (0031), with one more rule: a closed offer is closed. He
   can't answer one that timed out — the office may have moved on — and he
   can't reopen one himself. Everything else is as 0031 wrote it. */
create or replace function guard_captain_booking_update() returns trigger as $$
declare
  touched text[];
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  select array_agg(n.key order by n.key) into touched
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in (
      'status', 'captain_response', 'response_by', 'responded_at', 'decline_reason',
      'updated_at', 'vat_cents', 'total_cents'
    );

  if touched is not null then
    raise exception 'Captains can only answer an offer or move the trip along (not %)',
      array_to_string(touched, ', ');
  end if;

  if new.status is distinct from old.status then
    if not (
         (new.status = 'in_progress' and old.status = 'confirmed')
      or (new.status = 'completed'   and old.status in ('confirmed', 'in_progress'))
    ) then
      raise exception 'Captains can only mark a confirmed trip under way, then finished';
    end if;
  end if;

  if new.captain_response is distinct from old.captain_response
     or new.responded_at is distinct from old.responded_at
     or new.decline_reason is distinct from old.decline_reason then
    if old.offered_at is null then
      raise exception 'That run has not been offered to you';
    end if;
    if old.captain_response = 'no_answer' then
      raise exception 'That offer timed out — call the office if you can still take it';
    end if;
    if new.captain_response = 'no_answer' then
      raise exception 'Captains answer yes or no';
    end if;
    if new.response_by is distinct from 'captain' then
      raise exception 'Captains answer as themselves';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
