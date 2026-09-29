# Backend (Supabase)

Postgres data model + row-level security for Paradise Sea Express. Shared by the
customer app (`app/`) and the dispatch/control view (`control/`).

## Schema (`migrations/0001_init.sql`)
- **profiles** — one per auth user; `role` = customer | captain | admin.
- **boats** — vessels, owned by a captain profile.
- **services** — every bookable offering: routes (per-person), charters
  (per-hour), fishing tours (per-boat). Drives pricing.
- **bookings** — the core record; lifecycle:
  `requested → quoted → confirmed → assigned → in_progress → completed / cancelled`.
  Guest bookings allowed (nullable `customer_id`) so the public site can submit.
- **payments** — the ledger of money recorded against a booking.
- **app_settings** — one row of company-wide numbers. Today that is `vat_pct`.

Positions: two, in different places. `bookings.pickup_lat/lng` is where the
passenger says they're standing, shared once when they book and dropped when
the trip closes. `boats.last_lat/lng` is where the boat is, reported through
`report_boat_position` while the boat is **available** — availability is the
captain's own switch, and turning it off wipes the position with it, so nobody
is followed off the clock. Dispatch sees every boat that is on; `trip_thread`
gives a passenger only their own boat, only on a live trip, and only a fix under
five minutes old.

Booking: the app and (later) the website ask for a boat through `request_boat`,
which creates the booking and **returns its access token** — the key to that one
trip. The direct public insert policy still exists for the website, but it can't
read the token back, which is why the app couldn't find its own trip before.

Tips: `tip_cents` is what the passenger added for the captain, recorded through
`record_tip`. It is never commissioned, never taxed, and never part of
`total_cents` or the balance — all of it goes to the boat. It has its own payout
stamp (`tip_paid_out_at`) because a tip can land after the fare was settled.

Money: `quoted_price_cents` is the fare **before tax**. VAT is added on top at
the rate stamped on the booking (`vat_pct`), giving `vat_cents` and
`total_cents` — the total is what a passenger owes. Commission is taken on the
fare and never on the total, because VAT is the government's money passing
through the account. Change the rate with
`update app_settings set vat_pct = <n>;` — trips already taken keep the rate
they were taken at.

Security: RLS on every table, and two rules about columns on top of it.

- **What a captain may change** is a list of what IS allowed (answering an offer,
  marking a confirmed trip aboard, then finished), not a list of what isn't. A
  column added later is locked to captains until someone decides otherwise.
- **What a captain may read**: the table withholds `access_token`,
  `contact_phone` and `dispatch_notes` from every signed-in user, because the
  office and the captains share the `authenticated` role. The office reads the
  full row through `staff_bookings()`, which checks `is_admin()` itself. A
  column added to `bookings` later is NOT readable through the API until it is
  granted: `grant select (new_column) on bookings to authenticated;`
- **What a stranger's booking may carry**: `public_booking_intake()` resets
  everything on a public booking except the fields a passenger chooses, caps
  lengths, and refuses more than three requests from one number in ten minutes.

## Applying changes
Migrations are applied with the CLI, which is linked to the project:
```bash
TMPDIR=$HOME/.cache/supabase-tmp/ supabase db push --linked --dry-run   # see what would run
TMPDIR=$HOME/.cache/supabase-tmp/ supabase db push --linked
```
The `TMPDIR` is needed on this Mac because Colima's Docker VM only shares /Users.

To test a migration first, `supabase db dump --linked -f schema.sql` gives the
live schema (no data); load it into a local `public.ecr.aws/supabase/postgres`
container and run the migration against that.

## Card payments (Fygaro)
Built and deployed, switched off until the account exists. Until then the Pay
and Tip buttons fall back to a message to the office.

- `functions/pay-link` — makes a signed Fygaro link for what a trip owes, or a tip.
  The amount comes from the database, never from the caller.
- `functions/fygaro-hook` — Fygaro calls it when a card payment succeeds. It checks
  the signature, then `record_provider_payment()` (0032) records it once — a
  resent notification is ignored.

**To switch on** (needs a Fygaro **Pro** plan — signed links are Pro-only):
1. Fygaro → Settings → API Credentials → Generate New. Keep the secret; it can't be shown again.
2. On the payment button: turn on JWT (Advanced Settings), set the Hook to
   `https://fjdoaonnoezbbitbawzs.supabase.co/functions/v1/fygaro-hook`, and the
   return URL to `https://paradiseseaexpress.com/trip/`.
3. `supabase secrets set FYGARO_BUTTON_URL=… FYGARO_KEY_ID=… FYGARO_SECRET=…`
4. Pay a real $1 test, check it lands on the trip, refund it in Fygaro.

Refunds are done in Fygaro's dashboard; there is no refund API.
