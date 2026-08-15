import { supabase } from "./supabase";

/* Everything the captain app reads or writes.

   Row-level security does the filtering: a captain's session can only see
   bookings assigned to them and messages on those bookings, so nothing here
   passes a captain id around. If a query returns it, it's theirs. */

export type Trip = {
  id: string;
  status: "requested" | "quoted" | "confirmed" | "assigned" | "in_progress" | "completed" | "cancelled";
  pickup: string | null;
  destination: string | null;
  scheduled_at: string | null;
  return_at: string | null;
  passengers: number | null;
  trip_type: string | null;
  contact_name: string | null;
  notes: string | null;
  quoted_price_cents: number | null;
  paid_out_at: string | null;
  offered_at: string | null;
  captain_response: "accepted" | "declined" | null;
  decline_reason: string | null;
  assigned_boat_id: string | null;
  boats: { name: string | null } | null;
};

export type Message = {
  id: string;
  booking_id: string;
  sender: "customer" | "captain" | "dispatch";
  body: string;
  created_at: string;
};

export type Boat = {
  id: string;
  name: string;
  capacity: number | null;
  is_available: boolean;
  availability_changed_at: string | null;
};

export async function fetchTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, status, pickup, destination, scheduled_at, return_at, passengers, trip_type, " +
        "contact_name, notes, quoted_price_cents, paid_out_at, offered_at, captain_response, " +
        "decline_reason, assigned_boat_id, boats(name)"
    )
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Trip[];
}

export async function fetchMessages(): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, booking_id, sender, body, created_at")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function sendMessage(bookingId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { error } = await supabase
    .from("messages")
    .insert({ booking_id: bookingId, sender: "captain", body: text });
  if (error) throw error;
}

/** Answer an offer. The database checks it was actually offered to them. */
export async function answerOffer(
  id: string,
  answer: "accepted" | "declined",
  reason: string | null
): Promise<void> {
  const { error } = await supabase
    .from("bookings")
    .update({
      captain_response: answer,
      response_by: "captain",
      responded_at: new Date().toISOString(),
      decline_reason: reason,
    })
    .eq("id", id);
  if (error) throw error;
}

/** A run that's been offered and not yet answered is a question, not a job. */
export const isBeingAsked = (t: Trip): boolean =>
  !!t.offered_at && !t.captain_response && t.status !== "completed" && t.status !== "cancelled";

/** Move a trip along. The database refuses anything else a captain might try. */
export async function setTripStatus(id: string, status: "in_progress" | "completed"): Promise<void> {
  const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
  if (error) throw error;
}

/** The signed-in captain's boat. Explicitly by owner, since an admin sees all. */
export async function fetchMyBoat(userId: string): Promise<Boat | null> {
  const { data, error } = await supabase
    .from("boats")
    .select("id, name, capacity, is_available, availability_changed_at")
    .eq("owner_id", userId)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as Boat) ?? null;
}

export async function setAvailability(boatId: string, available: boolean): Promise<void> {
  const { error } = await supabase.from("boats").update({ is_available: available }).eq("id", boatId);
  if (error) throw error;
}

/* ── shaping ──────────────────────────────────────────────────────────────
   Kept next to the queries so the screens stay about layout. */

export const isToday = (iso: string | null): boolean => {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
};

/** Today's work, including a run that started this morning and overran. */
export function todaysTrips(trips: Trip[]): Trip[] {
  return trips.filter((t) => {
    if (t.status === "completed" || t.status === "cancelled") return false;
    if (t.captain_response === "declined") return false;
    const at = t.scheduled_at ? new Date(t.scheduled_at) : null;
    return isToday(t.scheduled_at) || (at !== null && at < new Date());
  });
}

export function upcomingTrips(trips: Trip[]): Trip[] {
  return trips.filter((t) => {
    if (t.status === "completed" || t.status === "cancelled") return false;
    if (t.captain_response === "declined") return false;
    const at = t.scheduled_at ? new Date(t.scheduled_at) : null;
    return !isToday(t.scheduled_at) && at !== null && at >= new Date();
  });
}

/* Boats are paid every Friday, so a pay week runs Friday to Thursday and is
   settled on the Friday straight after. Same rule as the dispatch board — if
   one changes, change both. */
const PAY_WEEK_ENDS_ON = 5; // 0 Sun … 5 Fri

export function payWeekStart(offset = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() - PAY_WEEK_ENDS_ON + 7) % 7;
  d.setDate(d.getDate() - back + offset * 7);
  return d;
}

export function payWeek(offset = 0) {
  const start = payWeekStart(offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  return { start, end, lastDay, payday: end };
}

export function tripsInWeek(trips: Trip[], offset = 0): Trip[] {
  const { start, end } = payWeek(offset);
  return trips
    .filter((t) => {
      if (t.status !== "completed" || !t.scheduled_at) return false;
      const at = new Date(t.scheduled_at);
      return at >= start && at < end;
    })
    .sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""));
}

export const sumCents = (trips: Trip[]): number =>
  trips.reduce((n, t) => n + (t.quoted_price_cents ?? 0), 0);

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** Passenger messages sitting unanswered since anyone here last replied. */
export function awaitingReply(msgs: Message[]): number {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].sender === "customer") n++;
    else break;
  }
  return n;
}

export function groupByBooking(msgs: Message[]): Map<string, Message[]> {
  const m = new Map<string, Message[]>();
  for (const msg of msgs) {
    if (!m.has(msg.booking_id)) m.set(msg.booking_id, []);
    m.get(msg.booking_id)!.push(msg);
  }
  return m;
}
