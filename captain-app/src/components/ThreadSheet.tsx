import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius } from "../lib/theme";
import type { Message, Trip } from "../lib/data";

/* The only channel to a passenger — captains are never given a phone number.

   The canned lines exist because a captain is usually holding a line or a
   throttle. "On my way" and "at the dock" are most of what ever needs saying,
   and they're one tap rather than typing on a moving boat. */

const QUICK = ["On my way", "At the dock", "Running 10 min late"];

export default function ThreadSheet({
  trip,
  messages,
  visible,
  onClose,
  onSend,
}: {
  trip: Trip | null;
  messages: Message[];
  visible: boolean;
  onClose: () => void;
  onSend: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scroller = React.useRef<ScrollView>(null);

  React.useEffect(() => {
    if (visible) {
      setDraft("");
      setError(null);
    }
  }, [visible, trip?.id]);

  if (!trip) return null;

  const closed = trip.status === "completed" || trip.status === "cancelled";

  async function say(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body);
      setDraft("");
    } catch {
      setError("That didn't send — check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.dim} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.sheet}>
          <View style={s.grab} />

          <View style={s.head}>
            <Text style={s.who}>{trip.contact_name ?? "Passenger"}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.close}>Done</Text>
            </Pressable>
          </View>
          <Text style={s.sub}>
            {trip.pickup ?? "—"} → {trip.destination ?? "—"}
          </Text>

          <ScrollView
            ref={scroller}
            style={s.thread}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 ? (
              <Text style={s.empty}>Nothing said yet.</Text>
            ) : (
              messages.map((m) => {
                const mine = m.sender === "captain";
                const who =
                  m.sender === "customer"
                    ? trip.contact_name ?? "Passenger"
                    : m.sender === "dispatch"
                    ? "Office"
                    : "You";
                const at = new Date(m.created_at).toLocaleString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                });
                return (
                  <View key={m.id} style={[s.bub, mine ? s.mine : s.theirs]}>
                    <Text style={[s.bubWho, mine && s.bubWhoMine]}>
                      {who} · {at}
                    </Text>
                    <Text style={[s.bubBody, mine && s.bubBodyMine]}>{m.body}</Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {closed ? (
            <Text style={s.closedNote}>
              This trip is finished, so the thread is closed. Anything outstanding goes through the
              office.
            </Text>
          ) : (
            <>
              <View style={s.quicks}>
                {QUICK.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => say(q)}
                    disabled={busy}
                    style={({ pressed }) => [s.quick, pressed && s.pressed, busy && s.busy]}
                  >
                    <Text style={s.quickText}>{q}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={s.composer}>
                <TextInput
                  style={s.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={`Message ${trip.contact_name ?? "passenger"}…`}
                  placeholderTextColor={colors.muted}
                  maxLength={2000}
                  editable={!busy}
                  onSubmitEditing={() => say(draft)}
                  returnKeyType="send"
                />
                <Pressable
                  onPress={() => say(draft)}
                  disabled={busy || !draft.trim()}
                  style={({ pressed }) => [
                    s.send,
                    (busy || !draft.trim()) && s.busy,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={s.sendText}>Send</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { flex: 1, backgroundColor: "rgba(6,36,59,0.45)" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: "88%",
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.line,
    alignSelf: "center",
    marginBottom: 10,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  who: { fontSize: 17, fontWeight: "800", color: colors.ink },
  close: { fontSize: 15, fontWeight: "700", color: colors.teal },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: 10 },

  thread: { maxHeight: 380 },
  empty: { textAlign: "center", color: colors.muted, paddingVertical: 26 },
  bub: { maxWidth: "84%", borderRadius: 14, paddingVertical: 8, paddingHorizontal: 11, marginBottom: 7 },
  theirs: { backgroundColor: colors.foam, borderWidth: 1, borderColor: colors.line, alignSelf: "flex-start" },
  mine: { backgroundColor: colors.teal, alignSelf: "flex-end" },
  bubWho: { fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 2 },
  bubWhoMine: { color: "rgba(255,255,255,0.85)" },
  bubBody: { fontSize: 15, color: colors.ink, lineHeight: 20 },
  bubBodyMine: { color: colors.white },

  quicks: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  quick: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 13,
    backgroundColor: colors.white,
  },
  quickText: { fontSize: 13, fontWeight: "700", color: colors.deep },
  pressed: { opacity: 0.8 },
  busy: { opacity: 0.5 },

  composer: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
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
  send: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  sendText: { color: colors.white, fontWeight: "800", fontSize: 15 },

  error: { color: colors.danger, fontWeight: "600", fontSize: 13, marginTop: 8 },
  closedNote: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 12 },
});
