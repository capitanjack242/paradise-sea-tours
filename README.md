# Paradise Sea Express

On-demand **water tours** for Nassau, The Bahamas. Fast, fixed per-person rides
from the Cruise Port and downtown to Paradise Island, Atlantis, Cabbage Beach,
Rose Island and the cays.

This repo holds the public marketing site (and will grow to host the booking
platform).

```
paradise-sea-tours/
├── web/        Marketing website   ← live (static HTML/CSS/JS, deployed to Pages)
├── api/        Backend API         (planned)
├── control/    Dispatch dashboard  (planned)
└── app/        Customer app        (planned)
```

## The site (`web/`)
A fast, responsive landing page. No build step. Booking requests and "call"
buttons open WhatsApp with the trip details pre-filled, so the business can take
bookings before the app exists.

**To personalize:** edit the `CONFIG` block at the top of `web/script.js` with the
real phone, WhatsApp number and email. Update fares/routes in `web/index.html`.

## Run locally
```bash
open web/index.html
# or
cd web && python3 -m http.server 5500   # http://localhost:5500
```

## Deploy
Pushing to `main` auto-deploys `web/` to GitHub Pages via
`.github/workflows/pages.yml`.
