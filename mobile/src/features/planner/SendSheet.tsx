import { router } from "expo-router";
import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { normalisePhone } from "@retro/chat-flow";
import type { Quotation } from "@retro/core/atlas/engine/types";
import { useAuth } from "@/features/auth/AuthProvider";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { inr } from "@/lib/format";
import { registerForPush } from "@/lib/push";
import { Button, Field, Text } from "@/ui";
import { space, useTheme } from "@/theme";
import { usePlanner } from "./state";

const NEXT = ["We read your trip and check live availability.", "You get a final quote in the app, with any changes we suggest.", "Ask for changes or accept it, then pay securely in the app."];

export function SendSheet({ quote, summary, visible, onClose }: { quote: Quotation; summary: string; visible: boolean; onClose: () => void }) {
  const c = useTheme();
  const { user } = useAuth();
  const { request, reset } = usePlanner();
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per send, kept across retries so a dropped connection can never create two requests.
  const [key] = useState(() => api.key());
  const [sentId, setSentId] = useState<string | null>(null);

  async function send() {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (phone.trim() && !normalisePhone(phone)) return setError("Enter a valid phone number, or leave it blank.");
    setBusy(true);
    try {
      const res = await api.requests.create(
        { request, quotation: quote, destinationSummary: summary, totals: { total: quote.totals.total, perPerson: quote.totals.perPerson }, contact: { email: email.trim(), phone: phone.trim() || undefined }, note: note.trim() || undefined },
        key,
      );
      setSentId(res.id);
      void registerForPush().catch(() => {});
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          {sentId ? (
            <>
              <Text variant="label" color={c.accent}>Request received</Text>
              <Text variant="title">We are on it</Text>
              {NEXT.map((s, i) => <Text key={s} dim>{i + 1}. {s}</Text>)}
              <Button label="Track this request" onPress={() => { onClose(); reset(); router.replace({ pathname: "/trip/[id]", params: { id: sentId } }); }} />
            </>
          ) : (
            <>
              <Text variant="label" color={c.accent}>Final quote</Text>
              <Text variant="title">Send this to our team</Text>
              <Text dim>{summary} · {inr(quote.totals.total)} estimate</Text>
              <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
              <Field label="Anything we should know? (optional)" value={note} onChangeText={setNote} multiline maxLength={1000} style={{ minHeight: 90, textAlignVertical: "top" }} />
              {error ? <Text color={c.danger}>{error}</Text> : null}
              <Button label="Send request" onPress={() => void send()} busy={busy} />
              <Button label="Cancel" kind="secondary" onPress={onClose} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
