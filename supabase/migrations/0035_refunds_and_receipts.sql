-- Refunds, and a receipt for every paid trip.
--
-- Refunds: Fygaro has no refund API, so money goes back through its own
-- dashboard. What was missing was our side of it — the trip still read "Paid
-- $33" after the $33 had gone back. record_refund writes it down: a ledger row
-- and a running refunded figure on the trip, so the office, the passenger and
-- the books all agree.
--
-- Receipts: a VAT-registered business has to give a receipt showing who it is,
-- its VAT number, a receipt number, the date, and the tax. The company details
-- live in app_settings (one row, public — they're printed on every receipt
-- anyway) and are filled in once, when the company and VAT number exist:
--   update app_settings set business_name = '…', business_address = '…', vat_tin = '…';
-- Each trip gets its own receipt number the moment it's first paid, from one
-- sequence, so numbers never repeat and never skip backwards.

-- ── who is issuing the receipt ───────────────────────────────────────────
alter table app_settings
  add column if not exists business_name    text not null default 'Paradise Sea Express',
  add column if not exists business_address text,
  add column if not exists vat_tin          text;

comment on column app_settings.vat_tin is
  'VAT registration number (TIN), printed on receipts. Null until registered — receipts then say so.';

-- ── refunds ──────────────────────────────────────────────────────────────
alter table bookings
  add column if not exists refunded_cents int not null default 0,
  add column if not exists receipt_no     bigint;

alter table bookings drop constraint if exists bookings_refund_sane;
alter table bookings add constraint bookings_refund_sane
  check (refunded_cents >= 0 and refunded_cents <= coalesce(amount_paid_cents, 0));

create unique index if not exists bookings_receipt_no_idx on bookings (receipt_no) where receipt_no is not null;

comment on column bookings.refunded_cents is
  'Money given back, recorded after it was refunded in Fygaro. Part of amount_paid_cents, not on top of it.';
comment on column bookings.receipt_no is
  'This trip''s receipt number, given when it is first paid. Sequential across all trips.';

-- 0031: a new column is unreadable through the API until granted. Both are
-- fine for a captain to see; neither is the office's private business.
grant select (refunded_cents, receipt_no) on bookings to authenticated;

create or replace function record_refund(
  p_booking      uuid,
  p_amount_cents int,
  p_reference    text default null
) returns void as $$
declare
  paid     int;
  refunded int;
begin
  if not is_admin() then
    raise exception 'Only the office can record a refund';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A refund needs an amount';
  end if;

  select coalesce(amount_paid_cents, 0), refunded_cents into paid, refunded
    from bookings where id = p_booking for update;
  if paid is null then
    raise exception 'No such trip';
  end if;
  if refunded + p_amount_cents > paid then
    raise exception 'That''s more than was paid — $% paid, $% already refunded',
      to_char(paid / 100.0, 'FM999990.00'), to_char(refunded / 100.0, 'FM999990.00');
  end if;

  insert into payments (booking_id, amount_cents, status, kind, provider, reference, paid_at)
  values (p_booking, p_amount_cents, 'refunded', 'fare', 'refund', p_reference, now());

  update bookings set refunded_cents = refunded_cents + p_amount_cents where id = p_booking;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function record_refund is
  'Records money given back on a trip (the refund itself is done in Fygaro). Office only.';

revoke all on function record_refund(uuid, int, text) from public, anon;
grant execute on function record_refund(uuid, int, text) to authenticated;

-- ── the public-booking cleaner (0031), made safe for new columns ─────────
/* 0031 rebuilt a public booking from the passenger's own fields and put the
   defaults back by hand. refunded_cents above is "not null default 0", and it
   wasn't on that hand-written list, so every public booking would have failed
   the moment this migration ran. Now each column's default is read from the
   table itself. */
create or replace function public_booking_intake() returns trigger as $$
declare
  col text;
  def text;
  val jsonb;
