import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius } from "../lib/theme";
import { IN_NASSAU } from "../lib/nassau";
import type { TripMessage, TripView } from "../lib/trip";

/* The passenger's side of the conversation.

   Two channels, not two inboxes: the office is always reachable, and the
   captain opens up once the trip is paid for. The tab for the captain stays on
   screen while it is locked — a passenger should know their captain exists and
   what makes him reachable — and it still opens, because a tap that bounces
   back reads as broken rather than as locked.

   This is the same thread the web trip page shows. It was missing from the app
   entirely, while the Payment screen told people their captain was "reachable
   in Messages". Now he is. */

export type Channel = "office" | "captain";

export default function MessagesScreen({
  trip,
  loading,
  channel,
  onChannel,
  draft,
  onDraft,
  onSend,
}: {
  trip: TripView | null;
  loading: boolean;
  channel: Channel;
  onChannel: (c: Channel) => void;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (body: string, channel: Channel) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scroller = React.useRef<ScrollView>(null);

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
        <Text style={s.emptyTitle}>Nothing to talk about yet</Text>
        <Text style={s.emptyBody}>
          Book a boat and you can reach us — and your captain — right here.
        </Text>
      </View>
    );
  }

  const canCaptain = !!trip.can_message_captain;
  const msgs = (trip.messages ?? []).filter((m) => (m.channel ?? "office") === channel);
  const open = !!trip.can_reply && (channel === "office" || canCaptain);
  const finished = trip.status === "completed";
  const captain = trip.captain ? `Capt. ${trip.captain}` : "your captain";

  async function say(body: string) {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(text, channel);
      onDraft("");
    } catch (e: any) {
      // The database refuses the captain channel on an unpaid trip and says so
      // in a sentence written for a passenger; anything else is the signal.
      const m = String(e?.message ?? "");
      setError(/paid for|no captain|off this trip|closed/i.test(m)
        ? m
        : "That didn't send. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.tabs}>
        <Pressable
          onPress={() => onChannel("office")}
          style={[s.tab, channel === "office" && s.tabOn]}
          accessibilityRole="tab"
          accessibilityState={{ selected: channel === "office" }}
        >
          <Text style={[s.tabText, channel === "office" && s.tabTextOn]}>Paradise Sea Express</Text>
        </Pressable>
        <Pressable
          onPress={() => onChannel("captain")}
          style={[s.tab, channel === "captain" && s.tabOn, !canCaptain && s.tabLocked]}
          accessibilityRole="tab"
          accessibilityState={{ selected: channel === "captain" }}
          accessibilityLabel={canCaptain ? "Your captain" : "Your captain — opens once the trip is paid for"}
        >
          <Text style={[s.tabText, channel === "captain" && s.tabTextOn]}>
            Your captain{canCaptain ? "" : " 🔒"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        style={s.thread}
        contentContainerStyle={s.threadInner}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        {msgs.length === 0 ? (
          channel === "captain" && !canCaptain ? null : (
            <Text style={s.empty}>
              {channel === "captain"
                ? "Nothing here yet. Anything you need your captain to know — where you're standing, how much luggage — say it here."
                : "No messages yet. Ask us anything about your trip."}
            </Text>
          )
        ) : (
          msgs.map((m, i) => <Bubble key={`${m.at}-${i}`} m={m} />)
        )}
      </ScrollView>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {open ? (
        <View style={s.composer}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={onDraft}
            placeholder="Type a message…"
            placeholderTextColor={colors.muted}
            maxLength={2000}
            editable={!busy}
            onSubmitEditing={() => say(draft)}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => say(draft)}
            disabled={busy || !draft.trim()}
            style={({ pressed }) => [s.send, (busy || !draft.trim()) && s.sendOff, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={s.sendText}>Send</Text>
          </Pressable>
        </View>
      ) : !trip.can_reply ? (
        <Text style={s.note}>
          This trip is finished, so the thread is closed. If something's outstanding, the office
          can still be reached by phone.
        </Text>
      ) : (
        // The captain tab, locked. Two reasons it can be, and they read differently.
        <Text style={s.lockNote}>
          {finished
            ? "Your captain is off this trip now. We're on the other tab if anything's outstanding."
            : `${captain} opens up here once the trip is paid for. Until then we're on the other tab and happy to help.`}
        </Text>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({ m }: { m: TripMessage }) {
  const mine = m.sender === "customer";
  const who = mine ? "You" : m.sender === "captain" ? "Your captain" : "Paradise Sea Express";
  const at = new Date(m.at).toLocaleString(undefined, { ...IN_NASSAU, hour: "numeric", minute: "2-digit" });
  return (
    <View style={[s.bub, mine ? s.mine : s.theirs]}>
      <Text style={[s.bubWho, mine && s.bubWhoMine]}>
        {who} · {at}
      </Text>
      <Text style={[s.bubBody, mine && s.bubBodyMine]}>{m.body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.foam },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.ink, marginBottom: 6 },
  emptyBody: { fontSize: 14.5, color: colors.muted, textAlign: "center", lineHeight: 21 },

  tabs: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 6 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: "center",
  },
  tabOn: { backgroundColor: colors.deep, borderColor: colors.deep },
  tabLocked: { opacity: 0.6 },
  tabText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  tabTextOn: { color: colors.white },

  thread: { flex: 1 },
  threadInner: { padding: 12, paddingTop: 6, gap: 7 },
  empty: { textAlign: "center", color: colors.muted, paddingVertical: 26, lineHeight: 21, fontSize: 14 },
  bub: { maxWidth: "84%", borderRadius: 14, paddingVertical: 8, paddingHorizontal: 11 },
  theirs: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignSelf: "flex-start" },
  mine: { backgroundColor: colors.teal, alignSelf: "flex-end" },
  bubWho: { fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 2 },
  bubWhoMine: { color: "rgba(255,255,255,0.85)" },
  bubBody: { fontSize: 15, color: colors.ink, lineHeight: 20 },
  bubBodyMine: { color: colors.white },

  composer: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.foam,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    paddingHorizontal: 15,
    fontSize: 16,
    color: colors.ink,
  },
  send: { backgroundColor: colors.teal, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20 },
  sendOff: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  sendText: { color: colors.white, fontWeight: "800", fontSize: 15 },

  note: { color: colors.muted, fontSize: 14, lineHeight: 20, padding: 14 },
  lockNote: {
    margin: 12,
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.amber,
    backgroundColor: colors.amberBg,
    borderRadius: 8,
    padding: 10,
    lineHeight: 19,
  },
  error: {
    color: colors.danger,
    fontWeight: "600",
    fontSize: 13,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
});
