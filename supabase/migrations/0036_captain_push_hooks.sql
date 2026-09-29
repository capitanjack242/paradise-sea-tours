-- Switch on the captain's push notifications.
--
-- notify-captain (the Edge Function) was written, deployed and never called:
-- the Database Webhooks meant to call it were never created. Only the office's
-- Telegram hook (notify_booking, on new bookings) exists in production. So a
-- captain's phone would never ring for a run or buzz for a message, whatever
-- the app did.
--
-- These triggers call it. They send the function's shared secret in a header,
-- the same secret notify_booking already sends. That secret must not be in this
-- file — the repository is public — so it lives in Supabase Vault, and the
-- first time this runs it is copied into Vault from notify_booking's own
-- settings, where the dashboard stored it. It never passes through a file.
--
-- To rotate it later: change WEBHOOK_SECRET in the function secrets, the header
-- on notify_booking in the dashboard, and
--   select vault.update_secret(id, '<new>') from vault.secrets where name = 'webhook_secret';

-- ── the secret, from where it already is ─────────────────────────────────
do $$
declare
  args   text[];
  secret text;
begin
  if exists (select 1 from vault.secrets where name = 'webhook_secret') then
    return;
  end if;

  -- supabase_functions.http_request(url, method, headers, params, timeout):
  -- the headers are the third argument, stored as JSON text.
  select string_to_array(encode(tgargs, 'escape'), '\000') into args
    from pg_trigger
   where tgname = 'notify_booking' and tgrelid = 'public.bookings'::regclass;

  if args is null or array_length(args, 1) < 3 then
    raise notice 'notify_booking not found — set the secret by hand: select vault.create_secret(''<secret>'', ''webhook_secret'');';
    return;
  end if;

  secret := (args[3]::jsonb) ->> 'x-webhook-secret';
  if secret is null then
    raise notice 'notify_booking has no x-webhook-secret header — set webhook_secret in Vault by hand.';
    return;
  end if;

  perform vault.create_secret(secret, 'webhook_secret', 'Shared secret for the Edge Function webhooks');
end $$;

-- ── one caller for both triggers ─────────────────────────────────────────
/* Sends the change to notify-captain in the shape Database Webhooks use
   ({ type, table, schema, record, old_record }), so the function reads it the
   same way whichever way it was called. pg_net is fire-and-forget: a slow or
   failed push never holds up the booking or the message that caused it. */
create or replace function call_notify_captain() returns trigger as $$
declare
  secret text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'webhook_secret';
  if secret is null then
    return null; -- not configured: stay quiet rather than fail the write
  end if;

  perform net.http_post(
    url     := 'https://fjdoaonnoezbbitbawzs.supabase.co/functions/v1/notify-captain',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret),
    body    := jsonb_build_object(
      'type',       tg_op,
      'table',      tg_table_name,
      'schema',     tg_table_schema,
      'record',     to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end
    ),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$ language plpgsql security definer set search_path = public, extensions;

comment on function call_notify_captain is
  'Tells notify-captain about a new message or a run changing hands. The shared secret comes from Vault.';

-- A message on a trip: the function decides whether it's the captain's to hear.
drop trigger if exists notify_captain_on_message on messages;
create trigger notify_captain_on_message
  after insert on messages
  for each row execute function call_notify_captain();

-- A run: only when it's confirmed or changes hands. Every other edit to a
-- booking (a note, a price) is filtered out here, before any request is made.
drop trigger if exists notify_captain_on_run on bookings;
create trigger notify_captain_on_run
  after update on bookings
  for each row
  when (new.status is distinct from old.status
        or new.assigned_captain_id is distinct from old.assigned_captain_id)
  execute function call_notify_captain();
