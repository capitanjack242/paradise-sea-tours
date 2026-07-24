# Backend (Supabase)

Postgres data model + row-level security for Paradise Sea Tours. Shared by the
customer app (`app/`) and the dispatch/control view (`control/`).

## Schema (`migrations/0001_init.sql`)
- **profiles** — one per auth user; `role` = customer | captain | admin.
- **boats** — vessels, owned by a captain profile.
- **services** — every bookable offering: routes (per-person), charters
  (per-hour), fishing tours (per-boat). Drives pricing.
- **bookings** — the core record; lifecycle:
  `requested → quoted → confirmed → assigned → in_progress → completed / cancelled`.
  Guest bookings allowed (nullable `customer_id`) so the public site can submit.
- **payments** — Stripe payment intents per booking (Phase 2b).

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
