// Fygaro tells us a card payment went through. Record it against the trip.
//
// Set this function's URL as the Hook on the Fygaro payment button:
//   https://fjdoaonnoezbbitbawzs.supabase.co/functions/v1/fygaro-hook
//
// Every request is checked against the account secret before anything is
// believed (see _shared/fygaro.ts). The database records each Fygaro
// transaction once, so a resent notification changes nothing.
//
// Answers 200 whenever there is nothing to retry — a duplicate, or a payment
// that isn't ours — and 500 only when trying again later could succeed.
//
// Secrets: FYGARO_KEY_ID, FYGARO_SECRET (same as pay-link).
// Deployed with --no-verify-jwt: Fygaro has no Supabase login; the signature
// is the check.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { amountToCents, parseReference, verifyHook } from "../_shared/fygaro.ts";

const KEY_ID = Deno.env.get("FYGARO_KEY_ID") ?? "";
const SECRET = Deno.env.get("FYGARO_SECRET") ?? "";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!SECRET) return reply({ error: "not configured" }, 503);

  // The signature covers the exact bytes sent, so read them before parsing.
  const raw = await req.text();

  const keyId = req.headers.get("Fygaro-Key-ID");
  if (KEY_ID && keyId && keyId !== KEY_ID) {
    return reply({ error: "unknown key" }, 401);
  }
  if (!(await verifyHook(SECRET, req.headers.get("Fygaro-Signature"), raw))) {
    return reply({ error: "bad signature" }, 401);
  }

  let p: Record<string, unknown>;
  try {
    p = JSON.parse(raw);
  } catch {
    return reply({ error: "not json" }, 400);
  }

  const ref = parseReference(p.customReference ?? p.custom_reference);
  if (!ref) {
    // A payment on the same Fygaro account that didn't come from our links —
    // someone paying a plain button, say. Not ours to record; don't make
    // Fygaro keep retrying it.
    console.warn("hook without one of our references:", p.customReference ?? p.custom_reference);
    return reply({ skipped: "not a trip payment" });
  }

  const currency = String(p.currency ?? "USD").toUpperCase();
  if (currency !== "USD") {
    console.error("unexpected currency", currency, "for", ref.bookingId);
    return reply({ skipped: "unexpected currency" });
  }

  const cents = amountToCents(p.amount);
  const transaction = String(p.transactionId ?? p.reference ?? "");
  if (!cents || !transaction) {
    console.error("hook missing amount or transaction id:", raw.slice(0, 500));
    return reply({ skipped: "missing amount or transaction" });
  }

  const { data, error } = await admin.rpc("record_provider_payment", {
    p_booking: ref.bookingId,
    p_amount_cents: cents,
    p_kind: ref.kind,
    p_provider: "fygaro",
    p_reference: transaction,
  });
  if (error) {
    console.error("recording payment failed:", error.message);
    // A booking that doesn't exist won't appear by retrying; anything else might.
    return /No such booking/.test(error.message)
      ? reply({ skipped: "unknown booking" })
      : reply({ error: "could not record" }, 500);
  }

  return reply({ result: data, booking: ref.bookingId, kind: ref.kind, cents });
});
