import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  isPlausiblePhone,
  prettyPhone,
  saveName,
  sendCode,
  verifyCode,
} from "../lib/auth";
import { colors, radius } from "../lib/theme";

type Props = {
  visible: boolean;
  /** Shown on the sheet so it's obvious the trip isn't lost. */
  holdingText?: string;
  onCancel: () => void;
  /** Fired once the customer is signed in and their name is stored. */
  onSignedIn: (name: string, phone: string) => void;
};

/**
 * Sign-in, deferred until the customer actually requests a boat. The phone
 * number is the account; the texted code both logs them in and verifies the
 * number their captain will call.
 */
export default function SignInSheet({ visible, holdingText, onCancel, onSignedIn }: Props) {
  const [step, setStep] = React.useState<"details" | "code">("details");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setStep("details");
      setCode("");
      setError(null);
    }
  }, [visible]);

  async function onContinue() {
    setError(null);
    if (!name.trim()) return setError("We need a name so your captain knows who to look for.");
    if (!isPlausiblePhone(phone))
      return setError("Enter your number with the country code, like +1 242 555 0142.");

    setBusy(true);
    try {
      await sendCode(phone);
      setStep("code");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't send the code. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setError(null);
    if (code.trim().length < 4) return setError("Enter the code from the text.");

    setBusy(true);
    try {
      await verifyCode(phone, code);
      await saveName(name);
      onSignedIn(name.trim(), phone.trim());
    } catch (e: any) {
      setError(e?.message ?? "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={s.dim} onPress={busy ? undefined : onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.sheet}>
          <View style={s.grab} />

          {step === "details" ? (
            <>
              <Text style={s.headline}>What's your mobile number?</Text>
              <Text style={s.sub}>
                So we can confirm your boat, and your captain can reach you on the day.
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
                style={[s.input, s.inputFocusRing]}
                value={phone}
                onChangeText={setPhone}
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

              <Pressable style={[s.cta, busy && s.ctaOff]} onPress={onContinue} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={s.ctaText}>Continue</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.headline}>Enter the code we sent</Text>
              <Text style={s.sub}>
                Texted to <Text style={s.bold}>{prettyPhone(phone)}</Text>. This code both signs you
                in and gives your captain a way to reach you.
              </Text>

              <TextInput
                style={[s.input, s.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="••••••"
                placeholderTextColor={colors.line}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={8}
              />

              {!!error && <Text style={s.error}>{error}</Text>}

              <Pressable style={[s.cta, busy && s.ctaOff]} onPress={onVerify} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={s.ctaText}>Verify &amp; request boat</Text>
                )}
              </Pressable>

              <Pressable onPress={() => setStep("details")} disabled={busy}>
                <Text style={s.link}>Change number</Text>
              </Pressable>
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
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 8,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 99,
    backgroundColor: colors.line,
    alignSelf: "center",
    marginBottom: 6,
  },
  headline: { fontSize: 19, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  bold: { fontWeight: "800", color: colors.ink },
  label: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.foam,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  inputFocusRing: { borderWidth: 2, borderColor: colors.teal, backgroundColor: colors.white },
  codeInput: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 8,
    textAlign: "center",
    borderWidth: 2,
    borderColor: colors.teal,
    backgroundColor: colors.white,
    marginTop: 4,
  },
  holding: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.foam,
    padding: 10,
    marginTop: 4,
  },
  holdingText: { fontSize: 12, color: colors.muted },
  error: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  cta: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: colors.teal,
    marginTop: 6,
  },
  ctaOff: { opacity: 0.6 },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  link: { textAlign: "center", fontSize: 13, color: colors.muted, fontWeight: "700", marginTop: 4 },
});
