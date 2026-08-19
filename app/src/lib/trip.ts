import { supabase } from "./supabase";

/* A passenger's own trip, read the same way the web trip page reads it: through
   the token-keyed function, never a table. The app has no more access to the
   database than a link in a text message does. */

export type TripMessage = {
  sender: "customer" | "captain" | "dispatch";
  body: string;
  channel: "office" | "captain";
  at: string;
};

export type TripView = {
  pickup: string | null;
  destination: string | null;
  scheduled_at: string | null;
  return_at: string | null;
  passengers: number | null;
  trip_type: string | null;
  status: string;
  fare_cents: number | null;
  /** The rate this trip was taken at — not today's rate. */
  vat_pct: number | null;
  vat_cents: number | null;
  /** Fare plus tax. This is what has to be paid, not fare_cents. */
  total_cents: number | null;
  /** What the passenger added for the captain. Never part of the balance. */
  tip_cents: number | null;
  boat: string | null;
  captain: string | null;
  /* Where the boat is, while the captain is sharing it. Null otherwise — and
     null on a fix older than a few minutes, since the database withholds
     anything stale rather than showing a pin that has stopped being true. */
  boat_lat: number | null;
  boat_lng: number | null;
  boat_located_at: string | null;
  paid_at: string | null;
  amount_paid_cents: number | null;
  balance_cents: number | null;
  can_reply: boolean;
  /** False until the trip is paid for. The office stays reachable regardless. */
  can_message_captain: boolean;
  /** When the captain closed the trip out. Null until then. */
  completed_at: string | null;
  /* How it went, 1-5 each, and when they said so. Null until they do. */
  rating_captain: number | null;
  rating_ride: number | null;
  rating_note: string | null;
  rated_at: string | null;
  /** True for the week after the ride — a rating stays changeable that long. */
  can_rate: boolean;
  /* True once the ride is over — a completed trip, with a boat on it, inside the
     week the database allows a tip to be added. Never true before the ride. */
  can_tip: boolean;
  messages: TripMessage[];
};

export async function fetchTrip(token: string): Promise<TripView | null> {
  const { data, error } = await supabase.rpc("trip_thread", { p_token: token });
  if (error) throw error;
  return (data as TripView) ?? null;
}

/**
 * Send on one side of the conversation.
 *
 * The database refuses the captain channel on an unpaid trip, and says so in a
 * sentence written to be read by a passenger — so its message is shown as-is
 * rather than replaced with something generic.
 */
export async function sendTripMessage(
  token: string,
  body: string,
  channel: "office" | "captain" = "office"
): Promise<void> {
  const { error } = await supabase.rpc("trip_send", {
    p_token: token,
    p_body: body,
    p_channel: channel,
  });
  if (error) throw error;
}

/**
 * How the captain did, and how the trip went.
 *
 * Both scores are required — the database refuses one without the other, since
 * half an answer tells dispatch nothing about which of the two went wrong.
 */
export async function rateTrip(
  token: string,
  captain: number,
  ride: number,
  note?: string | null
): Promise<void> {
  const { error } = await supabase.rpc("trip_rate", {
    p_token: token,
    p_captain: captain,
    p_ride: ride,
    p_note: note?.trim() ? note.trim() : null,
  });
  if (error) throw error;
}
