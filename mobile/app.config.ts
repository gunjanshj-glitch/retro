import type { ExpoConfig } from "expo/config";

/**
 * Build-time config. Values that depend on store accounts (bundle id, associated
 * domains, EAS project id) are read from the environment so the app builds and runs
 * in Expo Go with none of them (docs/mobile/08, Gate A).
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://retroholidays.in/api/v1";

const config: ExpoConfig = {
  name: "Retro Holidays",
  slug: "retro-holidays",
  scheme: "retro",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  ios: {
    supportsTablet: false,
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? "in.retroholidays.app",
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? "in.retroholidays.app",
    adaptiveIcon: {
      backgroundColor: "#0e1411",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-splash-screen", { backgroundColor: "#0e1411", image: "./assets/images/splash-icon.png", imageWidth: 120 }],
    ["expo-notifications", { color: "#c9a24a" }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    apiUrl: API_URL,
    whatsapp: "916290855027",
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
};

export default config;
