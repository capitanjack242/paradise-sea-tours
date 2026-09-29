-- One list of docks.
--
-- The website and the passenger app each carried their own copy, and they had
-- already drifted: the website offered "Carnival Restaurant, Paradise Island
-- Marina" and the app didn't, so the same passenger could book a pickup there
-- on one and not the other. A dock added in the app meant a store release.
--
-- Now the list lives here. Both read it; both keep a built-in copy only as a
-- fallback for when the read fails. Adding a dock is a row, not a release:
--   insert into docks (name, sort) values ('Nassau Yacht Haven', 175);
-- Retiring one: update docks set is_active = false where name = '…';
--
-- "Other (see notes)" is not a dock and is not in this table — the pages add it
-- at the end of the list themselves.

create table if not exists docks (
  name       text primary key check (length(btrim(name)) between 1 and 100),
  sort       int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table docks is
  'Pickup and drop-off points offered on the website and in the passenger app. Edit here, not in code.';

alter table docks enable row level security;

drop policy if exists docks_public_read on docks;
create policy docks_public_read on docks for select using (is_active or is_admin());

drop policy if exists docks_admin_write on docks;
create policy docks_admin_write on docks for all using (is_admin()) with check (is_admin());

revoke all on docks from anon, authenticated;
grant select on docks to anon, authenticated;
grant insert, update, delete on docks to authenticated;

-- The website's list as it stands, which is the longer of the two.
insert into docks (name, sort) values
  ('Nassau Cruise Port',                          10),
  ('Downtown Nassau / Prince George Wharf',       20),
  ('Paradise Island & Atlantis',                  30),
  ('Atlantis Marina',                             40),
  ('Carnival Restaurant, Paradise Island Marina', 50),
  ('Cabbage Beach',                               60),
  ('Rose Island & Cays',                          70),
  ('The Sandbar',                                 80),
  ('Breezes Beach',                               90),
  ('Baha Mar Dock',                              100),
  ('Fish Fry Dock',                              110),
  ('Long Wharf Beach',                           120),
  ('Love Beach',                                 130),
  ('Sandyport',                                  140),
  ('Green Parrot Dock',                          150),
  ('Potter''s Cay Dock',                         160),
  ('Montagu Dock',                               170),
  ('Poop Deck (East Bay Street)',                180)
on conflict (name) do nothing;
