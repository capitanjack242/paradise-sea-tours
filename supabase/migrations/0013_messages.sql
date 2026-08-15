-- In-app messaging between a passenger, their captain, and dispatch.
--
-- The awkward part is the passenger. Captains and dispatch have logins, so
-- row-level security can identify them. A passenger is a guest — no account,
-- no session, nothing but a phone number we never show anyone. So each booking
-- carries an unguessable token, and the passenger reaches their own thread
-- through two security-definer functions keyed on it. The messages table itself
-- stays shut to the public key entirely; the token is the only way in, and it
-- only ever opens one trip.

-- ── the passenger's key to their own trip ────────────────────────────────
alter table bookings add column if not exists access_token uuid;
update bookings set access_token = gen_random_uuid() where access_token is null;
alter table bookings alter column access_token set default gen_random_uuid();
alter table bookings alter column access_token set not null;
create unique index if not exists bookings_access_token_idx on bookings (access_token);

-- ── messages ─────────────────────────────────────────────────────────────
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings on delete cascade,
  sender     text not null check (sender in ('customer', 'captain', 'dispatch')),
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_booking_idx on messages (booking_id, created_at);

alter table messages enable row level security;

-- Said out loud rather than inherited from whatever the project's default
-- privileges happen to be. The public key gets nothing at all here: a passenger
-- reaches their thread through the token functions below, never the table.
revoke all on messages from anon;
grant select, insert on messages to authenticated;

-- Staff read: dispatch sees everything, a captain sees only the trips they were
-- given. Nothing here is readable with the public key.
drop policy if exists messages_staff_read on messages;
create policy messages_staff_read on messages for select using (
  is_admin() or exists (
    select 1 from bookings b
    where b.id = messages.booking_id and b.assigned_captain_id = auth.uid()
  )
);

-- Staff write: you may only speak as yourself, and a captain only on their own
-- trip. Once a trip is finished a captain has no further business messaging
-- that passenger — dispatch still can, because the business might need to.
drop policy if exists messages_staff_write on messages;
create policy messages_staff_write on messages for insert with check (
  (is_admin() and sender = 'dispatch')
  or (
    sender = 'captain' and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and b.assigned_captain_id = auth.uid()
        and b.status not in ('completed', 'cancelled')
    )
  )
);

-- ── the passenger's door ─────────────────────────────────────────────────
-- Definer functions, so the table can stay closed. Each takes the token and
-- resolves exactly one booking; a wrong token returns nothing rather than
-- explaining itself.

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
    'can_reply',   b.status not in ('completed', 'cancelled'),
    'messages',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'sender', m.sender, 'body', m.body, 'at', m.created_at
             ) order by m.created_at)
      from messages m where m.booking_id = b.id
    ), '[]'::jsonb)
  ) end
  from bookings b
  left join boats bo on bo.id = b.assigned_boat_id
  where b.access_token = p_token;
$$ language sql stable security definer set search_path = public;

create or replace function trip_send(p_token uuid, p_body text)
returns void as $$
declare
  target uuid;
begin
  select id into target
  from bookings
  where access_token = p_token
    and status not in ('completed', 'cancelled');

  if target is null then
    raise exception 'That trip is closed.';
  end if;

  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Nothing to send.';
  end if;

  insert into messages (booking_id, sender, body)
  values (target, 'customer', btrim(p_body));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function trip_thread(uuid) from public;
revoke all on function trip_send(uuid, text) from public;
grant execute on function trip_thread(uuid) to anon, authenticated;
grant execute on function trip_send(uuid, text) to anon, authenticated;

-- Staff boards update live, the same way bookings already do.
alter publication supabase_realtime add table messages;
