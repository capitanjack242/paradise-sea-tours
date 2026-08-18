-- Tips, on the Uber model: the boat keeps all of it.
--
-- Three rules, and the reasons:
--
--   1. No commission on a tip. A passenger tipping $20 means the captain gets
--      $20. Taking a cut of it would be indefensible to a captain who can see
--      what the passenger gave, and Uber doesn't take one either.
--
--   2. No VAT on a tip. A tip freely given, passed to the person who earned it,
--      is not payment for a service — it falls outside the tax. So the fare and
--      the tax on it are one number, and the tip sits beside them.
--
--   3. A tip can be added after the trip is closed out. That is the one thing
--      about a settled trip that is still allowed to move, because tipping
--      after the fact is the normal case, not the exception.

alter table bookings
  add column if not exists tip_cents       int not null default 0,
  add column if not exists tip_paid_out_at timestamptz;

alter table bookings drop constraint if exists bookings_tip_sane;
alter table bookings add constraint bookings_tip_sane check (tip_cents >= 0);

comment on column bookings.tip_cents is
  'What the passenger gave the captain on top. Not commissioned, not taxed.';
comment on column bookings.tip_paid_out_at is
  'When the tip was handed to the boat. Separate from paid_out_at: a tip can land after the fare was settled.';

-- The ledger already records money in. A tip is money in of a different kind,
-- and telling them apart is what stops a tip being counted as fare paid.
alter table payments
  add column if not exists kind text not null default 'fare';

alter table payments drop constraint if exists payments_kind_valid;
alter table payments add constraint payments_kind_valid check (kind in ('fare', 'tip'));

comment on column payments.kind is
  'fare: pays down what is owed. tip: extra, and all of it goes to the boat.';

/* One door for tips, the same shape as record_payment.
   Deliberately not part of record_payment: that function pays down a balance,
   and a tip is not owed. Running a tip through it would make a trip look
   overpaid and the balance go negative. */
create or replace function record_tip(
  p_booking      uuid,
  p_amount_cents int,
  p_provider     text default null,
  p_reference    text default null
) returns void as $$
begin
  if not is_admin() then
    raise exception 'Only the office can record a tip';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A tip needs an amount';
  end if;

  insert into payments (booking_id, amount_cents, status, kind, provider, reference, paid_at)
  values (p_booking, p_amount_cents, 'paid', 'tip', p_provider, p_reference, now());

  update bookings
     set tip_cents = tip_cents + p_amount_cents
   where id = p_booking;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function record_tip is
  'Adds a tip to a trip. All of it goes to the boat — no commission, no VAT.';

revoke all on function record_tip(uuid, int, text, text) from public;
grant execute on function record_tip(uuid, int, text, text) to authenticated;

-- A closed-out trip's fare, tax, commission and boat stay frozen. Its tip does
-- not: 0010's guard names the columns it protects, and tip_cents is not one of
-- them, which is what lets a tip land the day after the trip.

-- ── what the passenger sees ──────────────────────────────────────────────
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
    'vat_pct',     b.vat_pct,
    'vat_cents',   b.vat_cents,
    'total_cents', b.total_cents,
    -- Shown, but never added to the balance: a tip is given, not owed.
    'tip_cents',   b.tip_cents,
    'boat',        bo.name,
    'captain',     bo.captain_name,
    'paid_at',     b.paid_at,
    'amount_paid_cents', b.amount_paid_cents,
    'balance_cents', greatest(coalesce(b.total_cents, 0)
                              - coalesce(b.amount_paid_cents, 0), 0),
    'can_reply',   b.status not in ('completed', 'cancelled'),
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
