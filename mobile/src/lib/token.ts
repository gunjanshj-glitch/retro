/** The bearer token lives in the Keychain/Keystore, never in AsyncStorage (docs/mobile/02). */
import * as SecureStore from "expo-secure-store";

const KEY = "retro.session";
let memory: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (memory !== undefined) return memory;
  try {
    memory = await SecureStore.getItemAsync(KEY);
  } catch {
    memory = null;
  }
  return memory;
}

export async function setToken(token: string | null): Promise<void> {
  memory = token;
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* Keychain unavailable: the in-memory token still lasts for this launch. */
  }
}
