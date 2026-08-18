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
  /** When the passenger paid. Null means he can't message them yet. */
  paid_at: string | null;
  offered_at: string | null;
  captain_response: "accepted" | "declined" | null;
  decline_reason: string | null;
  assigned_boat_id: string | null;
  /** The rate this trip was closed out at. Null while it's still running. */
  commission_pct: number | null;
  /** What the passenger added on top. All of it is his — no commission, no tax. */
  tip_cents: number;
  tip_paid_out_at: string | null;
  /** Where the passenger says they're standing. Null unless they shared it. */
  pickup_lat: number | null;
  pickup_lng: number | null;
  located_at: string | null;
  /** When this boat last reported its own position. Null means not sharing. */
  boat_located_at: string | null;
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
  /** Percent of the fare Paradise keeps. 0 means the boat gets the lot. */
  commission_pct: number;
};

/** What a fare splits into. Worked out in cents so nothing rounds away. */
export type Split = { gross: number; commission: number; net: number };

/** A week's money: the fares split up, plus tips, which are split with nobody. */
export type WeekTotal = Split & { tips: number; take: number };

export function splitFare(grossCents: number, commissionPct: number): Split {
  const pct = Number.isFinite(commissionPct) ? Math.max(0, commissionPct) : 0;
  const commission = Math.round((grossCents * pct) / 100);
  return { gross: grossCents, commission, net: grossCents - commission };
}

/**
 * The rate that applies to one trip.
 *
 * A completed trip carries the rate it was closed out at, so a change to the
 * boat's rate can't move a number a captain has already been paid. A trip
 * still running has no stamp and reads the boat — nothing is owed yet.
 */
export function tripPct(trip: Trip, boat: Boat | null): number {
  return trip.commission_pct != null ? Number(trip.commission_pct) : boat?.commission_pct ?? 0;
}

export async function fetchTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, status, pickup, destination, scheduled_at, return_at, passengers, trip_type, " +
        "contact_name, notes, quoted_price_cents, paid_out_at, paid_at, offered_at, captain_response, " +
        "decline_reason, assigned_boat_id, commission_pct, tip_cents, tip_paid_out_at, " +
        "pickup_lat, pickup_lng, located_at, boat_located_at, boats(name)"
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
    // channel is not optional: the write policy refuses a captain any other
    // one, so leaving it to the default fails every send.
    .insert({ booking_id: bookingId, sender: "captain", body: text, channel: "captain" });
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

/* ── where the passenger is standing ──────────────────────────────────────
   Shown only to the captain who has taken the run, and only while it's live.
   Before he accepts, it's none of his business; after drop-off the database
   has already thrown the coordinates away. Same rule as the phone number. */

export type Waiting = {
  lat: number;
  lng: number;
  /** How old the reading is. A pin without this is a lie waiting to happen. */
  minutesOld: number;
  stale: boolean;
};

/** Anything older than this and he should message rather than trust the pin. */
const STALE_AFTER_MINUTES = 30;

export function waitingAt(t: Trip): Waiting | null {
  if (t.pickup_lat == null || t.pickup_lng == null) return null;
  if (t.captain_response !== "accepted") return null;
  if (t.status === "completed" || t.status === "cancelled") return null;

  const taken = t.located_at ? new Date(t.located_at).getTime() : NaN;
  const minutesOld = Number.isFinite(taken)
    ? Math.max(0, Math.round((Date.now() - taken) / 60000))
    : Infinity;

  return {
    lat: t.pickup_lat,
    lng: t.pickup_lng,
    minutesOld,
    stale: minutesOld >= STALE_AFTER_MINUTES,
  };
}

export function howOld(minutes: number): string {
  if (!Number.isFinite(minutes)) return "time unknown";
  if (minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
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
    .select("id, name, capacity, is_available, availability_changed_at, commission_pct")
    .eq("owner_id", userId)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as Boat) ?? null;
}

/**
 * Tell the passenger where the boat is.
 *
 * Through a database function rather than an update, so a captain's grant stays
 * narrow: this takes a position and nothing else, and the database refuses it
 * on a trip that isn't his or isn't running.
 */
export async function reportBoatPosition(
  bookingId: string,
  lat: number,
  lng: number
): Promise<void> {
  const { error } = await supabase.rpc("report_boat_position", {
    p_booking: bookingId,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) throw error;
}

/** Stop, and wipe the pin — rather than leaving the last one to go stale. */
export async function stopSharingBoatPosition(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc("stop_sharing_boat_position", {
    p_booking: bookingId,
  });
  if (error) throw error;
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

/**
 * A week's money.
 *
 * Commission is taken per trip, so the total is the sum of the roundings rather
 * than a percentage of a total. Tips are added afterwards and untouched by any
 * of it — a tip is the passenger's money going straight to the captain.
 */
export function splitTrips(trips: Trip[], boat: Boat | null): WeekTotal {
  return trips.reduce<WeekTotal>(
    (acc, t) => {
      const s = splitFare(t.quoted_price_cents ?? 0, tripPct(t, boat));
      const tip = t.tip_cents ?? 0;
      return {
        gross: acc.gross + s.gross,
        commission: acc.commission + s.commission,
        net: acc.net + s.net,
        tips: acc.tips + tip,
        take: acc.take + s.net + tip,
      };
    },
    { gross: 0, commission: 0, net: 0, tips: 0, take: 0 }
  );
}

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
