# Paradise Captain

The captain's app. What a boat sees: today's runs, one action at a time, the
passenger thread, and what they're owed this week.

## Running it

    cd captain-app
    npm install
    npx expo start          # add --web to open it in a browser

Captains sign in with the email and password created for them in Supabase
(Authentication → Users), then linked to their boat:

    update boats set owner_id = (select id from auth.users where email = '<their email>')
    where name = '<boat name>';

Without that link they sign in successfully and see nothing, because row-level
security scopes every query to trips assigned to them.

## Why email and password

The mockup drew phone sign-in, matching the passenger app. That's still the
better answer — a captain has a phone, not necessarily an email he can find —
but it waits on an SMS provider being connected. Captains are staff whose
logins are made for them anyway, so this ships now and the swap later touches
only `src/lib/session.ts`.

## Not built yet

- **Push notifications.** The reason to be native at all. Needs Expo push
  credentials and a real device; a captain currently has to open the app.
- **The offer/accept step.** Dispatch assigns and confirms today; the app has
  no "you've been offered a run, yes or no" screen. That's the piece that
  turns the phone call into a record.
