import { Linking, Platform } from "react-native";

/* Hand the pin to whatever the captain already navigates with. We don't draw a
   map — a chart plotter and local knowledge beat anything we'd put on a phone
   screen, and this only has to answer "which end of the dock". */

export function mapsUrl(lat: number, lng: number, label: string): string {
  const at = `${lat},${lng}`;
  const name = encodeURIComponent(label);
  if (Platform.OS === "ios") return `maps://?ll=${at}&q=${name}`;
  if (Platform.OS === "android") return `geo:${at}?q=${at}(${name})`;
  return webMapsUrl(lat, lng);
}

/** Works anywhere, including a browser — the fallback when no app answers. */
export function webMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Open the pin. If no maps app takes the scheme — which happens on a stripped
 * phone or in a simulator — fall through to the browser rather than doing
 * nothing at all while he's standing on a wet deck wondering.
 */
export async function openMap(lat: number, lng: number, label: string): Promise<void> {
  const url = mapsUrl(lat, lng, label);
  try {
    await Linking.openURL(url);
  } catch {
    try {
      await Linking.openURL(webMapsUrl(lat, lng));
    } catch {
      // Nothing more to try; the card still shows the trip.
    }
  }
}
