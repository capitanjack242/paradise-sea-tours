import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PickerField, Segmented, Stepper } from "../components/ui";
import SignInSheet from "../components/SignInSheet";
import { fetchProfileName, prettyPhone, useSession } from "../lib/auth";
import {
  createBooking,
  fetchRoutes,
  formatMoney,
  LOCATIONS,
  matchRoute,
  quoteCents,
  type Service,
  type TripType,
} from "../lib/bookings";
import { colors, radius } from "../lib/theme";

const TIMES = [
  "8:00 AM", "8:30 AM", "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
  "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM",
  "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
  "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM", "7:00 PM",
] as const;

const DAYS = ["Today", "Tomorrow"] as const;

/** Turn "Today" + "10:30 AM" into a real Date. */
function toDate(day: string, time: string): Date {
  const d = new Date();
  if (day === "Tomorrow") d.setDate(d.getDate() + 1);
  const m = time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === "PM") h += 12;
    d.setHours(h, Number(m[2]), 0, 0);
  }
  return d;
}

export default function BookScreen() {
  const [routes, setRoutes] = React.useState<Service[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const [pickup, setPickup] = React.useState<string>("Nassau Cruise Port");
  const [destination, setDestination] = React.useState<string>("Rose Island & Cays");
  const [tripType, setTripType] = React.useState<TripType>("Round trip");
  const [day, setDay] = React.useState<string>("Today");
  const [outTime, setOutTime] = React.useState<string>("10:30 AM");
  const [backTime, setBackTime] = React.useState<string>("4:00 PM");
  const [passengers, setPassengers] = React.useState(2);
  const { session } = useSession();
  const [profileName, setProfileName] = React.useState<string | null>(null);
  const [showSignIn, setShowSignIn] = React.useState(false);

  const signedIn = !!session;
  const myPhone = session?.user?.phone ? `+${session.user.phone}` : "";

  React.useEffect(() => {
    if (signedIn) fetchProfileName().then(setProfileName).catch(() => {});
  }, [signedIn]);

  React.useEffect(() => {
    fetchRoutes()
      .then(setRoutes)
      .catch((e) => console.warn("could not load routes:", e?.message ?? e))
      .finally(() => setLoading(false));
  }, []);

  const route = matchRoute(routes, pickup, destination);
  const fare = quoteCents(route, passengers, tripType);
  const perPerson = route?.price_cents ?? null;

  /** Everything about the trip except who's taking it — checked before sign-in. */
  function validateTrip(): { scheduledAt: Date; returnAt: Date | null } | null {
    if (pickup === destination) {
      Alert.alert("Pick two different docks", "Your pickup and destination are the same.");
      return null;
    }
    const scheduledAt = toDate(day, outTime);
    if (scheduledAt.getTime() <= Date.now()) {
      Alert.alert("Pick a later time", "That time has already passed today.");
      return null;
    }
    const returnAt = tripType === "Round trip" ? toDate(day, backTime) : null;
    if (returnAt && returnAt <= scheduledAt) {
      Alert.alert("Check your return time", "The return has to be after you head out.");
      return null;
    }
    return { scheduledAt, returnAt };
  }

  async function submitTrip(contactName: string, contactPhone: string) {
    const when = validateTrip();
    if (!when) return;

    setSubmitting(true);
    try {
      await createBooking({
        pickup,
        destination,
        scheduledAt: when.scheduledAt,
        returnAt: when.returnAt,
        passengers,
        tripType,
        contactName,
        contactPhone,
      });
      Alert.alert(
        "Request sent",
        "We're confirming a captain now. You'll hear from us shortly — and you don't pay anything until a captain says yes."
      );
    } catch (e: any) {
      Alert.alert("Couldn't send that", e?.message ?? "Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Sign-in is deferred to here rather than the front door: validate the trip
   * first, then ask who they are only if we don't already know.
   */
  function onRequest() {
    if (!validateTrip()) return;
    if (!signedIn) {
      setShowSignIn(true);
      return;
    }
    submitTrip(profileName ?? "Guest", myPhone);
  }

  return (
    <View style={s.root}>
      <View style={s.topbar}>
        <Text style={s.brand}>
          Paradise<Text style={s.brandAccent}>Sea Tours</Text>
        </Text>
        <Text style={s.topRight}>Nassau</Text>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <PickerField label="Pick you up at" value={pickup} options={LOCATIONS} onChange={setPickup} />
        <PickerField label="Going to" value={destination} options={LOCATIONS} onChange={setDestination} />

        <Segmented<TripType>
          value={tripType}
          options={["One way", "Round trip"]}
          onChange={setTripType}
        />

        <View style={s.row}>
          <View style={s.col}>
            <PickerField label="Day" value={day} options={DAYS} onChange={setDay} />
          </View>
          <View style={s.col}>
            <Stepper label="People" value={passengers} onChange={setPassengers} />
          </View>
        </View>

        <View style={s.row}>
          <View style={s.col}>
            <PickerField label="Go out" value={outTime} options={TIMES} onChange={setOutTime} />
          </View>
          {tripType === "Round trip" && (
            <View style={s.col}>
              <PickerField label="Come back" value={backTime} options={TIMES} onChange={setBackTime} />
            </View>
          )}
        </View>

        <View style={s.fare}>
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <View style={s.fareRow}>
                <Text style={s.fareTotal}>{formatMoney(fare)}</Text>
                {perPerson != null && (
                  <Text style={s.fareMath}>
                    {passengers} × {formatMoney(perPerson)}
                    {tripType === "Round trip" ? " × 2 legs" : ""}
                  </Text>
                )}
              </View>
              <Text style={s.fareNote}>
                {fare != null
                  ? "Fixed price. Nothing charged until a captain says yes."
                  : "We'll quote this route and confirm before you pay anything."}
              </Text>
            </>
          )}
        </View>

        <Pressable
          style={[s.cta, submitting && s.ctaOff]}
          onPress={onRequest}
          disabled={submitting}
        >
          <Text style={s.ctaText}>{submitting ? "Sending…" : "Request a boat"}</Text>
        </Pressable>

        {signedIn && (
          <Text style={s.signedIn}>
            Booking as {profileName ?? "you"} · {prettyPhone(myPhone)}
          </Text>
        )}
      </ScrollView>

      <SignInSheet
        visible={showSignIn}
        holdingText={`${pickup} → ${destination}, ${day.toLowerCase()} ${outTime}${
          fare != null ? ` · ${formatMoney(fare)}` : ""
        }`}
        onCancel={() => setShowSignIn(false)}
        onSignedIn={(newName, newPhone) => {
          setShowSignIn(false);
          setProfileName(newName);
          submitTrip(newName, newPhone);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brand: { fontSize: 16, fontWeight: "800", color: colors.navy },
  brandAccent: { color: colors.teal },
  topRight: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
  },
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  row: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.foam,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  signedIn: { fontSize: 11, color: colors.muted, textAlign: "center", marginTop: 2 },
  fare: { borderRadius: radius.md, padding: 14, backgroundColor: colors.deep, marginTop: 4 },
  fareRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  fareTotal: { fontSize: 26, fontWeight: "800", color: colors.white },
  fareMath: { fontSize: 12, color: colors.aqua },
  fareNote: { fontSize: 11, color: colors.aqua, marginTop: 5 },
  cta: {
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: colors.teal,
  },
  ctaOff: { opacity: 0.6 },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800" },
});
