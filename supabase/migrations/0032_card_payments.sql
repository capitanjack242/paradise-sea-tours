-- Card payments through Fygaro, recorded by the server that hears about them.
--
-- record_payment and record_tip (0021, 0023) are the office's buttons: they
-- check is_admin(), because a person pressing them must be the office. A
-- payment provider is not a person and has no login. When Fygaro tells our
-- hook a card went through, the hook — running server-side with the service
-- key — records it here instead, through a function nobody else can call.
--
-- One payment, one row, however many times Fygaro tells us. Providers resend
-- a notification when they aren't sure it arrived, so the same transaction can
-- land twice. The unique index is what makes the second one a no-op rather
-- than a second $33 against the trip.

create unique index if not exists payments_provider_reference_idx
  on payments (provider, reference)
  where reference is not null;

create or replace function record_provider_payment(
  p_booking      uuid,
  p_amount_cents int,
  p_kind         text,
  p_provider     text,
  p_reference    text
) returns text as $$
begin
  if p_kind not in ('fare', 'tip') then
    raise exception 'Unknown payment kind %', p_kind;
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A payment needs an amount';
  end if;
  if coalesce(p_provider, '') = '' or coalesce(p_reference, '') = '' then
    raise exception 'A provider payment needs the provider and its transaction id';
  end if;
  if not exists (select 1 from bookings where id = p_booking) then
    raise exception 'No such booking %', p_booking;
  end if;

  begin
    insert into payments (booking_id, amount_cents, status, kind, provider, reference, paid_at)
    values (p_booking, p_amount_cents, 'paid', p_kind, p_provider, p_reference, now());
  exception when unique_violation then
    return 'duplicate';
  end;

  if p_kind = 'fare' then
    -- paid_at is the first payment, not the last: the moment the trip became
    -- paid for, which is what opens the captain's channel.
    update bookings
       set paid_at = coalesce(paid_at, now()),
           amount_paid_cents = coalesce(amount_paid_cents, 0) + p_amount_cents
     where id = p_booking;
  else
    -- All of a tip goes to the boat: no commission, no VAT (0023).
    update bookings
       set tip_cents = tip_cents + p_amount_cents
     where id = p_booking;
  end if;

  return 'recorded';
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function record_provider_payment is
  'Records a card payment or tip reported by the payment provider. Service role only; a repeated notification for the same transaction is ignored.';

-- The server's key only. Not the public key, not a signed-in captain, not the
-- office's browser — the office has its own buttons.
revoke all on function record_provider_payment(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function record_provider_payment(uuid, int, text, text, text) to service_role;
