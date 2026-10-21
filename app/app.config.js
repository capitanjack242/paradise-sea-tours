// The app's settings live in app.json; this adds the parts that depend on the
// build's environment.
//
// Meta (Facebook) SDK: tells Meta when the app is installed and opened, and
// when a boat is requested, so each ad can be judged by the installs and
// bookings it brings. Switched on only when the Meta app's ID and client token
// are set for the build (`eas env:create --name META_APP_ID …`, likewise
// META_CLIENT_TOKEN; both from developers.facebook.com → the app → Settings),
// so the app keeps building before the Meta account exists.

// Apple shows this under "Allow Paradise Sea Express to track your activity…".
const TRACKING_REASON =
  "Lets us see which of our ads brought you here, so we stop paying for the ones that don't work. We never sell your information.";

module.exports = ({ config }) => {
  const appID = process.env.META_APP_ID;
  const clientToken = process.env.META_CLIENT_TOKEN;
  if (!appID || !clientToken) return config;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        "react-native-fbsdk-next",
        {
          appID,
          clientToken,
          displayName: config.name,
          scheme: `fb${appID}`,
          // Started by the app (src/lib/ads.ts), after Apple's question on iPhone.
          isAutoInitEnabled: false,
          autoLogAppEventsEnabled: true,
          // Switched on at runtime only where the person allows it.
          advertiserIDCollectionEnabled: false,
          iosUserTrackingPermission: TRACKING_REASON,
        },
      ],
      ["expo-tracking-transparency", { userTrackingPermission: TRACKING_REASON }],
    ],
    extra: { ...config.extra, metaAppId: appID },
  };
};
