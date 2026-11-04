import { NativeTabs } from "expo-router/native-tabs";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTheme } from "@/theme";

export default function TabsLayout() {
  const { isStaff } = useAuth();
  const c = useTheme();
  return (
    <NativeTabs backgroundColor={c.bg} tintColor={c.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="globe.asia.australia" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>My trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="suitcase" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="staff" hidden={!isStaff}>
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.full" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
