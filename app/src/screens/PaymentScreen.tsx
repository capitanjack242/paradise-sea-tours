import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
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

      <Text style={s.note}>
        Fixed fares, agreed before you pay. Bahamas VAT is added on top and shown
        as its own line. Nothing is charged until a captain says yes.
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
