import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PickerField, Segmented, Stepper, Label } from "../components/ui";
import SignInSheet from "../components/SignInSheet";
import { fetchProfileName, prettyPhone, useSession } from "../lib/auth";
import {
  createBooking,
  fetchRoutes,
  fetchVatPct,
  formatMoney,
  LOCATIONS,
  matchRoute,
  quoteCents,
  VAT_FALLBACK_PCT,
  vatLabel,
  withVat,
  type Service,
  type TripType,
} from "../lib/bookings";
import { checkPermission, locate, type Fix } from "../lib/location";
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
  const [vatPct, setVatPct] = React.useState(VAT_FALLBACK_PCT);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const [pickup, setPickup] = React.useState<string>("Nassau Cruise Port");
  const [destination, setDestination] = React.useState<string>("Paradise Island & Atlantis");
  const [tripType, setTripType] = React.useState<TripType>("One way");
  const [day, setDay] = React.useState<string>("Today");
  const [outTime, setOutTime] = React.useState<string>("10:30 AM");
  const [backTime, setBackTime] = React.useState<string>("4:00 PM");
  const [passengers, setPassengers] = React.useState(2);
  const [notes, setNotes] = React.useState("");
  const { session } = useSession();
  const [profileName, setProfileName] = React.useState<string | null>(null);
  const [showSignIn, setShowSignIn] = React.useState(false);

  // Sharing where you're standing. Off unless the passenger turns it on, and
  // "blocked" is its own state because that one can only be undone in Settings.
  const [fix, setFix] = React.useState<Fix | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [locBlocked, setLocBlocked] = React.useState(false);
  const [optedOut, setOptedOut] = React.useState(false);

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

  // The tax rate comes from the database, not the build, so a change to it
  // doesn't wait on two app store reviews. A failed read keeps the fallback
  // rather than quoting a price with no tax on it.
  React.useEffect(() => {
    fetchVatPct()
      .then(setVatPct)
      .catch((e) => console.warn("could not load the VAT rate:", e?.message ?? e));
  }, []);

  // Reading the existing permission asks nobody anything — it just stops us
  // offering a button that can't work.
  React.useEffect(() => {
    checkPermission().then((p) => setLocBlocked(p === "denied"));
  }, []);

  /** Turn sharing on (prompting if needed), or turn it back off. */
  async function toggleLocation() {
    if (fix) {
      setFix(null);
      setOptedOut(true);
      return;
    }
    setOptedOut(false);
    setLocating(true);
    const got = await locate();
    setLocating(false);
    setFix(got);
    if (!got) setLocBlocked((await checkPermission()) === "denied");
  }

  const route = matchRoute(routes, pickup, destination);
  const fare = quoteCents(route, passengers, tripType);
  const { vat, total } = withVat(fare, vatPct);
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
      // Take the reading now rather than trusting one from when the screen
      // opened — they may have walked half the wharf since. If they never
      // touched the row we ask once here, which is the moment it makes sense;
      // if they turned it off or refused the phone, we don't pester them.
      let where = fix;
      if (!optedOut && !locBlocked) {
        where = (await locate()) ?? fix;
        setFix(where);
      }

      await createBooking({
        pickup,
        destination,
        scheduledAt: when.scheduledAt,
        returnAt: when.returnAt,
        passengers,
        tripType,
        contactName,
        contactPhone,
        notes: notes.trim() || undefined,
        location: where,
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
          Paradise<Text style={s.brandAccent}>Sea Express</Text>
        </Text>
        <Text style={s.topRight}>Nassau</Text>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <PickerField label="Pick you up at" value={pickup} options={LOCATIONS} onChange={setPickup} />
        <PickerField label="Going to" value={destination} options={LOCATIONS} onChange={setDestination} />

        <Segmented<TripType>
          value={tripType}
          options={["One way", "Round trip", "Private charter (whole boat)"]}
          labels={{ "Private charter (whole boat)": "Charter" }}
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

        <View>
          <Label>Anything else?</Label>
          <TextInput
            style={[s.input, s.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Coolers, bags, special stops, cruise ship name…"
            placeholderTextColor={colors.muted}
            multiline
          />
        </View>

        {/* The dock is the plan; this is where they're actually standing.
            Worth its own row so nobody is surprised by the permission box. */}
        <Pressable
          style={[s.loc, fix && s.locOn]}
          onPress={toggleLocation}
          disabled={locating || locBlocked}
        >
          <Text style={s.locIcon}>{fix ? "✓" : "📍"}</Text>
          <View style={s.locText}>
            <Text style={[s.locTitle, fix && s.locTitleOn]}>
              {locating
                ? "Finding you…"
                : fix
                ? "Your captain will see where you're waiting"
                : locBlocked
                ? "Location is off for this app"
                : "Share where you're waiting"}
            </Text>
            <Text style={s.locSub}>
              {locBlocked
                ? "Turn it on in Settings if you'd like your captain to find you faster."
                : fix
                ? "Only while you're booking, and only until the trip is done. Tap to stop."
                : "Helps your captain find you on a long dock. Optional."}
            </Text>
          </View>
          {locating && <ActivityIndicator color={colors.teal} />}
        </Pressable>

        <View style={s.fare}>
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <View style={s.fareRow}>
                <Text style={s.fareTotal}>{formatMoney(total)}</Text>
                {perPerson != null && (
                  <Text style={s.fareMath}>
                    {passengers} × {formatMoney(perPerson)}
                    {tripType === "Round trip" ? " × 2 legs" : ""}
                  </Text>
                )}
              </View>
              {total != null && (
                <View style={s.fareSplit}>
                  <Text style={s.fareSplitItem}>Fare {formatMoney(fare)}</Text>
                  <Text style={s.fareSplitItem}>
                    VAT ({vatLabel(vatPct)}%) {formatMoney(vat)}
                  </Text>
                </View>
              )}
              <Text style={s.fareNote}>
                {total != null
                  ? "Fixed price, VAT included. Nothing charged until a captain says yes."
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
          total != null ? ` · ${formatMoney(total)} incl. VAT` : ""
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
  loc: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.foam,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  locOn: { borderColor: colors.green, backgroundColor: colors.greenBg },
  locIcon: { fontSize: 16 },
  locText: { flex: 1 },
  locTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  locTitleOn: { color: colors.green },
  locSub: { fontSize: 11.5, color: colors.muted, marginTop: 1, lineHeight: 15 },
  notesInput: { minHeight: 58, textAlignVertical: "top", fontWeight: "500" },
  fare: { borderRadius: radius.md, padding: 14, backgroundColor: colors.deep, marginTop: 4 },
  fareRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  fareTotal: { fontSize: 26, fontWeight: "800", color: colors.white },
  fareMath: { fontSize: 12, color: colors.aqua },
  fareNote: { fontSize: 11, color: colors.aqua, marginTop: 5 },
  // The tax, broken out under the total. Quiet, but never hidden.
  fareSplit: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 7,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.22)",
  },
  fareSplitItem: { fontSize: 11.5, color: colors.white, opacity: 0.95 },
  cta: {
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: colors.teal,
  },
  ctaOff: { opacity: 0.6 },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800" },
});
