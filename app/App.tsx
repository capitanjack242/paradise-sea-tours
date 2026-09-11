import React from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import BookScreen from "./src/screens/BookScreen";
import PaymentScreen from "./src/screens/PaymentScreen";
import MessagesScreen, { type Channel } from "./src/screens/MessagesScreen";
import { fetchTrip, rateTrip, sendTripMessage, type TripMessage, type TripView } from "./src/lib/trip";
import { colors, radius } from "./src/lib/theme";

/* Three tabs: ask for a boat, settle up for it, and talk to whoever is running
   it. The third was missing — the Payment screen promised a captain "reachable
   in Messages" and there was nowhere to reach him. */

const TRIP_TOKEN_KEY = "paradise.trip.token";
type Tab = "book" | "pay" | "messages";

/** Replies that have arrived since the passenger last wrote — the badge. */
function awaitingMe(messages: TripMessage[] | undefined): number {
  const list = messages ?? [];
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].sender === "customer") break;
    n++;
  }
  return n;
}

export default function App() {
  const [tab, setTab] = React.useState<Tab>("book");
  const [trip, setTrip] = React.useState<TripView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  // Which side of the conversation is showing, and what's typed but not sent.
  // Lifted here so Pay and the tip buttons can open Messages with a line ready.
  const [channel, setChannel] = React.useState<Channel>("office");
  const [draft, setDraft] = React.useState("");

  const load = React.useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const token = await AsyncStorage.getItem(TRIP_TOKEN_KEY);
      if (!token) {
        setTrip(null);
        return;
      }
      const next = await fetchTrip(token);
      // Only a real "no such trip" clears the screen. A request that failed —
      // one bar of signal on a dock — keeps whatever was already showing.
      if (next !== null) setTrip(next);
      else setTrip(null);
    } catch (e: any) {
      console.warn("could not load the trip:", e?.message ?? e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // The trip page reads through a function, not a table, so realtime can't
  // reach it. While a trip is on screen, ask again every fifteen seconds so a
  // reply appears without anyone pulling to refresh.
  React.useEffect(() => {
    if (tab === "book") return;
    const timer = setInterval(() => load(false), 15000);
    return () => clearInterval(timer);
  }, [tab, load]);

  function openMessages(text?: string, on: Channel = "office") {
    setChannel(on);
    if (text != null) setDraft(text);
    setTab("messages");
    load(false);
  }

  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await AsyncStorage.getItem(TRIP_TOKEN_KEY);
    if (!token) throw new Error("We've lost the link to that trip.");
    return fn(token);
  }

  const waiting = trip ? awaitingMe(trip.messages) : 0;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />

      <View style={s.body}>
        {tab === "book" ? (
          /* A booking hands back the key to the trip, so pick it up straight
             away — otherwise the Payment tab sits empty until the next launch. */
          <BookScreen
            onBooked={() => {
              load(false);
            }}
          />
        ) : tab === "pay" ? (
          <PaymentScreen
            trip={trip}
            loading={loading}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(false);
            }}
            /* The token lives here, not on the screen — the screen shows a trip
               and shouldn't have to know how it was found. Reload after, because
               the tip card is waiting on the rating landing. */
            onRate={(captain, ride, note) =>
              withToken(async (token) => {
                await rateTrip(token, captain, ride, note);
                await load(false);
              })
            }
            onMessage={(text) => openMessages(text, "office")}
          />
        ) : (
          <MessagesScreen
            trip={trip}
            loading={loading}
            channel={channel}
            onChannel={setChannel}
            draft={draft}
            onDraft={setDraft}
            onSend={(body, on) =>
              withToken(async (token) => {
                await sendTripMessage(token, body, on);
                await load(false);
              })
            }
          />
        )}
      </View>

      <View style={s.tabs}>
        <Tab label="Book a boat" active={tab === "book"} onPress={() => setTab("book")} />
        <Tab
          label="Payment"
          active={tab === "pay"}
          onPress={() => {
            setTab("pay");
            load(false);
          }}
        />
        <Tab
          label="Messages"
          badge={waiting}
          active={tab === "messages"}
          onPress={() => openMessages()}
        />
      </View>
    </SafeAreaView>
  );
}

function Tab({
  label,
  active,
  badge = 0,
  onPress,
}: {
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={[s.tab, active && s.tabOn]} onPress={onPress} accessibilityRole="tab">
      <View style={s.tabInner}>
        <Text style={[s.tabText, active && s.tabTextOn]}>{label}</Text>
        {badge > 0 ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1 },
  tabs: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  tab: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.foam,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabOn: { backgroundColor: colors.deep, borderColor: colors.deep },
  tabInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  tabText: { fontSize: 14, fontWeight: "700", color: colors.muted },
  tabTextOn: { color: colors.white },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "800" },
});
