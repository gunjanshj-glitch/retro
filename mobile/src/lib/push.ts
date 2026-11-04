/**
 * Push registration (docs/mobile/01, B6). Permission is requested only at a meaningful
 * moment (after the first request is sent), never on launch. Payloads are generic by rule;
 * the app fetches the detail after the tap.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api, platform } from "./api";
import { APP_VERSION } from "./env";

let deviceId: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Returns true when this phone is now registered. Safe to call repeatedly. */
export async function registerForPush(): Promise<boolean> {
  if (!Device.isDevice) return false; // simulators cannot receive push
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return false; // no EAS project yet (Gate A); the app works without push

  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  const r = await api.devices.register(data, platform, APP_VERSION);
  deviceId = r.id;
  return true;
}

/** Called on sign-out so a phone that changes hands stops receiving the previous person's alerts. */
export async function unregisterDevice(): Promise<void> {
  if (!deviceId) return;
  const id = deviceId;
  deviceId = null;
  await api.devices.remove(id);
}
