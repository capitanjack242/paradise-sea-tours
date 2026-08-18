import React from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import BookScreen from "./src/screens/BookScreen";
import PaymentScreen from "./src/screens/PaymentScreen";
import { fetchTrip, type TripView } from "./src/lib/trip";
import { colors, radius } from "./src/lib/theme";

/* Two tabs, because a passenger only ever does two things: ask for a boat, and
   settle up for it. */

const TRIP_TOKEN_KEY = "paradise.trip.token";

export default function App() {
  const [tab, setTab] = React.useState<"book" | "pay">("book");
  const [trip, setTrip] = React.useState<TripView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const token = await AsyncStorage.getItem(TRIP_TOKEN_KEY);
      setTrip(token ? await fetchTrip(token) : null);
    } catch (e: any) {
      console.warn("could not load the trip:", e?.message ?? e);
      setTrip(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

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
        ) : (
          <PaymentScreen
            trip={trip}
            loading={loading}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(false);
            }}
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
      </View>
    </SafeAreaView>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[s.tab, active && s.tabOn]} onPress={onPress}>
      <Text style={[s.tabText, active && s.tabTextOn]}>{label}</Text>
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
  tabText: { fontSize: 14, fontWeight: "700", color: colors.muted },
  tabTextOn: { color: colors.white },
});
