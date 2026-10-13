-- Paradise keeps 25% of every fare (Jack, 13 Oct 2026).
--
-- Applies to every boat, and is the default for boats added later. A completed
-- trip keeps the rate it was closed out at (0020), so nothing already finished
-- changes. A captain on different terms is a row edit:
--   update boats set commission_pct = <n> where name = '…';
update boats set commission_pct = 25;
alter table boats alter column commission_pct set default 25;
