import React from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ThreadSheet from "./src/components/ThreadSheet";
import EarningsScreen from "./src/screens/EarningsScreen";
import SignInScreen from "./src/screens/SignInScreen";
import TodayScreen from "./src/screens/TodayScreen";
import { colors } from "./src/lib/theme";
import * as Notifications from "expo-notifications";
import { signOut, useSession } from "./src/lib/session";
import { registerForPush, unregisterPush } from "./src/lib/push";
import { supabase } from "./src/lib/supabase";
import {
  awaitingReply,
  fetchMessages,
  fetchMyBoat,
  answerOffer,
  fetchTrips,
  groupByBooking,
  sendMessage,
  setAvailability,
  setTripStatus,
  todaysTrips,
  type Boat,
  type Message,
  type Trip,
} from "./src/lib/data";

/* Two tabs and a sheet — no navigation library, because there is nowhere to
   navigate to. A captain opens this to see today's work and to close a run out. */

export default function App() {
  const { session, loading } = useSession();
  const [tab, setTab] = React.useState<"today" | "earnings">("today");

  const [trips, setTrips] = React.useState<Trip[]>([]);
  const [messages, setMessages] = React.useState<Map<string, Message[]>>(new Map());
  const [boat, setBoat] = React.useState<Boat | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busyTripId, setBusyTripId] = React.useState<string | null>(null);
  const [openTrip, setOpenTrip] = React.useState<Trip | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pushNote, setPushNote] = React.useState<string | null>(null);

  const userId = session?.user?.id ?? null;

  const load = React.useCallback(async () => {
    if (!userId) return;
    try {
      const [t, m, b] = await Promise.all([fetchTrips(), fetchMessages(), fetchMyBoat(userId)]);
      setTrips(t);
      setMessages(groupByBooking(m));
      setBoat(b);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the office. Check your signal.");
    }
  }, [userId]);

  React.useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  // Ask for push once signed in — at which point the reason for it is obvious,
  // rather than on first launch when it looks like any other app begging.
  React.useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    registerForPush(userId).then((r) => {
      if (cancelled || r.ok) return;
      // Silent for the ordinary cases: a simulator, or a captain who said no
      // and can turn it on in Settings. Only surface a broken setup.
      if (r.reason === "no-project-id" || r.reason === "failed") {
        setPushNote(r.detail ?? "Notifications couldn't be switched on.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Tapping a notification should land on the thing it was about.
  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { bookingId?: string };
      if (!data?.bookingId) return;
      load().then(() => {
        setTrips((current) => {
          const hit = current.find((t) => t.id === data.bookingId);
          if (hit) setOpenTrip(hit);
          return current;
        });
      });
    });
    return () => sub.remove();
  }, [load]);

  // A new job, or a passenger's reply, should arrive without anyone asking.
  React.useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("captain-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => load())
      .subscribe();
    const poll = setInterval(load, 60000); // in case the socket drops at sea
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [userId, load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function move(trip: Trip, status: "in_progress" | "completed") {
    setBusyTripId(trip.id);
    try {
      await setTripStatus(trip.id, status);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "That didn't save — check your signal and try again.");
    } finally {
      setBusyTripId(null);
    }
  }

  async function answer(trip: Trip, choice: "accepted" | "declined") {
    setBusyTripId(trip.id);
    try {
      await answerOffer(trip.id, choice, null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "That didn't save — check your signal and try again.");
    } finally {
      setBusyTripId(null);
    }
  }

  async function toggleAvailability() {
    if (!boat) return;
    const next = !boat.is_available;
    setBoat({ ...boat, is_available: next }); // answer the tap immediately
    try {
      await setAvailability(boat.id, next);
      await load();
    } catch {
      setBoat({ ...boat, is_available: !next }); // put it back if it didn't take
      setError("Couldn't save that — check your signal.");
    }
  }

  if (loading) {
    return (
      <View style={s.splash}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <StatusBar barStyle="dark-content" />
        <SignInScreen />
      </>
    );
  }

  const waitingTotal = todaysTrips(trips).reduce(
    (n, t) => n + awaitingReply(messages.get(t.id) ?? []),
    0
  );

  return (
    <SafeAreaView style={s.app}>
      <StatusBar barStyle="dark-content" />

      <View style={s.topbar}>
        <Text style={s.brand}>
          Paradise<Text style={s.brandAccent}>Sea Tours</Text>
        </Text>
        <Pressable
          onPress={async () => {
            if (userId) await unregisterPush(userId);
            await signOut();
          }}
          hitSlop={10}
        >
          <Text style={s.signout}>Sign out</Text>
        </Pressable>
      </View>

      {error ? (
        <Pressable onPress={() => setError(null)} style={s.errorBar}>
          <Text style={s.errorText}>{error}</Text>
        </Pressable>
      ) : null}

      {pushNote ? (
        <Pressable onPress={() => setPushNote(null)} style={s.noteBar}>
          <Text style={s.noteText}>{pushNote}</Text>
        </Pressable>
      ) : null}

      <View style={s.body}>
        {tab === "today" ? (
          <TodayScreen
            trips={trips}
            messages={messages}
            boat={boat}
            refreshing={refreshing}
            busyTripId={busyTripId}
            onRefresh={refresh}
            onToggleAvailability={toggleAvailability}
            onAboard={(t) => move(t, "in_progress")}
            onFinish={(t) => move(t, "completed")}
            onOpenMessages={setOpenTrip}
            onAnswer={answer}
          />
        ) : (
          <EarningsScreen trips={trips} refreshing={refreshing} onRefresh={refresh} />
        )}
      </View>

      <View style={s.tabbar}>
        <Tab
          label="Today"
          icon="⚓"
          on={tab === "today"}
          badge={waitingTotal}
          onPress={() => setTab("today")}
        />
        <Tab label="Earnings" icon="◲" on={tab === "earnings"} onPress={() => setTab("earnings")} />
      </View>

      <ThreadSheet
        trip={openTrip}
        messages={openTrip ? messages.get(openTrip.id) ?? [] : []}
        visible={openTrip !== null}
        onClose={() => setOpenTrip(null)}
        onSend={async (body) => {
          if (!openTrip) return;
          await sendMessage(openTrip.id, body);
          await load();
        }}
      />
    </SafeAreaView>
  );
}