begin
  -- The caller's role, straight from the request's token. Read directly rather
  -- than through auth.role(), whose definition has changed between platform
  -- versions; a caller with no token at all (SQL editor, service jobs) has none.
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       '') not in ('anon', 'authenticated')
     or is_admin() then
    return new;
  end if;

  -- Everything that is the office's, the captain's or the payment provider's
  -- to set. Listed as what a passenger MAY send (below), everything else reset.
  new := jsonb_populate_record(null::bookings, jsonb_build_object(
    'contact_name',  new.contact_name,
    'contact_phone', new.contact_phone,
    'pickup',        new.pickup,
    'destination',   new.destination,
    'scheduled_at',  new.scheduled_at,
    'return_at',     new.return_at,
    'passengers',    new.passengers,
    'trip_type',     new.trip_type,
    'notes',         new.notes,
    'pickup_lat',    new.pickup_lat,
    'pickup_lng',    new.pickup_lng,
    'located_at',    new.located_at
  ));
  -- jsonb_populate_record leaves every other column null rather than applying
  -- its default. Put each column's own default back, read from the table, so a
  -- column added later (with "not null default …") can't make every public
  -- booking fail. Fresh id, fresh token, status 'requested', zero money.
  for col, def in
    select a.attname, pg_get_expr(d.adbin, d.adrelid)
      from pg_attribute a
      join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.bookings'::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
  loop
    if to_jsonb(new) ->> col is null then
      execute format('select to_jsonb(%s)', def) into val;
      new := jsonb_populate_record(new, jsonb_build_object(col, val));
    end if;
  end loop;

  -- Said plainly, because a passenger reads these.
  if length(coalesce(new.contact_name, '')) > 100 then
    raise exception 'That name is too long.';
  end if;
  if length(coalesce(new.contact_phone, '')) > 30 then
    raise exception 'That phone number is too long.';
  end if;
  if length(coalesce(new.pickup, '')) > 200 or length(coalesce(new.destination, '')) > 200 then
    raise exception 'Choose your pickup and destination from the list.';
  end if;
  if length(coalesce(new.notes, '')) > 1000 then
    raise exception 'Your note is too long — keep it under 1,000 characters.';
  end if;
  if new.trip_type is not null
     and new.trip_type not in ('One way', 'Round trip', 'Private charter (whole boat)') then
    raise exception 'Choose one way, round trip or charter.';
  end if;
  if new.passengers < 1 or new.passengers > 50 then
    raise exception 'How many people are coming?';
  end if;

  -- A person asks for a boat or two. Something asking for twenty a minute is a
  -- script, and every one of those rings the office's phone on Telegram.
  if new.contact_phone is not null and (
       select count(*) from bookings
        where contact_phone = new.contact_phone
          and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'You''ve just asked for a few boats — we''ll be in touch shortly. Call us if it''s urgent.';
  end if;
  if (select count(*) from bookings where created_at > now() - interval '10 minutes') >= 50 then
    raise exception 'We''re very busy right now — please call us to book.';
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ── receipt numbers ──────────────────────────────────────────────────────
create sequence if not exists receipt_no_seq start 1001;

create or replace function stamp_receipt_no() returns trigger as $$
begin
  if new.paid_at is not null and new.receipt_no is null then
    new.receipt_no := nextval('receipt_no_seq');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_stamp_receipt on bookings;
create trigger bookings_stamp_receipt
  before insert or update on bookings
  for each row execute function stamp_receipt_no();

-- Trips already paid get numbers too, in the order they were paid.
update bookings set receipt_no = nextval('receipt_no_seq')
 where id in (select id from bookings where paid_at is not null and receipt_no is null order by paid_at);

-- ── what the passenger sees ──────────────────────────────────────────────
-- 0027's version, plus the refund and the receipt number.
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
    'refunded_cents', b.refunded_cents,
    'receipt_no',  b.receipt_no,
    -- A refund is money given back on purpose, not a debt reopened: what is
    -- owed stays the total less what was paid.
    'balance_cents', greatest(coalesce(b.total_cents, 0)
                              - coalesce(b.amount_paid_cents, 0), 0),
    'rating_captain', b.rating_captain,
    'rating_ride',    b.rating_ride,
    'rating_note',    b.rating_note,
    'rated_at',       b.rated_at,
    'can_rate', coalesce(
      b.status = 'completed'
      and b.assigned_boat_id is not null
      and b.completed_at > now() - interval '7 days', false),
    'can_tip', coalesce(
      b.status = 'completed'
      and b.assigned_boat_id is not null
      and b.completed_at > now() - interval '7 days'
      and b.rated_at is not null, false),
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
