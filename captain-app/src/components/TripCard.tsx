import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BigButton, Card, Pill } from "./ui";
import { colors, radius } from "../lib/theme";
import { money, type Message, type Trip } from "../lib/data";

/* One job. At most one action is ever offered — whichever the trip is actually
   ready for — so there's nothing to read or choose between mid-run. */

const timeOf = (iso: string | null, withDay = false) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        ...(withDay ? { weekday: "short" as const } : {}),
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export default function TripCard({
  trip,
  messages,
  waiting,
  onAboard,
  onFinish,
  onOpenMessages,
  busy,
}: {
  trip: Trip;
  messages: Message[];
  waiting: number;
  onAboard: () => void;
  onFinish: () => void;
  onOpenMessages: () => void;
  busy?: boolean;
}) {
  // Two taps to finish a run. A phone in a wet pocket presses things by itself,
  // and a captain has no way to undo a trip marked done.
  const [confirming, setConfirming] = React.useState(false);

  const aboard = trip.status === "in_progress";
  const waitingOnOffice = !["confirmed", "in_progress"].includes(trip.status);

  return (
    <Card style={[s.card, aboard && s.cardAboard, busy && s.busy]}>
      <View style={s.head}>
        <Text style={s.when}>{timeOf(trip.scheduled_at, true)}</Text>
        {aboard ? <Pill tone="go">Aboard</Pill> : null}
      </View>

      <Text style={s.route}>
        {trip.pickup ?? "—"} <Text style={s.arrow}>→</Text> {trip.destination ?? "—"}
      </Text>
      <Text style={s.meta}>
        {trip.passengers ?? "?"} passengers · {trip.trip_type ?? ""} ·{" "}
        {money(trip.quoted_price_cents)}
      </Text>

      {/* The one fact that decides whether someone gets left on a beach. */}
      {trip.return_at ? (
        <View style={s.returnBox}>
          <Text style={s.returnText}>↩ Collect them again at {timeOf(trip.return_at, true)}</Text>
        </View>
      ) : trip.trip_type === "Round trip" ? (
        <View style={[s.returnBox, s.returnMissing]}>
          <Text style={[s.returnText, s.returnMissingText]}>
            ↩ Round trip with no return time — check with the office
          </Text>
        </View>
      ) : null}

      {trip.notes ? <Text style={s.notes}>{trip.notes}</Text> : null}

      <View style={s.paxRow}>
        <Text style={s.pax}>{trip.contact_name ?? "Passenger"}</Text>
        <Pressable
          onPress={onOpenMessages}
          style={({ pressed }) => [s.msgBtn, waiting > 0 && s.msgBtnWaiting, pressed && s.pressed]}
        >
          <Text style={[s.msgText, waiting > 0 && s.msgTextWaiting]}>
            {waiting > 0 ? `✉ ${waiting} new` : messages.length ? "✉ Messages" : "✉ Message"}
          </Text>
        </Pressable>
      </View>

      {waitingOnOffice ? (
        <View style={s.waitBox}>
          <Text style={s.waitText}>Not confirmed by the office yet</Text>
        </View>
      ) : aboard ? (
        confirming ? (
          <View>
            <Text style={s.confirmQ}>Everyone off the boat?</Text>
            <View style={s.confirmRow}>
              <View style={s.half}>
                <BigButton label="Not yet" tone="quiet" onPress={() => setConfirming(false)} />
              </View>
              <View style={s.half}>
                <BigButton label="Yes, finished" onPress={onFinish} disabled={busy} />
              </View>
            </View>
          </View>
        ) : (
          <View style={s.action}>
            <BigButton label="Passengers dropped off" onPress={() => setConfirming(true)} />
          </View>
        )
      ) : (
        <View style={s.action}>
          {/* One tap: pressing it a minute early costs nothing. */}
          <BigButton label="Passengers aboard" tone="deep" onPress={onAboard} disabled={busy} />
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: 12 },
  cardAboard: { borderColor: colors.teal, borderWidth: 2 },
  busy: { opacity: 0.55 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  when: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.teal,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  route: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 3, lineHeight: 24 },
  arrow: { color: colors.muted, fontWeight: "500" },
  meta: { fontSize: 14, color: colors.muted, marginTop: 3 },

  returnBox: { backgroundColor: "#e8f4fd", borderRadius: radius.sm, padding: 10, marginTop: 10 },
  returnMissing: { backgroundColor: colors.amberBg },
  returnText: { fontSize: 14, fontWeight: "700", color: colors.deep },
  returnMissingText: { color: colors.amber },

  notes: {
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.foam,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 10,
  },

  paxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 8,
  },
  pax: { fontSize: 15, fontWeight: "700", color: colors.ink, flexShrink: 1 },
  msgBtn: {
    backgroundColor: colors.deep,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  msgBtnWaiting: { backgroundColor: colors.amber },
  msgText: { color: colors.white, fontWeight: "700", fontSize: 14 },
  msgTextWaiting: { color: colors.white },
  pressed: { opacity: 0.85 },

  action: { marginTop: 12 },
  confirmQ: { fontSize: 15, fontWeight: "800", color: colors.ink, marginTop: 12, marginBottom: 8 },
  confirmRow: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },

  waitBox: {
    marginTop: 12,
    backgroundColor: colors.foam,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center",
  },
  waitText: { color: colors.muted, fontWeight: "600", fontSize: 14 },
});
