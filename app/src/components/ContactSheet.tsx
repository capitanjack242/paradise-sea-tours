import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { parsePhone, prettyPhone } from "../lib/auth";
import { colors, radius } from "../lib/theme";

type Props = {
  visible: boolean;
  /** Shown on the sheet so it's obvious the trip isn't lost. */
  holdingText?: string;
  /** Prefilled from the last booking, so a regular isn't retyping. */
  initialName?: string;
  initialPhone?: string;
  onCancel: () => void;
  onDone: (name: string, phone: string) => void;
};

/**
 * Who we're holding it for — asked after the trip is chosen, never before.
 *
 * No account and no texted code. The number is confirmed back to them instead,
 * because a typo in it is the one mistake that leaves a passenger on a dock
 * with no way to be reached. That's the same thing the website does, and it
 * works today: a code needs an SMS provider, and this doesn't.
 */
export default function ContactSheet({
  visible,
  holdingText,
  initialName,
  initialPhone,
  onCancel,
  onDone,
}: Props) {
  const [step, setStep] = React.useState<"details" | "confirm">("details");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setStep("details");
      setError(null);
      setName(initialName ?? "");
      setPhone(initialPhone ? prettyPhone(initialPhone) : "");
    }
  }, [visible, initialName, initialPhone]);

  /** Tidy the number into international form as soon as they leave the field. */
  function onPhoneBlur() {
    const p = parsePhone(phone);
    if (p) setPhone(p.formatInternational());
  }

  function onContinue() {
    setError(null);
    if (!name.trim()) return setError("We need a name so your captain knows who to look for.");
    const parsed = parsePhone(phone);
    if (!parsed)
      return setError(
        "We couldn't read that as a phone number — try it with your country code, like +1 242 555 0142."
      );
    setPhone(parsed.formatInternational());
    setStep("confirm");
  }

  function onConfirm() {
    const parsed = parsePhone(phone);
    if (!parsed) return setStep("details");
    onDone(name.trim(), parsed.number);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={s.dim} onPress={onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.sheet}>
          <View style={s.grab} />

          {step === "details" ? (
            <>
              <Text style={s.headline}>Who are we holding it for?</Text>
              <Text style={s.sub}>
                No account needed. We use your number to confirm the boat, and your
                captain uses it to find you on the day.
              </Text>

              <Text style={s.label}>Your name</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Sarah Mitchell"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
              />

              <Text style={s.label}>Mobile number</Text>
              <TextInput
                style={s.input}
                value={phone}
                onChangeText={setPhone}
                onBlur={onPhoneBlur}
                placeholder="+1 242 555 0142"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                autoComplete="tel"
              />

              {!!holdingText && (
                <View style={s.holding}>
                  <Text style={s.holdingText}>Holding: {holdingText}</Text>
                </View>
              )}

              {!!error && <Text style={s.error}>{error}</Text>}

              <Pressable style={s.cta} onPress={onContinue}>
                <Text style={s.ctaText}>Continue</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.headline}>Is this the right number?</Text>
              <Text style={s.sub}>
                It's how we confirm your boat and how your captain reaches you. A
                digit out and neither of those gets to you.
              </Text>

              <Text style={s.number}>{prettyPhone(parsePhone(phone)?.number ?? phone)}</Text>

              <Pressable style={s.cta} onPress={onConfirm}>
                <Text style={s.ctaText}>Yes, that's right</Text>
              </Pressable>
              <Pressable style={s.secondary} onPress={() => setStep("details")}>
                <Text style={s.secondaryText}>Change it</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(6,36,59,0.45)" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 34,
  },
  grab: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 14,
  },
  headline: { fontSize: 22, fontWeight: "800", color: colors.ink },
  sub: { fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: "700", color: colors.muted, marginTop: 16, marginBottom: 5 },
  input: {
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  number: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
    marginVertical: 22,
  },
  holding: {
    marginTop: 16,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: colors.foam,
    borderWidth: 1,
    borderColor: colors.line,
  },
  holdingText: { fontSize: 13, color: colors.deep, fontWeight: "600" },
  error: { marginTop: 12, fontSize: 13.5, fontWeight: "600", color: "#c0392b", lineHeight: 19 },
  cta: {
    marginTop: 18,
    backgroundColor: colors.teal,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: "center",
  },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  secondary: { marginTop: 10, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: colors.muted, fontSize: 14.5, fontWeight: "700" },
});
