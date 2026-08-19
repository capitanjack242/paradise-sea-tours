-- Shut the fleet ratings to the anonymous role properly.
--
-- 0027 said `revoke all on function boat_ratings() from public`, which is what
-- the test harness reproduced and passed against. On the real database it is not
-- enough: Supabase's default privileges grant EXECUTE to `anon` DIRECTLY, not
-- through PUBLIC, so revoking from PUBLIC leaves that grant standing. Called
-- with the publishable key the function returned an empty list rather than
-- refusing — no rating leaked, because the function scopes itself by is_admin()
-- and boats.owner_id, but the outer door was open when it was meant to be shut.
--
-- Belt and braces is the point: the scoping inside is what protects the data,
-- and this is the door. A future edit that loosens the scoping should not also
-- be the moment anonymous callers gain reach.

revoke execute on function boat_ratings() from anon;

comment on function boat_ratings is
  'Per-boat rating averages with the number of trips behind them. Staff only — and revoked from anon explicitly, since Supabase grants execute to it by default.';
