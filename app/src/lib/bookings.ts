import { supabase } from "./supabase";

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

export type TripType = "One way" | "Round trip";

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
};

/**
 * Create the booking request. Deliberately does NOT set status, price or any
 * assignment — row-level security rejects those from the public key, and the
 * fare is confirmed by dispatch before the passenger ever pays.
 */
export async function createBooking(b: NewBooking): Promise<void> {
  const notes = [
    b.notes?.trim(),
    b.returnAt ? `Return leg: ${b.returnAt.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const { error } = await supabase.from("bookings").insert({
    contact_name: b.contactName,
    contact_phone: b.contactPhone,
    pickup: b.pickup,
    destination: b.destination,
    scheduled_at: b.scheduledAt.toISOString(),
    passengers: b.passengers,
    trip_type: b.tripType,
    notes: notes || null,
  });
  if (error) throw error;
}
