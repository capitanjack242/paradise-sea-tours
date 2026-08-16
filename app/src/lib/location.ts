import * as Location from "expo-location";

/* Where the passenger is standing, for the captain coming to get them.
   Foreground only — we ask at the moment it earns its keep, read the phone
   once, and never look again until they ask for another boat.

   Every function here answers with null rather than throwing. A passenger who
   says no, or is below deck with no signal, still gets their boat: the dock
   they picked is the booking, and this is only ever a bonus on top of it. */

export type Fix = { lat: number; lng: number; at: Date };

export type Permission = "granted" | "denied" | "undetermined";

/** How long we'll keep someone waiting on a satellite before giving up. */
const FIX_TIMEOUT_MS = 6000;

export async function checkPermission(): Promise<Permission> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") return "granted";
    // "Not yet asked" and "asked and refused" need different words in the
    // interface: one is a button, the other is a trip to Settings.
    return status === "denied" && !canAskAgain ? "denied" : "undetermined";
  } catch {
    return "denied";
  }
}

/**
 * Ask if we haven't already, then take one reading. Returns null on a refusal,
 * a timeout, or any failure at all — callers are expected to carry on.
 */
export async function locate(): Promise<Fix | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
  } catch {
    return null;
  }

  // A precise fix can take a while on a phone that has just come off a ship, so
  // race it against the clock and settle for the last known position if the
  // satellites are slow. Stale-but-close beats a spinner on the Request button.
  const fresh = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  }).catch(() => null);

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));

  try {
    const position =
      (await Promise.race([fresh, timeout])) ??
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null));
    if (!position) return null;

    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      at: new Date(position.timestamp),
    };
  } catch {
    return null;
  }
}
