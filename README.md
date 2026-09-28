# Paradise Sea Express

On-demand boats in Nassau, The Bahamas. Fixed per-person rides from the Cruise
Port and downtown to Paradise Island, Atlantis, Cabbage Beach, Rose Island and
the cays, plus whole-boat charters quoted by the office.

```
paradise-sea-express/
├── web/          Marketing site + booking form            → /
├── trip/         A passenger's own trip page (token link) → /trip/?t=…
├── control/      Dispatch board for the office            → /control/
├── captain/      Captain's board in a browser             → /captain/
├── app/          Passenger app (Expo / React Native)
├── captain-app/  Captain app (Expo / React Native)
├── supabase/     Database migrations and Edge Functions
└── scripts/      Site build, run-alert consistency check
```

## The web surfaces
Static HTML/CSS/JS, no build step of their own. `scripts/build-site.sh`
assembles them into `_site/` and stamps asset URLs with the commit hash.

Booking on the website and in the app both go through the `request_boat`
database function, which hands back the trip's access token. The website then
sends the customer straight to their trip page — messages, paying, rating and
tipping all live there.

## Run locally
```bash
sh scripts/build-site.sh && cd _site && python3 -m http.server 5500
```
The apps: `cd app && npx expo start` (or `captain-app`); add `--web` for a browser.

## Deploy
- **Site:** push to `main`. Cloudflare runs `scripts/build-site.sh` and serves
  `_site` (see `wrangler.jsonc`).
- **Database:** `supabase db push --linked` applies new files in
  `supabase/migrations/`. See `supabase/README.md`.
- **Edge Functions:** `supabase functions deploy <name>` (needs
  `TMPDIR=$HOME/.cache/supabase-tmp/` on this Mac — Colima only shares /Users).
