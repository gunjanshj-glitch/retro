import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { messageOf } from "@/lib/errors";
import { Button, ErrorBox, Field, Screen, Text } from "@/ui";

WebBrowser.maybeCompleteAuthSession();

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export default function AuthScreen() {
  const { signIn, signUp, acceptSession } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => { api.auth.providers().then((p) => setGoogle(Boolean(p.google))).catch(() => {}); }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  const submit = () => run(async () => {
    if (mode === "up") await signUp(name.trim(), email.trim(), password);
    else await signIn(email.trim(), password);
    router.back();
  });

  const forgot = () => run(async () => {
    if (!email.includes("@")) throw new Error("Enter your email above first.");
    await api.auth.forgot(email.trim());
    setNote("If that address can sign in here, a reset link is on its way. Open it on this phone.");
  });

  /** Google through the system browser. The code that comes back is useless without the verifier that never left this app. */
  const withGoogle = () => run(async () => {
    const verifier = b64url(Crypto.getRandomBytes(32));
    const challenge = b64url(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(verifier))));
    const back = Linking.createURL("auth");
    const url = `${API_URL}/auth/google/start?client=mobile&redirect=${encodeURIComponent(back)}&code_challenge=${challenge}`;
    const result = await WebBrowser.openAuthSessionAsync(url, back);
    if (result.type !== "success") return;
    const params = new URL(result.url).searchParams;
    const code = params.get("code");
    if (!code) throw new Error("Google sign-in was cancelled.");
    const r = await api.auth.exchange(code, verifier);
    await acceptSession(r.token, r.user);
    router.back();
  });

  return (
    <Screen>
      <Text variant="title">{mode === "in" ? "Welcome back" : "Create your account"}</Text>
      <Text dim>You only need an account to request a quote and follow it here.</Text>
      {mode === "up" ? <Field label="Name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "up" ? "new-password" : "current-password"} textContentType={mode === "up" ? "newPassword" : "password"} />
      {error ? <ErrorBox message={error} /> : null}
      {note ? <Text color="#5fbf8a">{note}</Text> : null}
      <Button label={mode === "in" ? "Sign in" : "Create account"} onPress={() => void submit()} busy={busy} />
      {google ? <Button label="Continue with Google" kind="secondary" onPress={() => void withGoogle()} disabled={busy} /> : null}
      {mode === "in" ? <Button label="Forgot password?" kind="secondary" onPress={() => void forgot()} disabled={busy} /> : null}
      <Button label={mode === "in" ? "New here? Create an account" : "Have an account? Sign in"} kind="secondary" onPress={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }} />
    </Screen>
  );
}
