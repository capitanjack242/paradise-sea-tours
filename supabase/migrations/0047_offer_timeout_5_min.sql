-- An unanswered offer closes after 5 minutes, not 15 (Jack, 13 Oct 2026).
-- offer_timeout() is the one place the length lives (0033); the minute job
-- picks it up on its next run.
create or replace function offer_timeout() returns interval as $$
  select interval '5 minutes';
$$ language sql immutable;
