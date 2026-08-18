import * as Location from "expo-location";

/* Where the boat is, for the passenger waiting on it.
 *
 * The mirror of the passenger app's location file, with one difference: this
 * one repeats. A passenger shares where they're standing once; a captain on
 * the way has to keep saying where he is or the pin goes stale and stops being
 * shown at all.
 *
 * Foreground only. The phone reports while the captain has the app open and
 * has turned sharing on for that trip. Nothing is collected in the background,
 * which is a real limitation — a phone in a pocket with the screen off stops
 * reporting — and the honest fix for it is a background entitlement from both
 * stores, which is a separate job.
 *
 * Every function answers with null rather than throwing. A captain who refuses
 * the permission still runs his trips exactly as before.
 */

export type Fix = { lat: number; lng: number };
export type Permission = "granted" | "denied" | "undetermined";

/** How long to wait on a satellite before settling for the last known fix. */
const FIX_TIMEOUT_MS = 8000;

export async function checkPermission(): Promise<Permission> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") return "granted";
    // "Not yet asked" and "asked and refused" need different words on screen:
    // one is a button, the other is a trip to Settings.
    return status === "denied" && !canAskAgain ? "denied" : "undetermined";
  } catch {
    return "denied";
  }
}

/** Ask if we haven't already, then take one reading. */
export async function locate(): Promise<Fix | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
  } catch {
    return null;
  }

  const fresh = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  }).catch(() => null);

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));
  let position = await Promise.race([fresh, timeout]);

  if (!position) {
    // Out at sea a precise fix can be slow. A slightly old position a few
    // hundred metres out still tells a passenger the boat is coming.
    position = await Location.getLastKnownPositionAsync().catch(() => null);
  }
  if (!position) return null;

  return { lat: position.coords.latitude, lng: position.coords.longitude };
}
