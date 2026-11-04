/**
 * A deliberately simple time-passer for the update screen: tap the planes as they pop up.
 * Pure React state and timers, no native modules, so it runs anywhere the app does.
 */
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/ui";
import { radius, space, useTheme } from "@/theme";

const CELLS = 9;

export function PlaneGame() {
  const c = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [misses, setMisses] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hit = useRef(false);

  const next = useCallback(() => {
    setActive((prev) => {
      let n = Math.floor(Math.random() * CELLS);
      if (n === prev) n = (n + 1) % CELLS;
      return n;
    });
    hit.current = false;
    // Gets slightly quicker as the score climbs, never impossible.
    timer.current = setTimeout(() => {
      if (!hit.current) setMisses((m) => m + 1);
      next();
    }, 900);
  }, []);

  useEffect(() => {
    next();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [next]);

  const tap = (i: number) => {
    if (i !== active || hit.current) return;
    hit.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setScore((s) => {
      const n = s + 1;
      setBest((b) => Math.max(b, n));
      return n;
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(next, 120);
  };

  const reset = () => { setScore(0); setMisses(0); };

  return (
    <View style={{ alignItems: "center", gap: space.md }}>
      <View style={{ flexDirection: "row", gap: space.xl }}>
        <Text variant="small" dim>Caught {score}</Text>
        <Text variant="small" dim>Best {best}</Text>
        <Text variant="small" dim>Missed {misses}</Text>
      </View>
      <View style={styles.grid}>
        {Array.from({ length: CELLS }, (_, i) => (
          <Pressable key={i} onPressIn={() => tap(i)} accessibilityLabel={i === active ? "Plane, tap it" : "Empty"} style={[styles.cell, { backgroundColor: c.surface, borderColor: c.border }]}>
            {i === active ? <Text style={{ fontSize: 34 }}>✈️</Text> : null}
          </Pressable>
        ))}
      </View>
      {misses > 0 ? <Pressable onPress={reset}><Text variant="small" color={c.accent}>Reset score</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: 264, flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  cell: { width: 80, height: 80, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
});
