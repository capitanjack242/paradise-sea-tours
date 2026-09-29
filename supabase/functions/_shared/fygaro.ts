/* Talking to Fygaro, in both directions.

   Out: a payment link is Fygaro's button URL with a signed token on the end
   (`?jwt=…`). The token carries the amount and our own reference, signed with
   the account's secret, so the amount can't be edited in the address bar.
   Signed links need Fygaro's Pro plan or above.
     https://help.fygaro.com/en-us/article/fygaro-links-integration-api-h78p9y/

   In: when a payment succeeds Fygaro POSTs to our hook with two headers —
   Fygaro-Key-ID (which credential) and Fygaro-Signature ("t=<time>,v1=<hash>"),
   where hash = HMAC-SHA-256(secret, t + "." + raw body).
     https://help.fygaro.com/en-us/article/payment-button-hook-1wkui1k/

   Web Crypto only, so this runs the same in the Edge Functions (Deno) and in
   the tests (Node). */

const enc = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** "33.00" — Fygaro takes money as a string with two decimals. */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "33.00" → 3300. Null for anything that isn't a positive amount. */
export function amountToCents(amount: unknown): number | null {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export async function signPaymentJwt(
  keyId: string,
  secret: string,
  payload: { amount: string; currency: string; custom_reference: string; exp: number }
): Promise<string> {
  const header = base64Url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT", kid: keyId })));
  const body = base64Url(enc.encode(JSON.stringify(payload)));
  const sig = base64Url(await hmac(secret, `${header}.${body}`));
  return `${header}.${body}.${sig}`;
}

/** Equal-time comparison, so the check can't be timed to guess a signature. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Did this hook really come from Fygaro?
 *
 * The docs don't say whether the hash is written in hex or base64, so both are
 * accepted — they are two spellings of the same 32 bytes, not a weaker check.
 * A signature more than a day old is refused, so a captured request can't be
 * replayed later; duplicates inside that window are caught by the database.
 */
export async function verifyHook(
  secret: string,
  signatureHeader: string | null,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const ts = Number(t);
  if (Number.isFinite(ts)) {
    // Fygaro may send seconds or milliseconds; either way, within a day.
    const secs = ts > 1e12 ? ts / 1000 : ts;
    if (Math.abs(nowSeconds - secs) > 86400) return false;
  }

  const mac = await hmac(secret, `${t}.${rawBody}`);
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = btoa(String.fromCharCode(...mac));
  const b64url = base64Url(mac);
  return sameString(v1.toLowerCase(), hex) || sameString(v1, b64) || sameString(v1, b64url);
}

/** Our reference on a payment: "fare:<booking id>:<nonce>" or "tip:…". */
export function parseReference(ref: unknown): { kind: "fare" | "tip"; bookingId: string } | null {
  const m = String(ref ?? "").match(
    /^(fare|tip):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[0-9a-z]+$/i
  );
  return m ? { kind: m[1].toLowerCase() as "fare" | "tip", bookingId: m[2].toLowerCase() } : null;
}
