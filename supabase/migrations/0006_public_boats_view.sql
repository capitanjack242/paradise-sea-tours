-- Captains' WhatsApp numbers were readable by anyone holding the publishable
-- key (the boats read policy exposed every column to anon). Fix: the public
-- site reads a view with no phone column; the boats table itself becomes
-- staff-only.

-- security_invoker = off so the view can read boats even though the caller
-- (anon) no longer can. Only the columns listed here are ever exposed.
create or replace view public_boats
  with (security_invoker = off) as
  select id, name, kind, capacity, description, photo_url, home_dock, captain_name
  from boats
  where is_active;

grant select on public_boats to anon, authenticated;

-- boats table: drop the public read, restrict to owner/admin only.
drop policy if exists boats_public_read on boats;
create policy boats_staff_read on boats for select
  using (owner_id = auth.uid() or is_admin());
