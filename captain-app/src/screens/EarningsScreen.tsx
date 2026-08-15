import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Empty } from "../components/ui";
import { colors, radius } from "../lib/theme";
import { money, payWeek, sumCents, tripsInWeek, type Trip } from "../lib/data";

/* What he's owed, run by run. The same completed trips the office adds up on
   Friday, shown to the person being paid — so a query about a number is a
   pointed finger rather than a phone call. */

export default function EarningsScreen({
  trips,
  refreshing,
  onRefresh,
}: {
  trips: Trip[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [offset, setOffset] = React.useState(0);
  const week = payWeek(offset);
  const rows = tripsInWeek(trips, offset);
  const total = sumCents(rows);

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

      <View style={s.total}>
        <Text style={s.totalLab}>{offset === 0 ? "This week so far" : "That week"}</Text>
        <Text style={s.totalVal}>{money(total)}</Text>
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
              <Text style={[s.rowMoney, t.paid_out_at && s.rowMoneyPaid]}>
                {money(t.quoted_price_cents)}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Text style={s.note}>
        Every figure here is the full fare the passenger paid, not a share of it.
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
  settled: { color: colors.aqua, fontWeight: "700", marginTop: 4 },

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
  rowMoney: { fontSize: 16, fontWeight: "800", color: colors.ink },
  rowMoneyPaid: { color: colors.muted, fontWeight: "600" },

  note: { color: colors.muted, fontSize: 12.5, marginTop: 16, lineHeight: 18, textAlign: "center" },
});