function Tab({
  label,
  icon,
  on,
  badge = 0,
  onPress,
}: {
  label: string;
  icon: string;
  on: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={s.tab} hitSlop={6}>
      <View>
        <Text style={[s.tabIcon, on && s.tabOn]}>{icon}</Text>
        {badge > 0 ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[s.tabLabel, on && s.tabOn]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.foam, alignItems: "center", justifyContent: "center" },
  app: { flex: 1, backgroundColor: colors.foam },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  brand: { fontSize: 17, fontWeight: "800", color: colors.navy },
  brandAccent: { color: colors.teal },
  signout: { color: colors.muted, fontWeight: "700", fontSize: 14 },

  errorBar: { backgroundColor: "#fdecea", paddingVertical: 10, paddingHorizontal: 16 },
  errorText: { color: colors.danger, fontWeight: "600", fontSize: 13.5 },
  noteBar: { backgroundColor: colors.amberBg, paddingVertical: 10, paddingHorizontal: 16 },
  noteText: { color: colors.amber, fontWeight: "600", fontSize: 13 },

  body: { flex: 1 },

  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
    paddingTop: 8,
    paddingBottom: 10,
  },
  tab: { flex: 1, alignItems: "center", gap: 2 },
  tabIcon: { fontSize: 18, color: colors.muted },
  tabLabel: { fontSize: 11.5, fontWeight: "700", color: colors.muted },
  tabOn: { color: colors.teal },
  badge: {
    position: "absolute",
    top: -4,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "800" },
});
