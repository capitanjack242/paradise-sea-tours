-- Add plain-text captain/dispatch fields to boats. These are intentionally
-- separate from `owner_id` (which links to a real auth profile) — Phase 1
-- captains don't need login accounts yet, just to be listed for dispatch.
alter table boats
  add column if not exists captain_name text,
  add column if not exists captain_whatsapp text,
  add column if not exists description text,
  add column if not exists home_dock text;
