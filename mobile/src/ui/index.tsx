import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, type as t, useTheme } from "@/theme";
import { STATUS_COPY, type RequestStatus } from "@retro/core/quote-workflow";

export function Screen({ children, scroll = true, pad = true }: { children: ReactNode; scroll?: boolean; pad?: boolean }) {
  const c = useTheme();
  const inset = useSafeAreaInsets();
  const style: ViewStyle = { padding: pad ? space.lg : 0, paddingBottom: inset.bottom + space.xxl, gap: space.lg };
  return scroll ? (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={style} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>
  );
}

type TextProps = { children: ReactNode; variant?: keyof typeof t; dim?: boolean; style?: TextStyle; numberOfLines?: number; color?: string };
export function Text({ children, variant = "body", dim, style, numberOfLines, color }: TextProps) {
  const c = useTheme();
  return (
    <RNText numberOfLines={numberOfLines} style={[t[variant], { color: color ?? (dim ? c.textDim : c.text) }, style]}>
      {children}
    </RNText>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const c = useTheme();
  const base: ViewStyle = { backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.lg, gap: space.sm };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.8 }]}>
      {children}
    </Pressable>
  );
}

export function Button({ label, onPress, kind = "primary", busy, disabled }: { label: string; onPress: () => void; kind?: "primary" | "secondary" | "danger"; busy?: boolean; disabled?: boolean }) {
  const c = useTheme();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? "transparent" : c.surfaceHi;
  const fg = kind === "primary" ? c.onAccent : kind === "danger" ? c.danger : c.text;
  const off = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: bg, borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: space.xl, alignItems: "center", opacity: off ? 0.5 : pressed ? 0.85 : 1, borderWidth: kind === "danger" ? 1 : 0, borderColor: c.danger, minHeight: 48, justifyContent: "center" })}
    >
      {busy ? <ActivityIndicator color={fg} /> : <RNText style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{label}</RNText>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" dim>{label}</Text>
      <TextInput
        placeholderTextColor={c.textDim}
        accessibilityLabel={label}
        {...props}
        style={[{ backgroundColor: c.surface, color: c.text, borderColor: error ? c.danger : c.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12, fontSize: 16, minHeight: 48 }, props.multiline && { minHeight: 96, textAlignVertical: "top" }]}
      />
      {error ? <Text variant="small" color={c.danger}>{error}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ paddingVertical: 8, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : "transparent" }}>
      <RNText style={{ color: selected ? c.onAccent : c.text, fontSize: 14, fontWeight: "600" }}>{label}</RNText>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{children}</View>;
}

export function StatusPill({ status }: { status: RequestStatus }) {
  const c = useTheme();
  const copy = STATUS_COPY[status];
  const tone = { neutral: c.textDim, progress: c.action, action: c.accent, success: c.success, danger: c.danger }[copy.tone];
  return (
    <View style={{ alignSelf: "flex-start", borderColor: tone, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <RNText style={{ color: tone, fontSize: 12, fontWeight: "700" }}>{copy.label}</RNText>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.xxl }}>
      <Text variant="heading">{title}</Text>
      <Text dim style={{ textAlign: "center" }}>{body}</Text>
      {action}
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return <View style={{ padding: space.xxl, alignItems: "center" }}><ActivityIndicator color={c.accent} /></View>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <Card style={{ borderColor: c.danger }}>
      <Text color={c.danger}>{message}</Text>
      {onRetry ? <Button label="Try again" kind="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function Row({ children, between }: { children: ReactNode; between?: boolean }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, justifyContent: between ? "space-between" : "flex-start" }}>{children}</View>;
}
