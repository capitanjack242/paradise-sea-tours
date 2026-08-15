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

## Push notifications

Coded, and needs three things switched on before it can deliver:

1. `supabase/migrations/0015_push_tokens.sql` — where a device is recorded.
2. An **EAS project id**. Push tokens are issued against an Expo account:
   `npx eas init` inside this folder writes `extra.eas.projectId` into app.json.
   Without it the app says so on a yellow bar rather than failing silently.
3. The **notify-captain** Edge Function deployed, with two Database Webhooks
   pointed at it — `messages` on INSERT, `bookings` on UPDATE — each sending
   the `x-webhook-secret` header.

**Expo Go cannot receive remote push.** Testing needs a development build
(`npx expo run:ios`, `npx expo run:android`, or an EAS build). Registration
failing never blocks the app: a captain who declined notifications, or is on a
simulator, still gets every screen.

A captain is told when a run is confirmed to them and when anyone messages a
trip they're running — never about their own messages. Tapping the notification
opens that trip's thread.

## Not built yet

- **The offer/accept step.** Dispatch assigns and confirms today; the app has
  no "you've been offered a run, yes or no" screen. That's the piece that
  turns the phone call into a record.
