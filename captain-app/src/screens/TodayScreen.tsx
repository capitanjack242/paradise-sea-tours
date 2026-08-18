import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import TripCard from "../components/TripCard";
import { Card, Empty, Switch } from "../components/ui";
import { colors, radius } from "../lib/theme";
import {
  awaitingReply,
  money,
  payWeek,
  splitTrips,
  todaysTrips,
  tripsInWeek,
  upcomingTrips,
  type Boat,
  type Message,
  type Trip,
} from "../lib/data";

/* The morning screen. Availability first because it decides whether there's any
   work at all, then the money, then the next job — which is the only thing a
   captain actually needs at 7am. */

export default function TodayScreen({
  trips,
  messages,
  boat,
  refreshing,
  busyTripId,
  onRefresh,
  onToggleAvailability,
  onAboard,
  onFinish,
  onOpenMessages,
  onAnswer,
  sharingTripId,
  onToggleSharing,
}: {
  trips: Trip[];
  messages: Map<string, Message[]>;
  boat: Boat | null;
  refreshing: boolean;
  busyTripId: string | null;
  onRefresh: () => void;
  onToggleAvailability: () => void;
  onAboard: (t: Trip) => void;
  onFinish: (t: Trip) => void;
  onOpenMessages: (t: Trip) => void;
  onAnswer: (t: Trip, answer: "accepted" | "declined") => void;
  /** The one trip currently reporting where the boat is, if any. */
  sharingTripId: string | null;
  onToggleSharing: (t: Trip, on: boolean) => void;
}) {
  const today = todaysTrips(trips);
  const ahead = upcomingTrips(trips);
  const thisWeek = tripsInWeek(trips, 0);
  const { payday } = payWeek(0);
  // Same figure the Earnings tab leads with: what he's actually paid. Each trip
  // is split at the rate it was closed out at, not today's.
  const week = splitTrips(thisWeek, boat);

  const since = boat?.availability_changed_at
    ? new Date(boat.availability_changed_at).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {boat ? (
        <Card style={[s.availCard, boat.is_available && s.availOn]}>
          <View style={s.availRow}>
            <View style={s.availText}>
              <Text style={s.availTitle}>Available today</Text>
              <Text style={s.availSub}>
                {boat.is_available
                  ? `${boat.name}${since ? ` · on since ${since}` : ""} · off at 10pm`
                  : `${boat.name} · the office won't offer you runs`}
              </Text>
            </View>
            <Switch on={boat.is_available} onToggle={onToggleAvailability} />
          </View>
        </Card>
      ) : null}

      <View style={s.strip}>
        <View>
          <Text style={s.stripLab}>This week</Text>
          <Text style={s.stripVal}>{money(week.net)}</Text>
        </View>
        <View style={s.stripRight}>
          <Text style={s.stripLab}>Runs</Text>
          <Text style={s.stripVal}>{thisWeek.length}</Text>
        </View>
        <View style={s.stripRight}>
          <Text style={s.stripLab}>Paid</Text>
          <Text style={s.stripSmall}>
            {payday.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </Text>
        </View>
      </View>

      <Text style={s.heading}>Today</Text>
      {today.length === 0 ? (
        <Empty>Nothing on today. The office will send jobs here.</Empty>
      ) : (
        today.map((t) => (
          <TripCard
            key={t.id}
            trip={t}
            messages={messages.get(t.id) ?? []}
            waiting={awaitingReply(messages.get(t.id) ?? [])}
            busy={busyTripId === t.id}
            onAboard={() => onAboard(t)}
            onFinish={() => onFinish(t)}
            onOpenMessages={() => onOpenMessages(t)}
            onAnswer={(a) => onAnswer(t, a)}
            sharing={sharingTripId === t.id}
            onToggleSharing={(on) => onToggleSharing(t, on)}
          />
        ))
      )}

      {ahead.length > 0 ? (
        <>
          <Text style={s.heading}>Coming up</Text>
          {ahead.map((t) => (
            <TripCard
              key={t.id}
              trip={t}
              messages={messages.get(t.id) ?? []}
              waiting={awaitingReply(messages.get(t.id) ?? [])}
              busy={busyTripId === t.id}
              onAboard={() => onAboard(t)}
              onFinish={() => onFinish(t)}
              onOpenMessages={() => onOpenMessages(t)}
              onAnswer={(a) => onAnswer(t, a)}
              sharing={sharingTripId === t.id}
              onToggleSharing={(on) => onToggleSharing(t, on)}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.foam },
  content: { padding: 14, paddingBottom: 40 },

  availCard: { marginBottom: 12 },
  availOn: { borderColor: colors.green, borderWidth: 2 },
  availRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  availText: { flexShrink: 1 },
  availTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  availSub: { fontSize: 13, color: colors.muted, marginTop: 2 },

  strip: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 6,
  },
  stripRight: { alignItems: "flex-end" },
  stripLab: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.aqua,
  },
  stripVal: { fontSize: 20, fontWeight: "800", color: colors.white, marginTop: 2 },
  stripSmall: { fontSize: 14, fontWeight: "700", color: colors.white, marginTop: 5 },

  heading: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
    marginTop: 18,
    marginBottom: 8,
  },
});
