// Makes a Fygaro payment link for one trip — the fare still owed, or a tip.
//
// Called by the trip page and the passenger app with the trip's token, the
// same key they already hold. The amount is worked out here from the database,
// never taken from the caller, so nobody can ask for a $1 link to a $300 trip.
//
// Until the Fygaro account exists this answers { connected: false }, and the
// pages fall back to what they do today: open a message to the office.
//
// Secrets (supabase secrets set …), from Fygaro → Settings → API Credentials:
//   FYGARO_BUTTON_URL  - the payment button's URL
//   FYGARO_KEY_ID      - the API key id
//   FYGARO_SECRET      - the API secret
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// Deployed with --no-verify-jwt: passengers have no login, the token is the key.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { centsToAmount, signPaymentJwt } from "../_shared/fygaro.ts";

const BUTTON_URL = Deno.env.get("FYGARO_BUTTON_URL") ?? "";
const KEY_ID = Deno.env.get("FYGARO_KEY_ID") ?? "";
const SECRET = Deno.env.get("FYGARO_SECRET") ?? "";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** A tip is a gift, but a typo shouldn't become a $5,000 one. */
const TIP_MIN_CENTS = 100;
const TIP_MAX_CENTS = 50000;
/** Long enough to find a card; short enough that an old link can't be reused. */
const LINK_LIFETIME_SECONDS = 30 * 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Said to a passenger, so in plain words. */
const refuse = (message: string) => json({ connected: true, error: message }, 400);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!BUTTON_URL || !KEY_ID || !SECRET) return json({ connected: false });

  let input: { token?: string; kind?: string; tip_cents?: number };
  try {
    input = await req.json();
  } catch {
    return refuse("Something went wrong — please try again.");
  }
  const kind = input.kind === "tip" ? "tip" : input.kind === "fare" ? "fare" : null;
  if (!input.token || !kind) return refuse("Something went wrong — please try again.");

  const { data: b, error } = await admin
    .from("bookings")
    .select(
      "id, status, quoted_price_cents, total_cents, amount_paid_cents, assigned_boat_id, completed_at, rated_at"
    )
    .eq("access_token", input.token)
    .maybeSingle();
  if (error) {
    console.error("booking lookup failed:", error.message);
    return json({ connected: true, error: "We couldn't reach your trip — please try again." }, 500);
  }
  if (!b) return refuse("We couldn't find that trip.");

  let cents: number;
  if (kind === "fare") {
    // The same gate the trip page shows: nothing to pay until the office has
    // confirmed a captain and a fare.
    if (b.status === "cancelled") return refuse("This trip was cancelled — there's nothing to pay.");
    if (b.status === "requested" || b.status === "quoted" || b.quoted_price_cents == null) {
      return refuse("Nothing to pay yet — we're confirming a captain first.");
    }
    const owed = (b.total_cents ?? b.quoted_price_cents) - (b.amount_paid_cents ?? 0);
    if (owed <= 0) return refuse("This trip is already paid for.");
    cents = owed;
  } else {
    // The same rule the database gives the page as can_tip (0027): after the
    // ride, once rated, for a week.
    const weekAgo = Date.now() - 7 * 86400000;
    const open =
      b.status === "completed" &&
      b.assigned_boat_id &&
      b.rated_at &&
      b.completed_at &&
      new Date(b.completed_at).getTime() > weekAgo;
    if (!open) return refuse("Tipping opens after the ride, once you've rated it.");
    const tip = Math.round(Number(input.tip_cents));
    if (!Number.isFinite(tip) || tip < TIP_MIN_CENTS || tip > TIP_MAX_CENTS) {
      return refuse("Choose a tip between $1 and $500.");
    }
    cents = tip;
  }

  // Our reference travels through Fygaro and comes back on the hook, which is
  // how the payment finds its trip. The nonce makes each link distinct.
  const reference = `${kind}:${b.id}:${crypto.randomUUID().slice(0, 8)}`;
  const jwt = await signPaymentJwt(KEY_ID, SECRET, {
    amount: centsToAmount(cents),
    currency: "USD",
    custom_reference: reference,
    exp: Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS,
  });

  const sep = BUTTON_URL.includes("?") ? "&" : "?";
  return json({ connected: true, url: `${BUTTON_URL}${sep}jwt=${jwt}`, amount_cents: cents });
});
