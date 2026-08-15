-- Where a captain's phone is reachable.
--
-- One row per device, not per person: a captain with a phone and a spare gets
-- told on both, and a phone that's been signed out of stops being told.

create table if not exists push_tokens (
  user_id    uuid not null references auth.users on delete cascade,
  token      text not null,
  platform   text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table push_tokens enable row level security;

-- A device registers itself and nothing else. Nobody reads anyone's tokens
-- through this key at all — the sender runs server-side.
revoke all on push_tokens from anon;
grant select, insert, update, delete on push_tokens to authenticated;

drop policy if exists push_tokens_own on push_tokens;
create policy push_tokens_own on push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists push_tokens_user_idx on push_tokens (user_id);
