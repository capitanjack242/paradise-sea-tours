import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../lib/theme";

/* Shared pieces, sized for a phone held one-handed on a moving boat: big
   targets, high contrast, nothing that needs precision. */

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Pill({
  tone = "quiet",
  children,
}: {
  tone?: "go" | "quiet" | "warn";
  children: React.ReactNode;
}) {
  return (
    <View style={[s.pill, tone === "go" && s.pillGo, tone === "warn" && s.pillWarn]}>
      <Text style={[s.pillText, tone === "go" && s.pillTextGo, tone === "warn" && s.pillTextWarn]}>
        {children}
      </Text>
    </View>
  );
}

export function BigButton({
  label,
  onPress,
  tone = "go",
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: "go" | "deep" | "quiet";
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.big,
        tone === "go" && s.bigGo,
        tone === "deep" && s.bigDeep,
        tone === "quiet" && s.bigQuiet,
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={[s.bigText, tone === "quiet" && s.bigTextQuiet]}>{label}</Text>
    </Pressable>
  );
}

/** Availability. Deliberately large — it's the first thing touched each day. */
export function Switch({ on, onToggle, busy }: { on: boolean; onToggle: () => void; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: busy }}
      onPress={onToggle}
      disabled={busy}
      style={[s.track, on && s.trackOn, busy && s.disabled]}
    >
      <View style={[s.knob, on && s.knobOn]} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <Text style={s.empty}>{children}</Text>;
}

const s = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
    backgroundColor: colors.foam,
  },
  pillGo: { backgroundColor: colors.greenBg },
  pillWarn: { backgroundColor: colors.amberBg },
  pillText: { fontSize: 11, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 },
  pillTextGo: { color: colors.green },
  pillTextWarn: { color: colors.amber },

  big: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  bigGo: { backgroundColor: colors.green },
  bigDeep: { backgroundColor: colors.deep },
  bigQuiet: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  bigText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  bigTextQuiet: { color: colors.muted, fontWeight: "700" },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },

  track: {
    width: 56,
    height: 33,
    borderRadius: 999,
    backgroundColor: colors.line,
    padding: 3,
    justifyContent: "center",
  },
  trackOn: { backgroundColor: colors.green },
  knob: { width: 27, height: 27, borderRadius: 999, backgroundColor: colors.white },
  knobOn: { alignSelf: "flex-end" },

  empty: { textAlign: "center", color: colors.muted, paddingVertical: 40, fontSize: 15 },
});
