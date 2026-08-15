import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius } from "../lib/theme";

/** Small uppercase field label. */
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

/**
 * A tappable field that opens a picker. React Native has no <select>, so this
 * is the equivalent: it looks like an input and opens a sheet of options.
 */
export function PickerField({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <View>
      <Label>{label}</Label>
      <Pressable style={s.field} onPress={() => setOpen(true)}>
        <Text style={s.fieldText} numberOfLines={1}>
          {value}
        </Text>
        <Text style={s.chev}>▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={s.dim} onPress={() => setOpen(false)} />
        <View style={s.sheet}>
          <View style={s.grab} />
          <Text style={s.sheetTitle}>{label}</Text>
          <ScrollView>
            {options.map((o) => (
              <Pressable
                key={o}
                style={[s.option, o === value && s.optionOn]}
                onPress={() => {
                  onChange(o);
                  setOpen(false);
                }}
              >
                <Text style={[s.optionText, o === value && s.optionTextOn]}>{o}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/** Two-option toggle — one way vs round trip. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable
          key={o}
          style={[s.segItem, o === value && s.segItemOn]}
          onPress={() => onChange(o)}
        >
          <Text style={[s.segText, o === value && s.segTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Stepper for passenger count — easier than a keyboard on a phone. */
export function Stepper({
  value,
  min = 1,
  max = 12,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <View>
      <Label>{label}</Label>
      <View style={s.field}>
        <Pressable
          hitSlop={10}
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          <Text style={[s.stepBtn, value <= min && s.stepBtnOff]}>−</Text>
        </Pressable>
        <Text style={s.fieldText}>{value}</Text>
        <Pressable
          hitSlop={10}
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          <Text style={[s.stepBtn, value >= max && s.stepBtnOff]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 4,
  },
  field: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.foam,
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fieldText: { fontSize: 15, fontWeight: "600", color: colors.ink, flexShrink: 1 },
  chev: { color: colors.muted, fontSize: 12 },
  stepBtn: { fontSize: 20, fontWeight: "800", color: colors.deep, width: 26, textAlign: "center" },
  stepBtnOff: { color: colors.line },

  dim: { flex: 1, backgroundColor: "rgba(6,36,59,0.45)" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: "70%",
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 99,
    backgroundColor: colors.line,
    alignSelf: "center",
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 13, fontWeight: "800", color: colors.muted, marginBottom: 8 },
  option: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line },
  optionOn: { borderBottomColor: colors.teal },
  optionText: { fontSize: 16, color: colors.ink },
  optionTextOn: { color: colors.teal, fontWeight: "800" },

  seg: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.foam,
  },
  segItem: { flex: 1, paddingVertical: 10, alignItems: "center" },
  segItemOn: { backgroundColor: colors.deep },
  segText: { fontSize: 14, fontWeight: "700", color: colors.muted },
  segTextOn: { color: colors.white },
});
