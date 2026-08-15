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
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  React.useEffect(() => {
    fetchRoutes()
      .then(setRoutes)
      .catch((e) => console.warn("could not load routes:", e?.message ?? e))
      .finally(() => setLoading(false));
  }, []);

  const route = matchRoute(routes, pickup, destination);
  const fare = quoteCents(route, passengers, tripType);
  const perPerson = route?.price_cents ?? null;

  async function onSubmit() {
    if (pickup === destination) {
      Alert.alert("Pick two different docks", "Your pickup and destination are the same.");
      return;
    }
    if (!name.trim() || !phone.trim()) {
      Alert.alert("Almost there", "We need a name and a number so your captain can reach you.");
      return;
    }
    const scheduledAt = toDate(day, outTime);
    if (scheduledAt.getTime() <= Date.now()) {
      Alert.alert("Pick a later time", "That time has already passed today.");
      return;
    }
    const returnAt = tripType === "Round trip" ? toDate(day, backTime) : null;
    if (returnAt && returnAt <= scheduledAt) {
      Alert.alert("Check your return time", "The return has to be after you head out.");
      return;
    }

    setSubmitting(true);
    try {
      await createBooking({
        pickup,
        destination,
        scheduledAt,
        returnAt,
        passengers,
        tripType,
        contactName: name.trim(),
        contactPhone: phone.trim(),
      });
      Alert.alert(
        "Request sent",
        "We're confirming a captain now. You'll hear from us shortly — and you don't pay anything until a captain says yes."
      );
      setName("");
      setPhone("");
    } catch (e: any) {
      Alert.alert("Couldn't send that", e?.message ?? "Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
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

        <View>
          <Label>Your name</Label>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Sarah Mitchell"
            placeholderTextColor={colors.muted}
          />
        </View>
        <View>
          <Label>Mobile number</Label>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 242 555 0142"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Text style={s.hint}>
            Your confirmation goes here — include your country code.
          </Text>
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
          onPress={onSubmit}
          disabled={submitting}
        >
          <Text style={s.ctaText}>{submitting ? "Sending…" : "Request a boat"}</Text>
        </Pressable>
      </ScrollView>
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
  hint: { fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 15 },
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
