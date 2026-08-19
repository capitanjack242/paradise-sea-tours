-- Tips belong after the ride, not after the payment.
--
-- 0023 opened the tip card the moment the fare was paid. In a confirm-then-pay
-- flow that is before anyone has set foot on the boat, and nobody tips a captain
-- they haven't met. Worse, the card closed again the moment the trip completed,
-- because tipping rides on the message thread and the thread shuts at
-- completion. So the only window to tip was the one window nobody tips in, and
-- the moment a passenger actually wants to — stepping off onto the dock — it was
-- already gone.
--
-- This flips it. Tipping opens when the trip is COMPLETED and stays open for a
-- week. The office thread stays open that week too, because until Fygaro is
-- connected a tip IS a message to the office. The captain's own channel still
-- closes at completion: he is off the clock, and the office can still reach him.

-- ── when the ride actually ended ─────────────────────────────────────────
alter table bookings add column if not exists completed_at timestamptz;

comment on column bookings.completed_at is
  'When the captain closed the trip out. Null until then, and null again if it is reopened.';

-- Trips already closed out get their last-touched time. It is not the exact
-- moment — nobody was recording one — but it is the only evidence there is, and
-- all it decides is whether a months-old trip can still be tipped. It cannot.
update bookings set completed_at = updated_at
 where status = 'completed' and completed_at is null;

create or replace function stamp_completed_at() returns trigger as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status is distinct from 'completed' then
    -- Reopened, so it has not ended after all.
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

comment on function stamp_completed_at is
  'Records the end of a trip, which is what the tip window is measured from.';

-- Fires after bookings_captain_guard and bookings_settled_guard (both earlier in
-- the alphabet), so neither ever sees this column move.
drop trigger if exists bookings_stamp_completed_at on bookings;
create trigger bookings_stamp_completed_at
  before update on bookings
  for each row execute function stamp_completed_at();

-- ── what the passenger sees ──────────────────────────────────────────────
-- Supersedes 0025's version: same boat position, plus can_tip and a can_reply
-- that survives the end of the trip for as long as a tip is still possible.
create or replace function trip_thread(p_token uuid)
returns jsonb as $$
  select case when b.id is null then null else jsonb_build_object(
    'pickup',      b.pickup,
    'destination', b.destination,
    'scheduled_at', b.scheduled_at,
    'return_at',   b.return_at,
    'passengers',  b.passengers,
    'trip_type',   b.trip_type,
    'status',      b.status,
    'completed_at', b.completed_at,
    'fare_cents',  b.quoted_price_cents,
    'vat_pct',     b.vat_pct,
    'vat_cents',   b.vat_cents,
    'total_cents', b.total_cents,
    'tip_cents',   b.tip_cents,
    'boat',        bo.name,
    'captain',     bo.captain_name,
    'paid_at',     b.paid_at,
    'amount_paid_cents', b.amount_paid_cents,
    'balance_cents', greatest(coalesce(b.total_cents, 0)
                              - coalesce(b.amount_paid_cents, 0), 0),
    -- A tip is offered after the ride, to someone who ran it, for a week.
    -- Coalesced because a completed trip with no completion time — anything the
    -- backfill below missed — would otherwise answer null, and null is not an
    -- answer to give a client about what it may do.
    'can_tip', coalesce(
      b.status = 'completed'
      and b.assigned_boat_id is not null
      and b.completed_at > now() - interval '7 days', false),
    'can_reply', coalesce(
      b.status <> 'cancelled'
      and (b.status <> 'completed'
           or b.completed_at > now() - interval '7 days'), false),
    'can_message_captain',
      b.paid_at is not null
      and b.assigned_captain_id is not null
      and b.status not in ('completed', 'cancelled'),
    'boat_lat', case when b.status in ('confirmed', 'in_progress')
                      and bo.last_located_at > now() - interval '5 minutes'
                     then bo.last_lat end,
    'boat_lng', case when b.status in ('confirmed', 'in_progress')
                      and bo.last_located_at > now() - interval '5 minutes'
                     then bo.last_lng end,
    'boat_located_at', case when b.status in ('confirmed', 'in_progress')
                             and bo.last_located_at > now() - interval '5 minutes'
                            then bo.last_located_at end,
    'messages',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'sender', m.sender, 'body', m.body,
               'channel', m.channel, 'at', m.created_at
             ) order by m.created_at)
      from messages m where m.booking_id = b.id
    ), '[]'::jsonb)
  ) end
  from bookings b
  left join boats bo on bo.id = b.assigned_boat_id
  where b.access_token = p_token;
$$ language sql stable security definer set search_path = public;

-- ── and what they may send ───────────────────────────────────────────────
-- Supersedes 0021's version. The office stays reachable for the week after a
-- trip, so a tip and anything else outstanding still has somewhere to go.
create or replace function trip_send(p_token uuid, p_body text, p_channel text default 'office')
returns void as $$
declare
  target    uuid;
  is_paid   boolean;
  assigned  uuid;
  is_closed boolean;
begin
  if coalesce(p_channel, '') not in ('office', 'captain') then
    raise exception 'Unknown channel';
  end if;

  select id, paid_at is not null, assigned_captain_id, status = 'completed'
    into target, is_paid, assigned, is_closed
  from bookings
  where access_token = p_token
    and status <> 'cancelled'
    and (status <> 'completed' or completed_at > now() - interval '7 days');

  if target is null then
    raise exception 'That trip is closed.';
  end if;

  -- Said plainly, because this message is shown to a passenger.
  if p_channel = 'captain' then
    if is_closed then
      raise exception 'Your captain is off this trip now — the office can help.';
    end if;
    if assigned is null then
      raise exception 'No captain on this trip yet — the office can help.';
    end if;
    if not is_paid then
      raise exception 'Your captain opens up once the trip is paid for. The office can help meanwhile.';
    end if;
  end if;

  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Nothing to send.';
  end if;

  insert into messages (booking_id, sender, body, channel)
  values (target, 'customer', btrim(p_body), p_channel);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function trip_send(uuid, text, text) from public;
grant execute on function trip_send(uuid, text, text) to anon, authenticated;
