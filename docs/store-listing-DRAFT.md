# App Store & Google Play listings — DRAFT

> For Admin to check, then paste into App Store Connect and the Google Play
> Console. Character limits noted; everything below fits them. **[ADMIN]**
> marks facts only the business can supply.

---

## 1. Passenger app — "Paradise Sea Express"

Bundle / package: `com.paradiseseaexpress.app` · Category: **Travel**

**Name** (30): `Paradise Sea Express`
**Subtitle** (Apple, 30): `Boat rides across Nassau`
**Short description** (Google, 80): `Fixed-price boat rides in Nassau — Cruise Port to Paradise Island and the cays.`

**Keywords** (Apple, 100, comma-separated, no spaces):
`nassau,bahamas,boat,water,ferry,paradise island,atlantis,rose island,cruise port,charter,tour`

**Description** (4,000):

> Skip the bridge traffic. Paradise Sea Express takes you across Nassau by boat —
> from the Cruise Port and downtown to Paradise Island, Atlantis, Cabbage Beach,
> Rose Island and the cays.
>
> • Fixed per-person fares, shown before you book — VAT included, no haggling
> • Pick your dock, your time and how many are coming
> • Nothing to pay until a local captain has said yes
> • Pay by card, then message your captain directly
> • See your boat on the way when it's close
> • Rate the trip, and tip your captain if it was good — every cent goes to them
> • Whole-boat charters quoted on request
>
> No account needed: book with your name and mobile number, and your trip stays
> on your phone.
>
> Times are always Nassau time, even if your phone is still on home time.

**What's New** (v1.0): `First release.`

**Support URL:** https://paradiseseaexpress.com/#contact
**Privacy policy URL:** https://paradiseseaexpress.com/privacy **[ADMIN: publish the reviewed draft first — docs/privacy-policy-DRAFT.md]**
**Marketing URL:** https://paradiseseaexpress.com

**Age rating:** 4+ / Everyone (no objectionable content; messaging is only with our staff and your captain).

**App Review notes (Apple):**
> No login is required. To try it: book any route for tomorrow with any name and
> a valid phone number. Bookings go to our dispatch office; please add "APPLE
> REVIEW" in the notes so we don't send a boat. Payment is for a real-world boat
> ride and is taken on our payment provider's web page (guideline 3.1.5(a)).
> Location is optional and read once, when requesting a boat, so the captain can
> find the passenger on the dock.

**App privacy (Apple "nutrition label") / Google Data safety** — from what the
app actually does:

| Data | Collected | Linked to the person | Used for | Tracking |
|---|---|---|---|---|
| Name | Yes | Yes | App functionality | No |
| Phone number | Yes | Yes | App functionality | No |
| Precise location | Yes, optional, once per booking | Yes | App functionality | No |
| Messages (in-app) | Yes | Yes | App functionality | No |
| Purchase history (trips and payments) | Yes | Yes | App functionality | No |
| Other user content (ratings, notes) | Yes | Yes | App functionality, product improvement | No |

Not collected: card details (entered on Fygaro's page), contacts, photos,
browsing history, identifiers for advertising. No third-party analytics or ads.

---

## 2. Captain app — "Paradise Captain"

Bundle / package: `com.paradiseseaexpress.captain` · Category: **Business**

**Name** (30): `Paradise Captain`
**Subtitle** (30): `For Paradise Sea Express crews`
**Short description** (80): `Runs, messages and earnings for Paradise Sea Express captains in Nassau.`

**Description:**

> The captain's app for Paradise Sea Express. For captains working with us in
> Nassau — a login is issued by our office.
>
> • Get new runs with an alert you won't sleep through, and accept or decline
> • Mark passengers aboard and trips finished
> • Message your passengers once their trip is paid for
> • Say when you're available; the office sees who's free
> • Share your boat's position with passengers on the way, only while you're on
> • See this week's earnings, commission and tips — tips are yours in full

**App Review notes (Apple):**
> Staff-only app: accounts are created by our office. Reviewer login:
> **[ADMIN: create a test captain login + a test boat before submitting]**.
> Location is used only while the captain is switched on as available and the app
> is open; switching off stops it and deletes the last position. Notifications
> use the Time Sensitive level only for new run offers, which expire after ten
> minutes.

**Privacy / Data safety:** name, email, precise location (while available only),
messages, and earnings — all linked to the captain's account, all for app
functionality, no tracking, no ads.

---

## 3. Screenshots

Apple needs 6.9" iPhone screenshots (1320 × 2868) — the apps are iPhone-only, so
no iPad set. Google needs at least 2 phone screenshots.

Passenger: booking with the fare shown · trip confirmed with the boat on the way ·
payment · messages with the captain · rate and tip.
Captain: a new run being offered · today's runs · earnings week.

**[Coding: capture these from the development builds once they're on a phone.]**

---

## 4. Before submitting — checklist

- [ ] Company developer accounts (Apple needs a D-U-N-S number) — Admin
- [ ] Privacy policy and terms reviewed and published at /privacy and /terms — Admin, then Coding publishes
- [ ] Test captain login for Apple review — Admin
- [ ] Push credentials: Apple push key + Firebase project for Android, added to Expo — Admin creates, Coding wires
- [ ] Screenshots from real builds — Coding
