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

Security: RLS on every table. Public can read active services and create a
booking request; customers see their own bookings; captains see assigned ones;
admins see everything (`is_admin()`).

## Setup (one-time)
1. Create a free project at <https://supabase.com/dashboard>.
2. In the SQL Editor, run `migrations/0001_init.sql` then `seed.sql`
   (or use the Supabase CLI — `supabase db push`).
3. Grab from Project Settings → API:
   - **Project URL** and **anon public key** → safe for the app/control frontends.
   - **service_role key** → SECRET, server-side only. Never commit or ship to the browser.

## Next
- `app/` — customer booking PWA (reads `services`, creates `bookings`).
- `control/` — staff view to quote/confirm/assign bookings.
- Stripe payments + (Phase 3) realtime dispatch & captain app.
