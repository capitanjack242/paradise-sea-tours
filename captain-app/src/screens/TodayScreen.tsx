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
  type BoatRating,
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
  rating,
  refreshing,
  busyTripId,
  onRefresh,
  onToggleAvailability,
  onAboard,
  onFinish,
  onOpenMessages,
  onAnswer,
  sharing,
}: {
  trips: Trip[];
  messages: Map<string, Message[]>;
  boat: Boat | null;
  /** What his passengers have scored him, or null until anyone has. */
  rating: BoatRating | null;
  refreshing: boolean;
  busyTripId: string | null;
  onRefresh: () => void;
  onToggleAvailability: () => void;
  onAboard: (t: Trip) => void;
  onFinish: (t: Trip) => void;
  onOpenMessages: (t: Trip) => void;
  onAnswer: (t: Trip, answer: "accepted" | "declined") => void;
  /** Whether the boat is reporting its position right now. */
  sharing: boolean;
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
              {boat.is_available ? (
                <Text style={[s.availSub, sharing ? s.trackingOn : s.trackingOff]}>
                  {sharing
                    ? "📍 The office can see where you are while this app is open"
                    : "📍 Position off — allow location so the office can see you"}
                </Text>
              ) : null}
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

      {/* His own score, with the number of trips it rests on. Absent entirely
          until someone has rated him — "no rating yet" is the truth, and a 0.0
          would be a lie about a captain who has simply not been rated. */}
      {rating && rating.captain_avg != null ? (
        <View style={s.rateStrip}>
          <Text style={s.rateStars}>{"★".repeat(Math.round(rating.captain_avg))}</Text>
          <Text style={s.rateVal}>{rating.captain_avg.toFixed(1)}</Text>
          <Text style={s.rateCount}>
            from {rating.rated_trips} rated {rating.rated_trips === 1 ? "trip" : "trips"}
            {rating.ride_avg != null ? ` · boat ${rating.ride_avg.toFixed(1)}` : ""}
          </Text>
        </View>
      ) : null}

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
  trackingOn: { color: colors.green, fontWeight: "700" },
  trackingOff: { color: colors.amber, fontWeight: "700" },
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

  rateStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rateStars: { fontSize: 16, color: "#f2b01e", letterSpacing: 1 },
  rateVal: { fontSize: 17, fontWeight: "800", color: colors.ink },
  rateCount: { flexShrink: 1, fontSize: 12.5, color: colors.muted },

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
