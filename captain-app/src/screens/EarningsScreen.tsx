import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Empty } from "../components/ui";
import { colors, radius } from "../lib/theme";
import {
  money,
  payWeek,
  splitFare,
  splitTrips,
  tripPct,
  tripsInWeek,
  type Boat,
  type Trip,
} from "../lib/data";

/* What he's owed, run by run. The same completed trips the office adds up on
   Friday, shown to the person being paid — so a query about a number is a
   pointed finger rather than a phone call. */

export default function EarningsScreen({
  trips,
  boat,
  refreshing,
  onRefresh,
}: {
  trips: Trip[];
  boat: Boat | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [offset, setOffset] = React.useState(0);
  const week = payWeek(offset);
  const rows = tripsInWeek(trips, offset);
  const split = splitTrips(rows, boat);

  // Each trip keeps the rate it closed out at, so a week can legitimately span
  // two rates. Name the rate only when there's one of it to name.
  const rates = [...new Set(rows.map((t) => tripPct(t, boat)))];
  const pct = rates.length === 1 ? rates[0] : 0;
  const mixedRates = rates.filter((r) => r > 0).length > 1;
  const anyCommission = split.commission > 0;

  // Paid is stamped per trip, so a week is settled only when every trip in it is.
  const settled = rows.length > 0 && rows.every((t) => t.paid_out_at);

  const dayMonth = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={s.weekBar}>
        <Pressable onPress={() => setOffset((o) => o - 1)} hitSlop={10} style={s.nav}>
          <Text style={s.navText}>‹</Text>
        </Pressable>
        <View style={s.weekLabel}>
          <Text style={s.weekRange}>
            {dayMonth(week.start)} — {dayMonth(week.lastDay)}
          </Text>
          <Text style={s.weekPay}>
            {offset === 0
              ? `Still running · paid ${dayMonth(week.payday)}`
              : settled
              ? `Paid ${dayMonth(week.payday)}`
              : `Due ${dayMonth(week.payday)}`}
          </Text>
        </View>
        <Pressable
          onPress={() => offset < 0 && setOffset((o) => o + 1)}
          hitSlop={10}
          style={[s.nav, offset >= 0 && s.navOff]}
          disabled={offset >= 0}
        >
          <Text style={s.navText}>›</Text>
        </Pressable>
      </View>

      {/* The three numbers a captain actually wants: what the trips came to,
          what Paradise keeps, and what lands in his hand on Friday. */}
      <View style={s.total}>
        <Text style={s.totalLab}>{offset === 0 ? "This week so far" : "That week"}</Text>
        <Text style={s.totalVal}>{money(split.net)}</Text>
        <Text style={s.totalSub}>is yours</Text>

        {anyCommission ? (
          <View style={s.breakdown}>
            <View style={s.brRow}>
              <Text style={s.brLab}>Fares (before VAT)</Text>
              <Text style={s.brVal}>{money(split.gross)}</Text>
            </View>
            <View style={s.brRow}>
              <Text style={s.brLab}>
                Paradise commission{pct > 0 ? ` (${pct}%)` : mixedRates ? " (rate changed)" : ""}
              </Text>
              <Text style={s.brVal}>−{money(split.commission)}</Text>
            </View>
            <View style={[s.brRow, s.brTotal]}>
              <Text style={s.brLabStrong}>You get</Text>
              <Text style={s.brValStrong}>{money(split.net)}</Text>
            </View>
          </View>
        ) : null}

        {settled ? <Text style={s.settled}>✓ Settled</Text> : null}
      </View>

      {rows.length === 0 ? (
        <Empty>No finished runs in this week.</Empty>
      ) : (
        <Card>
          {rows.map((t, i) => (
            <View key={t.id} style={[s.row, i === rows.length - 1 && s.rowLast]}>
              <View style={s.rowLeft}>
                <Text style={s.rowRoute} numberOfLines={1}>
                  {t.pickup ?? "—"} → {t.destination ?? "—"}
                </Text>
                <Text style={s.rowMeta}>
                  {t.scheduled_at
                    ? new Date(t.scheduled_at).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })
                    : "—"}{" "}
                  · {t.passengers ?? "?"} passengers
                  {t.paid_out_at ? " · paid" : ""}
                </Text>
              </View>
              <View style={s.rowRight}>
                <Text style={[s.rowMoney, t.paid_out_at && s.rowMoneyPaid]}>
                  {money(splitFare(t.quoted_price_cents ?? 0, tripPct(t, boat)).net)}
                </Text>
                {tripPct(t, boat) > 0 ? (
                  <Text style={s.rowGross}>of {money(t.quoted_price_cents)}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      )}

      <Text style={s.note}>
        {pct > 0
          ? `Paradise keeps ${pct}% of each fare. Everything above is after that, so it's what you're paid on Friday.`
          : mixedRates
          ? "Each run is shown after the rate it was finished at, so it's what you're paid on Friday."
          : "Every figure here is the fare for the run."}
        {"\n"}
        VAT is charged on top of the fare and goes to the government, so it never
        counts for or against what you're owed.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.foam },
  content: { padding: 14, paddingBottom: 40 },

  weekBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 8,
  },
  nav: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.foam,
  },
  navOff: { opacity: 0.3 },
  navText: { fontSize: 22, fontWeight: "800", color: colors.deep, lineHeight: 26 },
  weekLabel: { flex: 1, alignItems: "center" },
  weekRange: { fontSize: 15, fontWeight: "700", color: colors.ink },
  weekPay: { fontSize: 12, color: colors.muted, marginTop: 1 },

  total: {
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    padding: 18,
    marginTop: 12,
    marginBottom: 14,
  },
  totalLab: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.aqua,
  },
  totalVal: { fontSize: 34, fontWeight: "800", color: colors.white, marginTop: 3 },
  totalSub: { color: colors.aqua, fontSize: 13, fontWeight: "700", marginTop: -2 },
  settled: { color: colors.aqua, fontWeight: "700", marginTop: 10 },

  breakdown: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.18)",
    paddingTop: 10,
    gap: 6,
  },
  brRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  brLab: { color: "#a9c6d4", fontSize: 14 },
  brVal: { color: "#a9c6d4", fontSize: 14, fontWeight: "600" },
  brTotal: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.18)",
    paddingTop: 8,
    marginTop: 2,
  },
  brLabStrong: { color: colors.white, fontSize: 15, fontWeight: "800" },
  brValStrong: { color: colors.white, fontSize: 17, fontWeight: "800" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLeft: { flex: 1 },
  rowRoute: { fontSize: 14.5, fontWeight: "600", color: colors.ink },
  rowMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  rowGross: { fontSize: 11.5, color: colors.muted, marginTop: 1 },
  rowMoney: { fontSize: 16, fontWeight: "800", color: colors.ink },
  rowMoneyPaid: { color: colors.muted, fontWeight: "600" },

  note: { color: colors.muted, fontSize: 12.5, marginTop: 16, lineHeight: 18, textAlign: "center" },
});
