import { createClient } from "@retro/api-client";
import { Platform } from "react-native";
import { API_URL } from "./env";
import { getToken } from "./token";

let signOutHandler: (() => void) | null = null;
export const onSignOutRequired = (fn: (() => void) | null) => { signOutHandler = fn; };

export const api = createClient({
  baseUrl: API_URL,
  getToken,
  onUnauthorised: () => signOutHandler?.(),
  newKey: () => globalThis.crypto.randomUUID(),
});

export const platform: "ios" | "android" = Platform.OS === "android" ? "android" : "ios";
