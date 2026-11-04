import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { Chip, ChipRow, Text } from "@/ui";
import { radius, space, useTheme } from "@/theme";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View>
        <Text variant="label" dim>{title}</Text>
        {hint ? <Text variant="small" dim>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function Pick<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ChipRow>
      {options.map((o) => <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => { void Haptics.selectionAsync().catch(() => {}); onChange(o.value); }} />)}
    </ChipRow>
  );
}

export function Stepper({ label, value, min, max, onChange, suffix }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  const c = useTheme();
  const btn = (sign: -1 | 1, disabled: boolean) => (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${sign < 0 ? "Fewer" : "More"} ${label}`} disabled={disabled}
      onPress={() => { void Haptics.selectionAsync().catch(() => {}); onChange(value + sign); }}
      style={[styles.stepBtn, { backgroundColor: c.surfaceHi, opacity: disabled ? 0.35 : 1 }]}
    >
      <Text variant="heading">{sign < 0 ? "−" : "+"}</Text>
    </Pressable>
  );
  return (
    <View style={styles.rowBetween}>
      <Text>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        {btn(-1, value <= min)}
        <Text variant="heading" style={{ minWidth: 56, textAlign: "center" }}>{value}{suffix ? ` ${suffix}` : ""}</Text>
        {btn(1, value >= max)}
      </View>
    </View>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.rowBetween}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text>{label}</Text>
        {hint ? <Text variant="small" dim>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  stepBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
