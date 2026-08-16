-- Payment, and what it unlocks.
--
-- Two things arrive together because they only make sense together:
--
--   1. A booking can now be paid. Nothing here talks to a payment provider —
--      that is next week's job. What exists is the state and one function that
--      sets it, so when Fygaro (or anything else) arrives it calls the same
--      function dispatch's button calls today, and nothing downstream changes.
--
--   2. A thread has two channels. The office is always reachable: someone
--      deciding whether to book has questions, and the answer to "can I bring a
--      cooler" cannot be "pay first". The captain is not reachable until the
--      trip is paid for, so a captain's attention is spent on people who have
--      actually committed.

-- ── 1. payment state ─────────────────────────────────────────────────────

alter table bookings
  add column if not exists paid_at           timestamptz,
  add column if not exists amount_paid_cents int;

comment on column bookings.paid_at is
  'When the trip was paid for. Null means unpaid — the captain stays unreachable.';

-- The payments table has been sitting here since the first migration with a
-- Stripe column and no rows. Generic fields instead, so the ledger can record
-- whatever we end up using without another migration.
alter table payments
  add column if not exists provider  text,
  add column if not exists reference text,
  add column if not exists paid_at   timestamptz;

comment on column payments.provider is
  'Who took the money — "fygaro", "cash", "bank". Null for anything recorded by hand.';

create index if not exists payments_booking_idx on payments (booking_id, created_at);

/* One door for recording money, whoever knocks.
   Today it's dispatch pressing a button. Next week it's a payment webhook
   calling the same function with a provider and a reference. Keeping it one
   function is what stops the two paths drifting into two truths. */
create or replace function record_payment(
  p_booking   uuid,
  p_amount_cents int,
  p_provider  text default null,
  p_reference text default null
) returns void as $$
begin
  -- Only the office. A captain has no business marking a trip paid, and the
  -- public key can't reach this at all (see the grants below).
  if not is_admin() then
    raise exception 'Only the office can record a payment';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A payment needs an amount';
  end if;

  insert into payments (booking_id, amount_cents, status, provider, reference, paid_at)
  values (p_booking, p_amount_cents, 'paid', p_provider, p_reference, now());

  -- paid_at is the first payment, not the last: it's the moment the trip became
  -- paid for, which is what the captain gate turns on.
  update bookings
     set paid_at = coalesce(paid_at, now()),
         amount_paid_cents = coalesce(amount_paid_cents, 0) + p_amount_cents
   where id = p_booking;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function record_payment is
  'Records money against a trip and marks it paid. The only way payment state is set.';

revoke all on function record_payment(uuid, int, text, text) from public;
grant execute on function record_payment(uuid, int, text, text) to authenticated;

-- ── 2. two channels ──────────────────────────────────────────────────────

alter table messages
  add column if not exists channel text not null default 'office';

alter table messages drop constraint if exists messages_channel_valid;
alter table messages add constraint messages_channel_valid
  check (channel in ('office', 'captain'));

comment on column messages.channel is
  'office: always open. captain: only once the trip is paid for.';

-- Existing messages were one shared thread, and there's no way to work out
-- retrospectively which were meant for whom. They land in office, the narrower
-- of the two: a captain losing sight of an old message is recoverable, a
-- passenger's conversation with the office widening to a captain is not.
create index if not exists messages_channel_idx on messages (booking_id, channel, created_at);

-- Staff read: dispatch still sees everything — they're coordinating both sides.
-- A captain sees only his own channel, on his own trips.
drop policy if exists messages_staff_read on messages;
create policy messages_staff_read on messages for select using (
  is_admin() or exists (
    select 1 from bookings b
    where b.id = messages.booking_id
      and b.assigned_captain_id = auth.uid()
      and messages.channel = 'captain'
  )
);

-- Staff write: dispatch may speak in either channel. A captain may only speak
-- in his own, on a live trip he's been given, and only once it's been paid for
-- — the gate cuts both ways, so an unpaid passenger and their captain simply
-- cannot reach each other.
drop policy if exists messages_staff_write on messages;
create policy messages_staff_write on messages for insert with check (
  (is_admin() and sender = 'dispatch')
  or (
    sender = 'captain' and channel = 'captain' and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and b.assigned_captain_id = auth.uid()
        and b.paid_at is not null
        and b.status not in ('completed', 'cancelled')
    )
  )
);

-- ── 3. the passenger's door, widened ─────────────────────────────────────

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
    'fare_cents',  b.quoted_price_cents,
    'boat',        bo.name,
    'captain',     bo.captain_name,
    -- What's owed and what's been paid, so the passenger sees the same figures
    -- the office does rather than a number quoted at them over the phone.
    'paid_at',     b.paid_at,
    'amount_paid_cents', b.amount_paid_cents,
    'balance_cents', greatest(coalesce(b.quoted_price_cents, 0)
                              - coalesce(b.amount_paid_cents, 0), 0),
    -- The office is reachable while the trip is live, paid or not.
    'can_reply',   b.status not in ('completed', 'cancelled'),
    -- The captain is reachable once there's a captain and the trip is paid for.
    'can_message_captain',
      b.paid_at is not null
      and b.assigned_captain_id is not null
      and b.status not in ('completed', 'cancelled'),
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

-- The two-argument version is replaced rather than kept alongside: leaving both
-- in place, one with a defaulted third argument, makes every existing call
-- ambiguous.
drop function if exists trip_send(uuid, text);

create or replace function trip_send(p_token uuid, p_body text, p_channel text default 'office')
returns void as $$
declare
  target   uuid;
  is_paid  boolean;
  assigned uuid;
begin
  if coalesce(p_channel, '') not in ('office', 'captain') then
    raise exception 'Unknown channel';
  end if;

  select id, paid_at is not null, assigned_captain_id
    into target, is_paid, assigned
  from bookings
  where access_token = p_token
    and status not in ('completed', 'cancelled');

  if target is null then
    raise exception 'That trip is closed.';
  end if;

  -- Said plainly, because this message is shown to a passenger.
  if p_channel = 'captain' then
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
