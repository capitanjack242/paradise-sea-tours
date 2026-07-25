// Sends a Telegram message whenever a new row is inserted into `bookings`.
// Triggered by a Supabase Database Webhook (Database → Webhooks in the
// dashboard) configured on bookings/INSERT, pointed at this function's URL.
//
// Required secrets (set via `supabase secrets set`, never committed):
//   TELEGRAM_BOT_TOKEN  - from @BotFather
//   TELEGRAM_CHAT_IDS   - comma-separated chat ids to notify (staff, not customers)
//   WEBHOOK_SECRET      - shared secret; must match the webhook's custom header,
//                         so only the real Database Webhook can trigger a send.

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_IDS = (Deno.env.get("TELEGRAM_CHAT_IDS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Nassau",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function bookingMessage(b: Record<string, unknown>): string {
  return (
    `🚤 New booking request\n\n` +
    `Name: ${b.contact_name ?? "—"}\n` +
    `Phone: ${b.contact_phone ?? "—"}\n` +
    `Pickup: ${b.pickup ?? "—"}\n` +
    `Destination: ${b.destination ?? "—"}\n` +
    `When: ${fmtWhen(b.scheduled_at as string | null)}\n` +
    `Passengers: ${b.passengers ?? "—"}\n` +
    `Type: ${b.trip_type ?? "—"}\n` +
    `Notes: ${b.notes || "-"}`
  );
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  if (TELEGRAM_CHAT_IDS.length === 0) {
    return new Response("no chat ids configured", { status: 500 });
  }

  const payload = await req.json();
  const booking = payload.record;
  if (!booking) return new Response("no record in payload", { status: 400 });

  const text = bookingMessage(booking);

  const results = await Promise.all(
    TELEGRAM_CHAT_IDS.map((chatId) =>
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).then((r) => r.json())
    )
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("telegram send failures:", JSON.stringify(failed));
  }

  return new Response(JSON.stringify({ sent: results.length, failed: failed.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
