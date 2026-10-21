import { Platform } from "react-native";
import Constants from "expo-constants";

/* Meta (Facebook) app events: which ad brought each install, and whether it
   led to a boat being requested. Off entirely unless the build was made with a
   Meta app ID (see app.config.js), and never in the web build.

   On iPhone, Apple's "Allow … to track your activity" question comes first.
   The answer decides whether Meta may match this phone to a person (the
   advertising ID) or only count it in anonymous totals. Android asks nothing;
   the advertising ID follows the phone's own ad settings.

   Nothing here is allowed to get in the way of booking: every failure is
   swallowed, and the booking never waits on it. */

const enabled = Platform.OS !== "web" && !!Constants.expoConfig?.extra?.metaAppId;

let started: Promise<void> | null = null;

/** Ask (on iPhone), then start the SDK. Safe to call more than once. */
export function startAdMeasurement(): Promise<void> {
  if (!enabled) return Promise.resolve();
  started ??= (async () => {
    const { Settings } = require("react-native-fbsdk-next");
    let allowed = true;
    if (Platform.OS === "ios") {
      const { requestTrackingPermissionsAsync } = require("expo-tracking-transparency");
      allowed = (await requestTrackingPermissionsAsync()).granted;
      await Settings.setAdvertiserTrackingEnabled(allowed);
    }
    Settings.setAdvertiserIDCollectionEnabled(allowed);
    Settings.initializeSDK();
  })().catch(() => {});
  return started;
}

/** A boat was requested: the route and party size only, never who asked. */
export function logBoatRequested(trip: { pickup: string; destination: string; passengers: number }) {
  if (!enabled) return;
  startAdMeasurement()
    .then(() => {
      const { AppEventsLogger } = require("react-native-fbsdk-next");
      AppEventsLogger.logEvent("BoatRequested", {
        pickup: trip.pickup,
        destination: trip.destination,
        passengers: trip.passengers,
      });
    })
    .catch(() => {});
}
