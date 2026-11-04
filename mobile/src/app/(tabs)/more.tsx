import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { useAuth } from "@/features/auth/AuthProvider";
import { api } from "@/lib/api";
import { SITE_URL, WHATSAPP, APP_VERSION } from "@/lib/env";
import { messageOf } from "@/lib/errors";
import { Button, Card, ErrorBox, Field, Screen, Text } from "@/ui";

const LEGAL = [["Privacy policy", "/privacy-policy"], ["Terms of service", "/terms"], ["Refund policy", "/refund-policy"], ["Cancellation policy", "/cancellation-policy"], ["Delete my data", "/data-deletion"]] as const;

export default function More() {
  const { user, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setError(null);
    try {
      await api.auth.deleteAccount(password || undefined);
      await signOut();
      Alert.alert("Account deleted", "Your personal details have been removed.");
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Screen>
      <Card>
        <Text variant="heading">{user ? user.name : "You're browsing as a guest"}</Text>
        {user ? <Text dim>{user.email}</Text> : null}
        {user ? <Button label="Sign out" kind="secondary" onPress={() => void signOut()} /> : <Button label="Sign in or create account" onPress={() => router.push("/auth")} />}
      </Card>

      <Card>
        <Text variant="heading">Talk to us</Text>
        <Button label="Answer a few questions" onPress={() => router.push("/chat")} />
        <Button label="WhatsApp" kind="secondary" onPress={() => void Linking.openURL(`https://wa.me/${WHATSAPP}`)} />
        <Button label="Call" kind="secondary" onPress={() => void Linking.openURL("tel:+919804786498")} />
      </Card>

      <Card>
        <Text variant="heading">Policies</Text>
        {LEGAL.map(([label, path]) => <Button key={path} label={label} kind="secondary" onPress={() => void Linking.openURL(`${SITE_URL}${path}`)} />)}
      </Card>

      {user ? (
        <Card>
          <Text variant="heading">Delete account</Text>
          <Text dim>Removes your name, contact details and messages. Payment records stay for accounting. A booking in progress must be settled first.</Text>
          {confirming ? (
            <>
              <Field label="Password (if you set one)" value={password} onChangeText={setPassword} secureTextEntry />
              {error ? <ErrorBox message={error} /> : null}
              <Button label="Permanently delete my account" kind="danger" onPress={() => void deleteAccount()} />
            </>
          ) : (
            <Button label="Delete my account" kind="danger" onPress={() => setConfirming(true)} />
          )}
        </Card>
      ) : null}
      <Text variant="small" dim style={{ textAlign: "center" }}>Retro Holidays {APP_VERSION}</Text>
    </Screen>
  );
}
