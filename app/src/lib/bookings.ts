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
  from_point: string | null;
  to_point: string | null;
  est_minutes: number | null;
};

export type TripType = "One way" | "Round trip" | "Private charter (whole boat)";

/** The docks a passenger can be picked up from or dropped at. */
export const LOCATIONS = [
  "Nassau Cruise Port",
  "Downtown Nassau / Prince George Wharf",
  "Paradise Island & Atlantis",
  "Atlantis Marina",
  "Cabbage Beach",
  "Rose Island & Cays",
  "The Sandbar",
  "Breezes Beach",
  "Baha Mar Dock",
  "Fish Fry Dock",
  "Long Wharf Beach",
  "Love Beach",
  "Sandyport",
  "Green Parrot Dock",
  "Potter's Cay Dock",
  "Montagu Dock",
  "Poop Deck (East Bay Street)",
] as const;

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

/**
 * Fare for a trip. Routes are priced per person; a round trip is both legs.
 * Returns null when we don't have a published price for that pair — dispatch
 * quotes those by hand rather than the app inventing a number.
 */
export function quoteCents(
  route: Service | undefined,
  passengers: number,
  tripType: TripType
): number | null {
  if (!route?.price_cents) return null;
  const legs = tripType === "Round trip" ? 2 : 1;
  return route.price_cents * passengers * legs;
}

export function formatMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** Find the published route matching a pickup/destination pair, either way round. */
export function matchRoute(
  routes: Service[],
  pickup: string,
  destination: string
): Service | undefined {
  const norm = (s: string | null) => (s ?? "").toLowerCase();
  const a = pickup.toLowerCase();
  const b = destination.toLowerCase();
  return routes.find((r) => {
    const from = norm(r.from_point);
    const to = norm(r.to_point);
    const hit = (x: string, y: string) =>
      (x.includes(from) || from.includes(x)) && (y.includes(to) || to.includes(y));
    return hit(a, b) || hit(b, a);
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
export async function createBooking(b: NewBooking): Promise<void> {
  const { error } = await supabase.from("bookings").insert({
    contact_name: b.contactName,
    contact_phone: b.contactPhone,
    pickup: b.pickup,
    destination: b.destination,
    scheduled_at: b.scheduledAt.toISOString(),
    // Its own column, not a line of prose in the notes — this is what decides
    // whether a captain goes back for someone.
    return_at: b.returnAt ? b.returnAt.toISOString() : null,
    passengers: b.passengers,
    trip_type: b.tripType,
    notes: b.notes?.trim() || null,
    // Optional, and stored with the time it was taken — a captain reading a
    // pin needs to know whether it's from a minute ago or an hour ago.
    pickup_lat: b.location?.lat ?? null,
    pickup_lng: b.location?.lng ?? null,
    located_at: b.location ? b.location.at.toISOString() : null,
  });
  if (error) throw error;
}
