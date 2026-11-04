import { StyleSheet, View } from "react-native";
import { Button, Screen, Text } from "@/ui";
import { radius, space, useTheme } from "@/theme";
import { PlaneGame } from "./PlaneGame";
import type { Progress } from "./storage";

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export function SyncScreen({ progress, firstTime, done, onContinue }: { progress: Progress; firstTime: boolean; done: boolean; onContinue: () => void }) {
  const c = useTheme();
  const pct = done ? 1 : progress.bytesTotal ? Math.min(1, progress.bytes / progress.bytesTotal) : 0;
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: "center", gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Text variant="label" color={c.accent}>{firstTime ? "Setting up" : "Updating"}</Text>
          <Text variant="title">{done ? "All set" : firstTime ? "Packing the world into your phone" : "Fresh prices and places on the way"}</Text>
          <Text dim>
            {done
              ? "Everything is ready. Plan your trip, even without a signal."
              : firstTime
                ? "One-time download so planning is instant and works offline. Play while you wait."
                : "We changed some places and prices. Play while we update, it only takes a moment."}
          </Text>
        </View>

        <View style={{ gap: space.xs }}>
          <View style={[styles.track, { backgroundColor: c.surfaceHi }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
            <View style={[styles.fill, { width: `${Math.max(3, pct * 100)}%`, backgroundColor: c.accent }]} />
          </View>
          <Text variant="small" dim>{done ? "Done" : `${Math.round(pct * 100)}% · ${mb(progress.bytes)} of ${mb(progress.bytesTotal)}`}</Text>
        </View>

        {done ? <Button label="Start exploring" onPress={onContinue} /> : <PlaneGame />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: 10, borderRadius: radius.pill },
});
