import React from "react";
import {
  ActivityIndicator,
  Alert,
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

export default function PaymentScreen({
  trip,
  loading,
  refreshing,
  onRefresh,
}: {
  trip: TripView | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  // A percentage of the fare is a suggestion, not a limit — someone who wants
  // to give $50 on a $60 trip shouldn't have to ask the office for permission.
  const [otherOpen, setOtherOpen] = React.useState(false);
  const [otherAmount, setOtherAmount] = React.useState("");
  const [otherBad, setOtherBad] = React.useState(false);
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

  /* Tips, offered the way Uber offers them: after the ride, once the fare is
     settled, and never as part of the bill. The buttons start a message to the
     office because no payment provider is connected yet — the same thing the
     Pay button does. Percentages are of the fare, not the fare plus tax. */
  const tip = trip.tip_cents ?? 0;
  const canTip = !!trip.paid_at && !!trip.captain && trip.can_reply;
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
              : `Nothing owed — the fare is settled. This is extra, and all of it goes to ${captain}.`}
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
