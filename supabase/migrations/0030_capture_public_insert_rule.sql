-- Put the public-booking rule into the recipe.
--
-- The August security audit found that anyone with the publishable key could
-- insert a booking already priced, already assigned, already confirmed. It was
-- closed by tightening bookings_public_insert — in the dashboard. The migration
-- files still said `with check (true)`, so any database rebuilt from them (a
-- staging copy, a self-hosted move, disaster recovery) would have come up with
-- the hole open again, and nothing would have said so.
--
-- This is the rule exactly as production has enforced it since August: a
-- stranger may ask for a boat, and nothing else. Status is 'requested', no
-- fare, no boat, no captain, no cancellation reason, no customer id — every
-- one of those is dispatch's to set. Staff are exempt because dispatch creates
-- bookings by hand, phone in the other hand.
--
-- Recreating a policy that already matches is a no-op on production. The point
-- is the file.

drop policy if exists bookings_public_insert on bookings;
create policy bookings_public_insert on bookings for insert with check (
  is_admin() or (
        status = 'requested'
    and quoted_price_cents  is null
    and assigned_boat_id    is null
    and assigned_captain_id is null
    and cancellation_reason is null
    and customer_id         is null
  )
);
