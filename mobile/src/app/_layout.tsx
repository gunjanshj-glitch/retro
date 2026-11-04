import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import * as Linking from "expo-linking";
import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import { api, platform } from "@/lib/api";
import { APP_VERSION } from "@/lib/env";
import { Button, Empty, Screen } from "@/ui";
import { useTheme } from "@/theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 }, mutations: { retry: 0 } },
});

/** Blocks the app below the minimum version or during maintenance. Fails open: an unreachable config never locks a working app. */
function ConfigGate({ children }: { children: ReactNode }) {
  const { data } = useQuery({ queryKey: ["app-config"], queryFn: () => api.config(platform, APP_VERSION), staleTime: 5 * 60_000, retry: 0 });
  if (data?.maintenance) return <Screen><Empty title="Back shortly" body={data.maintenanceMessage ?? "We are making improvements and will be back shortly."} /></Screen>;
  if (data?.updateRequired)
    return (
      <Screen>
        <Empty title="Please update" body="This version of the app is no longer supported. Update to keep planning and paying securely." action={<Button label="Open the App Store" onPress={() => void Linking.openURL("https://apps.apple.com/app/retro-holidays")} />} />
      </Screen>
    );
  return <>{children}</>;
}

function Shell() {
  const { ready } = useAuth();
  const scheme = useColorScheme();
  const c = useTheme();
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, primary: c.accent } }}>
      <StatusBar style="auto" />
      <ConfigGate>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ presentation: "modal", title: "Sign in" }} />
          <Stack.Screen name="chat" options={{ presentation: "modal", title: "Talk to us" }} />
          <Stack.Screen name="package/[id]" options={{ title: "" }} />
          <Stack.Screen name="trip/[id]" options={{ title: "Your trip" }} />
          <Stack.Screen name="staff/[id]" options={{ title: "Request" }} />
          <Stack.Screen name="staff/leads" options={{ title: "Leads" }} />
        </Stack>
      </ConfigGate>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </QueryClientProvider>
  );
}
