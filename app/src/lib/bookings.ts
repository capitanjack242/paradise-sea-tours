import { supabase } from "./supabase";
import type { Fix } from "./location";

/** A bookable offering — routes, charters and fishing trips all live here. */
export type Service = {
  id: string;
  slug: string;
  category: "route" | "charter" | "fishing";
  title: string;
  description: string | null;
  pricing_model: "per_person" | "per_hour" | "per_boat";
  price_cents: number | null;
  /** Per person there and back. Null means a round trip is two one-ways. */
  round_trip_cents: number | null;
  from_point: string | null;
  to_point: string | null;
  est_minutes: number | null;
};

export type TripType = "One way" | "Round trip" | "Private charter (whole boat)";

/** Not a dock, so not in the table — always offered last. */
export const OTHER_DOCK = "Other (see notes)";

/**
 * The docks a passenger can be picked up from or dropped at — a fallback only.
 * The real list is the `docks` table (fetchDocks), shared with the website, so
 * a new dock is a row rather than a store release.
 */
export const LOCATIONS: readonly string[] = [
  "Nassau Cruise Port",
  "Paradise Island – Margaritaville",
  "Paradise Island – Carnival",
  "Pearl Island",
  "Floating Bar",
  "Blue Lagoon",
  "Señor Frog's",
  "Green Parrot",
  "Poop Deck",
  "Fort Montagu",
  "Pigs Beach",
  "Rose Island – Goodies",
  "Junkanoo Beach",
  "Arawak Cay / Fish Fry",
  "Goodman's Bay",
  "Breezes",
  "Baha Mar",
  OTHER_DOCK,
];

/** Drop-off only: somewhere to go, never somewhere to be picked up. Fallback copy of docks.can_pickup. */
export const DROPOFF_ONLY: readonly string[] = [
  "Pearl Island",
  "Floating Bar",
  "Blue Lagoon",
  "Pigs Beach",
  "Rose Island – Goodies",
];

/** Fallback pickup list, for when the shared list can't be read. */
export const PICKUPS: readonly string[] = LOCATIONS.filter((n) => !DROPOFF_ONLY.includes(n));

/**
 * The shared dock list, with "Other" on the end: every stop as a destination,
 * and only the ones that take pickups as a pickup. Throws if it can't be read.
 */
export async function fetchDocks(): Promise<{ pickups: string[]; destinations: string[] }> {
  const { data, error } = await supabase.from("docks").select("name, can_pickup").order("sort");
  if (error) throw error;
  const rows = (data ?? []) as { name: string; can_pickup: boolean | null }[];
  if (!rows.length) return { pickups: [...PICKUPS], destinations: [...LOCATIONS] };
  return {
    pickups: [...rows.filter((d) => d.can_pickup !== false).map((d) => d.name), OTHER_DOCK],
    destinations: [...rows.map((d) => d.name), OTHER_DOCK],
  };
}

/**
 * Bahamas VAT, read from the database rather than typed into the app.
 *
 * A number compiled into a build cannot be corrected without shipping to two
 * app stores and waiting for review, so the rate lives in one row that the
 * website, both apps and dispatch all read. The fallback is the current rate,
 * never zero: an app that quietly drops the tax quotes a price nobody can
 * honour at the dock.
 */
export const VAT_FALLBACK_PCT = 10;

export async function fetchVatPct(): Promise<number> {
  const { data, error } = await supabase.from("app_settings").select("vat_pct").limit(1);
  if (error) throw error;
  const pct = data?.[0]?.vat_pct;
  return pct == null ? VAT_FALLBACK_PCT : Number(pct);
}

/** What a fare becomes once the tax is on it. Rounded once, in cents. */
export function withVat(fareCents: number | null, vatPct: number) {
  if (fareCents == null) return { fare: null, vat: null, total: null };
  const vat = Math.round((fareCents * vatPct) / 100);
  return { fare: fareCents, vat, total: fareCents + vat };
}

/** The rate as it should read on screen: "10", not "10.00". */
export function vatLabel(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : String(pct).replace(/0+$/, "");
}

export async function fetchRoutes(): Promise<Service[]> {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("category", "route")
    .order("sort");
  if (error) throw error;
  return (data ?? []) as Service[];
}

/** Per person for this trip type: a round trip has its own price, else two legs. */
export function perPersonCents(route: Service, tripType: TripType): number | null {
  if (!route.price_cents) return null;
  return tripType === "Round trip" ? route.round_trip_cents ?? route.price_cents * 2 : route.price_cents;
}

/**
 * Fare for a trip. Routes are priced per person; a round trip has its own price.
 * Returns null when we don't have a published price for that pair — dispatch
 * quotes those by hand rather than the app inventing a number.
 */
export function quoteCents(
  route: Service | undefined,
  passengers: number,
  tripType: TripType
): number | null {
  if (!route?.price_cents) return null;
  // A charter is the whole boat by the hour, not seats on a route. The price
  // list doesn't cover it, so the office quotes it — the database does the same.
  if (tripType === "Private charter (whole boat)") return null;
  return (perPersonCents(route, tripType) ?? 0) * passengers;
}

export function formatMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * The published route between two stops, either way round. Exact names — the
 * same rule as the database's quote_fare — since every stop comes from the one
 * dock list.
 */
export function matchRoute(
  routes: Service[],
  pickup: string,
  destination: string
): Service | undefined {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const a = norm(pickup);
  const b = norm(destination);
  return routes.find((r) => {
    const from = norm(r.from_point);
    const to = norm(r.to_point);
    return (from === a && to === b) || (from === b && to === a);
  });
}

export type NewBooking = {
  pickup: string;
  destination: string;
  scheduledAt: Date;
  returnAt: Date | null;
  passengers: number;
  tripType: TripType;
  contactName: string;
  contactPhone: string;
  notes?: string;
  /** Where they're actually standing, if they chose to share it. */
  location?: Fix | null;
};

/**
 * Create the booking request. Deliberately does NOT set status, price or any
 * assignment — row-level security rejects those from the public key, and the
 * fare is confirmed by dispatch before the passenger ever pays.
 */
/**
 * Ask for a boat, and get back the key to the trip.
 *
 * Goes through a database function rather than inserting straight into the
 * table, for one reason: the insert can create a booking but can't read one
 * back, so the app had no way to find the trip it had just made. The function
 * returns the access token of the row it created — which is what makes the
 * payment screen, the captain thread and tips reachable from the app at all.
 */
export async function createBooking(b: NewBooking): Promise<string> {
  const { data, error } = await supabase.rpc("request_boat", {
    p_contact_name: b.contactName,
    p_contact_phone: b.contactPhone,
    p_pickup: b.pickup,
    p_destination: b.destination,
    p_scheduled_at: b.scheduledAt.toISOString(),
    // Its own field, not a line of prose in the notes — this is what decides
    // whether a captain goes back for someone.
    p_return_at: b.returnAt ? b.returnAt.toISOString() : null,
    p_passengers: b.passengers,
    p_trip_type: b.tripType,
    p_notes: b.notes?.trim() || null,
    // Optional, and stored with the time it was taken — a captain reading a
    // pin needs to know whether it's from a minute ago or an hour ago.
    p_pickup_lat: b.location?.lat ?? null,
    p_pickup_lng: b.location?.lng ?? null,
    p_located_at: b.location ? b.location.at.toISOString() : null,
  });
  if (error) throw error;
  if (!data) throw new Error("The booking went through but we didn't get the trip back.");
  return data as string;
}
