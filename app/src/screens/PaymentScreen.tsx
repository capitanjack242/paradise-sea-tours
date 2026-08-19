import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius } from "../lib/theme";
import { formatMoney, vatLabel } from "../lib/bookings";
import type { TripView } from "../lib/trip";

/* What's owed, and what paying unlocks.

   The pay button is wired to a message for now; the payment link replaces its
   action when the provider is connected, and nothing else here changes. */

/** How long ago that fix was taken, in words a passenger reads at a glance. */
function positionAge(at: string | null): string {
  if (!at) return "just now";
  const secs = Math.max(Math.round((Date.now() - new Date(at).getTime()) / 1000), 0);
  return secs < 45 ? "just now" : `${Math.max(Math.round(secs / 60), 1)} min ago`;
}

/** Five taps, no half measures. Big targets — this is used one-handed. */
function Stars({
  value,
  onPick,
  label,
}: {
  value: number;
  onPick: (n: number) => void;
  label: string;
}) {
  return (
    <View style={s.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onPick(n)}
          hitSlop={6}
          accessibilityRole="radio"
          accessibilityState={{ selected: n === value }}
          accessibilityLabel={`${n} star${n > 1 ? "s" : ""} for ${label}`}
        >
          <Text style={[s.star, n <= value && s.starOn]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function PaymentScreen({
  trip,
  loading,
  refreshing,
  onRefresh,
  onRate,
}: {
  trip: TripView | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRate: (captain: number, ride: number, note: string | null) => Promise<void>;
}) {
  // A percentage of the fare is a suggestion, not a limit — someone who wants
  // to give $50 on a $60 trip shouldn't have to ask the office for permission.
  const [otherOpen, setOtherOpen] = React.useState(false);
  const [otherAmount, setOtherAmount] = React.useState("");
  const [otherBad, setOtherBad] = React.useState(false);

  /* How it went. Null means untouched, not zero — and what they have tapped
     beats whatever the last poll brought back, or a refresh mid-thought would
     undo it. */
  const [starsCaptain, setStarsCaptain] = React.useState<number | null>(null);
  const [starsRide, setStarsRide] = React.useState<number | null>(null);
  const [rateNote, setRateNote] = React.useState("");
  const [rateSending, setRateSending] = React.useState(false);
  const [rateErr, setRateErr] = React.useState<string | null>(null);

  // Seed from whatever they said last time, once, so "update your rating" opens
  // on their own answer rather than on an empty card.
  const ratedAt = trip?.rated_at ?? null;
  React.useEffect(() => {
    if (!ratedAt) return;
    setStarsCaptain((v) => v ?? trip?.rating_captain ?? null);
    setStarsRide((v) => v ?? trip?.rating_ride ?? null);
    setRateNote((v) => (v ? v : trip?.rating_note ?? ""));
  }, [ratedAt]);

  if (loading) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={s.centre}>
        <Text style={s.emptyTitle}>No trip to pay for</Text>
        <Text style={s.emptyBody}>
          Book a boat and the fare shows up here once we've confirmed a captain.
        </Text>
      </View>
    );
  }

  const paid = trip.amount_paid_cents ?? 0;
  // Owed is the total, tax and all. Paying the fare and leaving the tax is not
  // paying, and the captain stays out of reach until the balance is nil.
  const total = trip.total_cents ?? trip.fare_cents ?? 0;
  const due = trip.balance_cents ?? Math.max(total - paid, 0);
  // A trip taken before VAT applied shows no tax line rather than a $0 one.
  const vat = trip.vat_cents ?? 0;

  /* Tips, offered the way Uber offers them: after the ride is over, and never as
     part of the bill. Not when the fare is paid — that happens before boarding,
     and nobody tips a captain they haven't met. The database decides the window
     (`can_tip`); the buttons start a message to the office because no payment
     provider is connected yet, the same thing the Pay button does. Percentages
     are of the fare, not the fare plus tax. */
  const tip = trip.tip_cents ?? 0;
  const canTip = !!trip.can_tip && !!trip.captain;
  const captain = trip.captain ? `Capt. ${trip.captain}` : "your captain";
  const askForTip = (cents: number) =>
    Alert.alert(
      "Card payments aren't switched on yet",
      `Message the office and we'll add a ${formatMoney(cents)} tip for ${
        trip?.captain ? `Capt. ${trip.captain}` : "your captain"
      }. All of it goes to them.`
    );

  const submitOther = () => {
    const dollars = parseFloat(otherAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setOtherBad(true);
      return;
    }
    setOtherBad(false);
    setOtherOpen(false);
    setOtherAmount("");
    askForTip(Math.round(dollars * 100));
  };

  const tipOptions = [10, 15, 20]
    .map((pct) => ({
      pct,
      cents: Math.max(Math.round(((trip.fare_cents ?? 0) * pct) / 100 / 100) * 100, 100),
    }))
    // Two percentages of a small fare can round to the same dollar.
    .filter((o, i, all) => all.findIndex((x) => x.cents === o.cents) === i);
  const settled = !!trip.paid_at;
  const tooEarly = trip.status === "requested" || trip.status === "quoted";

  /* How it went, asked before the tip. Two scores, because a good captain can
     have a bad boat and dispatch has to be able to tell which it is looking at. */
  const canRate = !!trip.can_rate;
  const pickedCaptain = starsCaptain ?? trip.rating_captain ?? 0;
  const pickedRide = starsRide ?? trip.rating_ride ?? 0;
  const rateReady = pickedCaptain > 0 && pickedRide > 0 && !rateSending;
  const sendRating = async () => {
    if (!rateReady) return;
    setRateSending(true);
    setRateErr(null);
    try {
      await onRate(pickedCaptain, pickedRide, rateNote.trim() || null);
    } catch (e: any) {
      setRateErr(e?.message ?? "That didn't send. Try again in a moment.");
    } finally {
      setRateSending(false);
    }
  };

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={s.tripCard}>
        <Text style={s.route} numberOfLines={2}>
          {trip.pickup ?? "—"} → {trip.destination ?? "—"}
        </Text>
        <Text style={s.tripMeta}>
          {trip.scheduled_at
            ? new Date(trip.scheduled_at).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "Time to be confirmed"}
          {trip.passengers ? ` · ${trip.passengers} passengers` : ""}
        </Text>
        {trip.boat ? (
          <Text style={s.tripBoat}>
            {trip.boat}
            {trip.captain ? ` · Capt. ${trip.captain}` : ""}
          </Text>
        ) : null}

        {/* Only while the captain is sharing and the fix is recent. The age is
            on screen because "just now" and "three minutes ago" mean different
            things to someone watching a dock. */}
        {trip.boat_lat != null && trip.boat_lng != null ? (
          <Pressable
            style={({ pressed }) => [s.onway, pressed && s.onwayDown]}
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${trip.boat_lat},${trip.boat_lng}`
              )
            }
          >
            <Text style={s.onwayIcon}>🛥</Text>
            <View style={s.onwayText}>
              <Text style={s.onwayTitle}>{trip.boat ?? "Your boat"} is on the way</Text>
              <Text style={s.onwaySub}>
                Position updated {positionAge(trip.boat_located_at)} · Tap for the map
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      <View style={[s.card, settled && s.cardPaid]}>
        <Text style={s.cardTitle}>Payment</Text>

        <View style={s.line}>
          <Text style={s.lineLab}>Fare</Text>
          <Text style={s.lineVal}>{formatMoney(trip.fare_cents ?? null)}</Text>
        </View>

        {vat > 0 ? (
          <>
            <View style={s.line}>
              <Text style={s.lineLab}>VAT ({vatLabel(Number(trip.vat_pct ?? 10))}%)</Text>
              <Text style={s.lineVal}>{formatMoney(vat)}</Text>
            </View>
            <View style={[s.line, s.lineTotal]}>
              <Text style={s.totalLab}>Total</Text>
              <Text style={s.totalVal}>{formatMoney(total)}</Text>
            </View>
          </>
        ) : null}

        {paid > 0 ? (
          <View style={s.line}>
            <Text style={s.lineLab}>Paid</Text>
            <Text style={s.lineVal}>{formatMoney(paid)}</Text>
          </View>
        ) : null}

        {due > 0 ? (
          <View style={[s.line, s.lineDue]}>
            <Text style={s.dueLab}>Due</Text>
            <Text style={s.dueVal}>{formatMoney(due)}</Text>
          </View>
        ) : null}

        <Text style={[s.state, settled && s.statePaid]}>
          {settled
            ? "Paid in full. Your captain is reachable in Messages."
            : tooEarly
            ? "Nothing to pay yet — we're confirming a captain first."
            : "Payment opens up messaging with your captain."}
        </Text>

        {!settled && !tooEarly ? (
          <Pressable
            style={({ pressed }) => [s.payBtn, pressed && s.payBtnDown]}
            onPress={() =>
              Alert.alert(
                "Card payments aren't switched on yet",
                "Message the office and we'll take payment directly — cash on the dock or a transfer."
              )
            }
          >
            <Text style={s.payBtnText}>Pay {formatMoney(due)}</Text>
          </Pressable>
        ) : null}
      </View>

      {canRate ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>How was it?</Text>
          <Text style={s.rateNote}>
            {trip.rated_at
              ? "Thanks — you've rated this trip. Change it here if you like."
              : `How did ${captain} do, and how was the trip itself?`}
          </Text>

          {/* The name without the "Capt." — five stars and a title don't fit
              side by side on a phone, and the trip card above already says it. */}
          <View style={s.rateRow}>
            <Text style={s.rateLabel} numberOfLines={1}>
              {trip.captain ?? "Your captain"}
            </Text>
            <Stars value={pickedCaptain} onPick={setStarsCaptain} label={captain} />
          </View>
          <View style={s.rateRow}>
            <Text style={s.rateLabel} numberOfLines={1}>
              {trip.boat ?? "The trip"}
            </Text>
            <Stars value={pickedRide} onPick={setStarsRide} label="the trip" />
          </View>

          <TextInput
            style={s.rateComment}
            value={rateNote}
            onChangeText={setRateNote}
            placeholder="Anything you'd like to add? (optional)"
            placeholderTextColor={colors.muted}
            maxLength={1000}
            multiline
          />

          <Pressable
            style={[s.rateBtn, !rateReady && s.rateBtnOff]}
            disabled={!rateReady}
            onPress={sendRating}
          >
            <Text style={s.rateBtnText}>
              {rateSending ? "Sending…" : trip.rated_at ? "Update rating" : "Send rating"}
            </Text>
          </Pressable>
          {rateErr ? <Text style={s.rateErr}>{rateErr}</Text> : null}
        </View>
      ) : null}

      {tip > 0 || canTip ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Tip your captain</Text>

          {tip > 0 ? (
            <Text style={s.tipGiven}>
              {formatMoney(tip)} tip for {captain}
            </Text>
          ) : null}

          <Text style={s.tipNote}>
            {!canTip
              ? "Every cent of it goes to the captain."
              : tip > 0
              ? "Want to add more? Every cent goes to the captain."
              : `Hope the trip went well. Nothing is owed — this is extra, and all of it goes to ${captain}.`}
          </Text>

          {canTip ? (
            <>
              <View style={s.tipRow}>
                {tipOptions.map((o) => (
                  <Pressable
                    key={o.pct}
                    style={({ pressed }) => [s.tipBtn, pressed && s.tipBtnDown]}
                    onPress={() => askForTip(o.cents)}
                  >
                    <Text style={s.tipBtnAmount}>{formatMoney(o.cents)}</Text>
                    <Text style={s.tipBtnPct}>{o.pct}%</Text>
                  </Pressable>
                ))}
                <Pressable
                  style={({ pressed }) => [s.tipBtn, pressed && s.tipBtnDown]}
                  onPress={() => setOtherOpen((v) => !v)}
                >
                  <Text style={s.tipBtnOther}>Other</Text>
                  <Text style={s.tipBtnPct}>any amount</Text>
                </Pressable>
              </View>

              {otherOpen ? (
                <View>
                  <View style={s.otherRow}>
                    <Text style={s.otherCurrency}>$</Text>
                    <TextInput
                      style={[s.otherInput, otherBad && s.otherInputBad]}
                      value={otherAmount}
                      onChangeText={(v) => {
                        setOtherAmount(v);
                        setOtherBad(false);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.muted}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={submitOther}
                    />
                    <Pressable
                      style={({ pressed }) => [s.otherGo, pressed && s.otherGoDown]}
                      onPress={submitOther}
                    >
                      <Text style={s.otherGoText}>Add</Text>
                    </Pressable>
                  </View>
                  {otherBad ? (
                    <Text style={s.otherErr}>Enter an amount above zero.</Text>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      <Text style={s.note}>
        Fixed fares, agreed before you pay. Bahamas VAT is added on top and shown
        as its own line. Tips are extra and go to your captain in full.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.foam },
  content: { padding: 16, paddingBottom: 40 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 },

  tripCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
  },
  route: { fontSize: 17, fontWeight: "700", color: colors.ink, lineHeight: 23 },
  tripMeta: { fontSize: 13, color: colors.muted, marginTop: 3 },
  tripBoat: { fontSize: 13.5, fontWeight: "600", color: colors.deep, marginTop: 6 },

  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
    marginTop: 12,
  },
  cardPaid: { backgroundColor: colors.greenBg, borderColor: "#bfe9d6" },
  cardTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 10,
  },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingVertical: 3 },
  lineLab: { fontSize: 15, color: colors.muted },
  lineVal: { fontSize: 15, fontWeight: "700", color: colors.ink },
  // Fare and tax add up to the total, so the rule sits above it.
  lineTotal: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 5, paddingTop: 6 },
  totalLab: { fontSize: 15, fontWeight: "700", color: colors.ink },
  totalVal: { fontSize: 16, fontWeight: "800", color: colors.ink },
  lineDue: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
    paddingTop: 9,
  },
  dueLab: { fontSize: 16, fontWeight: "700", color: colors.ink },
  dueVal: { fontSize: 22, fontWeight: "800", color: colors.ink },

  onway: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: "#e9f6fb",
    borderWidth: 1,
    borderColor: "#b9e2f0",
  },
  onwayDown: { backgroundColor: "#dcf0f8" },
  onwayIcon: { fontSize: 22 },
  onwayText: { flex: 1 },
  onwayTitle: { fontSize: 15, fontWeight: "800", color: colors.deep },
  onwaySub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },

  rateNote: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginBottom: 6 },
  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 4,
  },
  rateLabel: { flexShrink: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  stars: { flexDirection: "row", gap: 2 },
  star: { fontSize: 27, lineHeight: 32, color: "#d8e0e6", paddingHorizontal: 2 },
  starOn: { color: "#f2b01e" },
  rateComment: {
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 15,
    color: colors.ink,
    minHeight: 60,
    textAlignVertical: "top",
  },
  rateBtn: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: radius.md,
    backgroundColor: colors.deep,
  },
  rateBtnOff: { backgroundColor: "#c8d5dd" },
  rateBtnText: { fontSize: 16, fontWeight: "800", color: colors.white },
  rateErr: { marginTop: 7, fontSize: 13, fontWeight: "600", color: colors.danger },

  tipGiven: { fontSize: 17, fontWeight: "800", color: colors.green, marginBottom: 3 },
  tipNote: { fontSize: 13.5, color: colors.muted, lineHeight: 19 },
  tipRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  tipBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.green,
    backgroundColor: colors.white,
  },
  tipBtnDown: { backgroundColor: colors.greenBg },
  tipBtnAmount: { fontSize: 17, fontWeight: "800", color: colors.green },
  tipBtnOther: { fontSize: 15, fontWeight: "800", color: colors.green },
  otherRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  otherCurrency: { fontSize: 18, fontWeight: "800", color: colors.green },
  otherInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  otherInputBad: { borderColor: "#c0392b" },
  otherGo: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.green,
  },
  otherGoDown: { opacity: 0.85 },
  otherGoText: { color: colors.white, fontWeight: "800", fontSize: 15 },
  otherErr: { marginTop: 6, fontSize: 12.5, fontWeight: "600", color: "#c0392b" },
  tipBtnPct: { fontSize: 11, fontWeight: "600", color: colors.green, opacity: 0.75 },

  state: { marginTop: 12, fontSize: 14, fontWeight: "700", color: colors.deep, lineHeight: 19 },
  statePaid: { color: colors.green },
  payBtn: {
    marginTop: 14,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.teal,
  },
  payBtnDown: { opacity: 0.85 },
  payBtnText: { color: colors.white, fontSize: 17, fontWeight: "800" },

  note: { marginTop: 16, fontSize: 12.5, color: colors.muted, textAlign: "center", lineHeight: 18 },
});
