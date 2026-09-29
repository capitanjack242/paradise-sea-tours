import React from "react";
import { StatusBar } from "expo-status-bar";
import { Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import BookScreen from "./src/screens/BookScreen";
import PaymentScreen from "./src/screens/PaymentScreen";
import MessagesScreen, { type Channel } from "./src/screens/MessagesScreen";
import {
  fetchTrip,
  forgetTrip,
  payLink,
  rateTrip,
  savedTrips,
  sendTripMessage,
  showTrip,
  type TripMessage,
  type TripView,
} from "./src/lib/trip";
import { IN_NASSAU } from "./src/lib/nassau";
import { colors, radius } from "./src/lib/theme";

/* Three tabs: ask for a boat, settle up for it, and talk to whoever is running
   it. The third was missing — the Payment screen promised a captain "reachable
   in Messages" and there was nowhere to reach him. */

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
  // Every trip this phone has booked, for the switcher, and which one is showing.
  const [others, setOthers] = React.useState<{ token: string; trip: TripView }[]>([]);
  const [current, setCurrent] = React.useState<string | null>(null);

  /** `all` also refreshes the other saved trips — the switcher's labels. The
      fifteen-second poll only needs the one on screen. */
  const load = React.useCallback(async (showSpinner = true, all = showSpinner) => {
    if (showSpinner) setLoading(true);
    try {
      const saved = await savedTrips();
      setCurrent(saved.current);
      if (!saved.current) {
        setTrip(null);
        return;
      }
      const next = await fetchTrip(saved.current);
      // Only a real "no such trip" clears the screen. A request that failed —
      // one bar of signal on a dock — keeps whatever was already showing.
      if (next !== null) setTrip(next);
      else {
        await forgetTrip(saved.current);
        setTrip(null);
      }
      if (all && saved.tokens.length > 1) {
        const found = await Promise.all(
          saved.tokens.map(async (token) => {
            try {
              const t = token === saved.current ? next : await fetchTrip(token);
              if (t === null) await forgetTrip(token);
              return t ? { token, trip: t } : null;
            } catch {
              return null; // a dropped request is not a deleted trip
            }
          })
        );
        setOthers(found.filter((x): x is { token: string; trip: TripView } => x !== null));
      }
    } catch (e: any) {
      console.warn("could not load the trip:", e?.message ?? e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  async function switchTo(token: string) {
    await showTrip(token);
    setCurrent(token);
    setDraft("");
    load(true, false);
  }

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
    const { current: token } = await savedTrips();
    if (!token) throw new Error("We've lost the link to that trip.");
    return fn(token);
  }

  const waiting = trip ? awaitingMe(trip.messages) : 0;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />

      {/* More than one trip booked from this phone: say which one is showing,
          and let them switch. Only on the trip tabs — booking is its own thing. */}
      {tab !== "book" && others.length > 1 ? (
        <ScrollView
          horizontal
          style={s.tripsBar}
          contentContainerStyle={s.tripsBarInner}
          showsHorizontalScrollIndicator={false}
        >
          {others.map(({ token, trip: t }) => (
            <Pressable
              key={token}
              onPress={() => switchTo(token)}
              style={[s.tripChip, token === current && s.tripChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: token === current }}
            >
              <Text style={[s.tripChipText, token === current && s.tripChipTextOn]} numberOfLines={1}>
                {tripLabel(t)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={s.body}>
        {tab === "book" ? (
          /* A booking hands back the key to the trip, so pick it up straight
             away — otherwise the Payment tab sits empty until the next launch. */
          <BookScreen
            onBooked={() => {
              load(false, true);
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
            onPay={(kind, tipCents, fallback) =>
              withToken(async (token) => {
                const r = await payLink(token, kind, tipCents ?? undefined);
                if (r.url) {
                  // Fygaro's card page, in the phone's browser. The trip polls
                  // every fifteen seconds, so it shows as paid on the way back.
                  await Linking.openURL(r.url);
                  return null;
                }
                if (r.connected && r.error) return r.error;
                // Card payments not switched on yet: the office takes it from here.
                openMessages(fallback, "office");
                return null;
              })
            }
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
            load(false, true);
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

/** "Sat 10:30 AM · Cruise Port → Rose Island" — enough to tell two trips apart. */
function tripLabel(t: TripView): string {
  const short = (place: string | null) => (place ?? "?").replace(/^Nassau /, "").split(/ [&/(]/)[0];
  const when = t.scheduled_at
    ? new Date(t.scheduled_at).toLocaleString(undefined, {
        ...IN_NASSAU,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return `${when ? `${when} · ` : ""}${short(t.pickup)} → ${short(t.destination)}`;
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
  tripsBar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line },
  tripsBarInner: { gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  tripChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.foam,
  },
  tripChipOn: { backgroundColor: colors.deep, borderColor: colors.deep },
  tripChipText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  tripChipTextOn: { color: colors.white },
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
