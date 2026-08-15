import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

/* Push notifications — the reason this is a native app at all.

   A captain shouldn't have to remember to open anything. Work arrives, and his
   phone tells him.

   Two things worth knowing before debugging this:

   1. A push token needs an EAS project id. It comes from an Expo account and
      `eas init`, and without one the token request fails with a message that
      doesn't say so. We check for it and say so plainly instead.
   2. Expo Go can't receive remote push any more. Testing this needs a
      development build (`npx expo run:ios` / `run:android`, or an EAS build).
      In Expo Go, registration will fail and the app carries on without it —
      which is the right behaviour anyway: no captain should lose a run
      because notifications wouldn't turn on. */

export type PushResult =
  | { ok: true; token: string }
  | { ok: false; reason: "no-device" | "denied" | "no-project-id" | "failed"; detail?: string };

// A run arriving matters more than not interrupting.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function projectId(): string | null {
  const c: any = Constants;
  return (
    c?.expoConfig?.extra?.eas?.projectId ??
    c?.easConfig?.projectId ??
    null
  );
}

/**
 * Ask for permission, get a token, and store it against the signed-in captain.
 * Safe to call on every sign-in — the row is keyed on (user, token).
 */
export async function registerForPush(userId: string): Promise<PushResult> {
  if (!Device.isDevice) {
    // Simulators never receive remote push, so there's nothing to store.
    return { ok: false, reason: "no-device" };
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted;
  }
  if (!granted) return { ok: false, reason: "denied" };

  const id = projectId();
  if (!id) {
    return {
      ok: false,
      reason: "no-project-id",
      detail:
        "This build has no EAS project id, so Expo can't issue a push token. Run `eas init` in captain-app.",
    };
  }

  try {
    if (Platform.OS === "android") {
      // Android needs a channel before anything will show.
      await Notifications.setNotificationChannelAsync("runs", {
        name: "Runs and messages",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });

    const { error } = await supabase
      .from("push_tokens")
      .upsert(
        { user_id: userId, token, platform: Platform.OS },
        { onConflict: "user_id,token" }
      );
    if (error) return { ok: false, reason: "failed", detail: error.message };

    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: "failed", detail: e?.message };
  }
}

/** Drop this device's token on sign-out, so a shared phone stops getting someone else's runs. */
export async function unregisterPush(userId: string): Promise<void> {
  const id = projectId();
  if (!id || !Device.isDevice) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
  } catch {
    // Signing out matters more than tidying up a token.
  }
}
