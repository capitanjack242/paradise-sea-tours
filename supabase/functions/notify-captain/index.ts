// Pushes to a captain's phone when something happens that they'd otherwise
// have to open the app to discover.
//
// Two Database Webhooks point here (Database → Webhooks in the dashboard):
//   • messages / INSERT  — someone wrote on a trip they're running
//   • bookings / UPDATE   — a run was confirmed to them
//
// Required secrets (supabase secrets set …):
//   WEBHOOK_SECRET  - shared with both webhooks' custom header, so only the
//                     real webhook can make this send.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import { createClient } from "jsr:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";

// Service role: this has to read a booking's captain and their tokens, which
// no ordinary session is allowed to do.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

type Push = { to: string; title: string; body: string; data?: Record<string, unknown> };

async function tokensFor(userId: string): Promise<string[]> {
  const { data, error } = await admin.from("push_tokens").select("token").eq("user_id", userId);
  if (error) {
    console.error("token lookup failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.token as string);
}

async function send(messages: Push[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const res = await fetch(EXPO_PUSH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });
  const body = await res.json().catch(() => null);

  const tickets: any[] = body?.data ?? [];
  const bad = tickets.filter((t) => t?.status === "error");
  for (const t of bad) console.error("expo push error:", JSON.stringify(t));

  // A token Expo no longer recognises will never work again — drop it rather
  // than retrying it every time for the life of the app.
  const dead = tickets
    .map((t, i) => (t?.details?.error === "DeviceNotRegistered" ? messages[i].to : null))
    .filter(Boolean) as string[];
  if (dead.length) {
    await admin.from("push_tokens").delete().in("token", dead);
  }

  return { sent: tickets.length - bad.length, failed: bad.length };
}

function whenText(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Nassau",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const table: string = payload.table ?? "";
  const rec = payload.record;
  const old = payload.old_record;
  if (!rec) return new Response("no record", { status: 400 });

  let messages: Push[] = [];

  if (table === "messages") {
    // A captain doesn't need telling about his own message.
    if (rec.sender === "captain") return json({ skipped: "own message" });

    const { data: booking } = await admin
      .from("bookings")
      .select("assigned_captain_id, contact_name, pickup, destination")
      .eq("id", rec.booking_id)
      .maybeSingle();

    if (!booking?.assigned_captain_id) return json({ skipped: "no captain on this trip" });

    const from = rec.sender === "dispatch" ? "The office" : booking.contact_name || "Your passenger";
    const tokens = await tokensFor(booking.assigned_captain_id);
    messages = tokens.map((to) => ({
      to,
      title: `${from} messaged you`,
      body: String(rec.body ?? "").slice(0, 140),
      data: { kind: "message", bookingId: rec.booking_id },
    }));
  } else if (table === "bookings") {
    // Only the moment a run becomes theirs — not every edit to the row.
    const nowConfirmed = rec.status === "confirmed" && old?.status !== "confirmed";
    const justAssigned =
      rec.assigned_captain_id && rec.assigned_captain_id !== old?.assigned_captain_id;
    if (!rec.assigned_captain_id || (!nowConfirmed && !justAssigned)) {
      return json({ skipped: "nothing a captain needs to hear about" });
    }

    const tokens = await tokensFor(rec.assigned_captain_id);
    const when = whenText(rec.scheduled_at);
    messages = tokens.map((to) => ({
      to,
      title: nowConfirmed ? "Run confirmed" : "New run for you",
      body: `${rec.pickup ?? "?"} → ${rec.destination ?? "?"}${when ? `, ${when}` : ""}`,
      data: { kind: "run", bookingId: rec.id },
    }));
  } else {
    return json({ skipped: `unhandled table ${table}` });
  }

  const result = await send(messages);
  return json(result);
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}
