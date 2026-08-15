import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius } from "../lib/theme";
import { signIn } from "../lib/session";

export default function SignInScreen() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit() {
    if (!email.trim() || !password) {
      setError("Enter the email and password the office set up for you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e: any) {
      // Supabase says "Invalid login credentials", which tells a captain nothing
      // about what to do next.
      setError(
        e?.message?.includes("Invalid")
          ? "That email and password don't match. Check with the office."
          : e?.message ?? "Couldn't sign in. Try again in a moment."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.card}>
        <Text style={s.brand}>
          Paradise<Text style={s.brandAccent}>Sea Tours</Text>
        </Text>
        <Text style={s.sub}>Captain</Text>

        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
        />

        <Text style={s.label}>Password</Text>
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Pressable
          onPress={onSubmit}
          disabled={busy}
          style={({ pressed }) => [s.cta, (busy || pressed) && s.ctaDim]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={s.ctaText}>Sign in</Text>}
        </Pressable>

        <Text style={s.footnote}>
          Your login is made for you by the office. If you can't get in, message Shavane.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.foam, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 22,
  },
  brand: { fontSize: 24, fontWeight: "800", color: colors.navy, textAlign: "center" },
  brandAccent: { color: colors.teal },
  sub: { textAlign: "center", color: colors.muted, marginTop: 2, marginBottom: 18 },
  label: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.foam,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, fontWeight: "600", fontSize: 14, marginTop: 12 },
  cta: {
    backgroundColor: colors.teal,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 20,
  },
  ctaDim: { opacity: 0.75 },
  ctaText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  footnote: { color: colors.muted, fontSize: 12.5, textAlign: "center", marginTop: 14, lineHeight: 18 },
});
