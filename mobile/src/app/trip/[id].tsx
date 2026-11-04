import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { View } from "react-native";
import { priceQuote } from "@retro/core/quote-pricing";
import { STATUS_COPY, isFinished, type RequestEvent } from "@retro/core/quote-workflow";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { inr, shortDate, timeAgo } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";
import { Button, Card, Chip, ChipRow, ErrorBox, Field, Loading, Row, Screen, StatusPill, Text } from "@/ui";

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const c = useTheme();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["request", id], queryFn: () => api.requests.get(id), refetchInterval: 20_000 });

  const [picked, setPicked] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<null | "changes" | "decline">(null);
  // One idempotency key per user action; it changes only after that action succeeded.
  const keys = useRef<Record<string, string>>({});
  const keyFor = (action: string) => (keys.current[action] ??= api.key());
  const done = (action: string) => { delete keys.current[action]; void qc.invalidateQueries({ queryKey: ["request", id] }); void qc.invalidateQueries({ queryKey: ["requests"] }); };

  const act = useMutation({
    mutationFn: async (a: "accept" | "changes" | "decline" | "cancel" | "message" | "pay") => {
      if (!data) return;
      const k = keyFor(a);
      if (a === "accept" && data.quote) await api.requests.accept(id, data.quote.revisionId, picked, k);
      if (a === "changes") await api.requests.requestChanges(id, text.trim(), k);
      if (a === "decline") await api.requests.decline(id, text.trim() || undefined, k);
      if (a === "cancel") await api.requests.cancel(id, k);
      if (a === "message") await api.requests.message(id, text.trim(), k);
      if (a === "pay") {
        const back = Linking.createURL("pay-result");
        const { payUrl } = await api.requests.pay(id, back);
        // The redirect is only a hint that the browser closed; the server's record of the payment is the truth.
        await WebBrowser.openAuthSessionAsync(payUrl, back);
      }
      return a;
    },
    onSuccess: (a) => { if (!a) return; done(a); if (a !== "accept" && a !== "pay") setText(""); setMode(null); },
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <Screen><ErrorBox message={messageOf(error)} onRetry={() => void refetch()} /></Screen>;

  const copy = STATUS_COPY[data.status];
  const quote = data.quote;
  const priced = quote ? priceQuote(quote.view.packageInr, { fixedPackageInr: null, lines: quote.view.lines, depositInr: quote.view.depositInr }, picked) : null;
  const optional = quote?.view.lines.filter((l) => l.optional) ?? [];
  const canAccept = data.status === "quoted" && Boolean(quote?.current);
  const payable = (data.status === "accepted" || data.status === "part_paid") && data.payment.nextInr > 0 && data.payment.configured;
  const open = !isFinished(data.status);

  return (
    <Screen>
      <StatusPill status={data.status} />
      <Text variant="title">{data.destinationSummary}</Text>
      <Text dim>{data.nights} nights{data.startDate ? ` · from ${shortDate(data.startDate)}` : ""}</Text>
      <Text>{copy.traveller}</Text>

      {quote && priced ? (
        <Card>
          <Row between><Text variant="label" dim>Quote v{quote.version}</Text>{quote.view.validUntil ? <Text variant="small" dim>valid until {shortDate(quote.view.validUntil)}</Text> : null}</Row>
          <Text variant="title">{inr(canAccept ? priced.totalInr : (data.acceptance?.totalInr ?? priced.totalInr))}</Text>
          {quote.view.breakdown.map((b) => (
            <Row key={b.key} between><Text dim>{b.label}</Text><Text>{inr(b.amountInr)}</Text></Row>
          ))}
          {quote.view.lines.filter((l) => !l.optional).map((l) => (
            <Row key={l.id} between><Text dim>{l.label}</Text><Text>{l.amountInr < 0 ? "−" : ""}{inr(Math.abs(l.amountInr))}</Text></Row>
          ))}
          {quote.view.note ? <Text variant="small" dim>“{quote.view.note}”</Text> : null}
          {canAccept && optional.length ? (
            <>
              <Text variant="label" dim>Optional extras</Text>
              <ChipRow>
                {optional.map((l) => (
                  <Chip key={l.id} label={`${l.label} +${inr(l.amountInr)}`} selected={picked.includes(l.id)} onPress={() => setPicked((p) => (p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id]))} />
                ))}
              </ChipRow>
            </>
          ) : null}
          {canAccept && quote.view.depositInr != null && priced.dueNowInr < priced.totalInr ? <Text variant="small" dim>Pay {inr(priced.dueNowInr)} now to confirm; the rest is due later.</Text> : null}
        </Card>
      ) : null}

      {canAccept ? (
        <Card>
          <Chip label={agreed ? "✓ I have read and accept this quote" : "I have read and accept this quote"} selected={agreed} onPress={() => setAgreed(!agreed)} />
          <Button label={`Accept and continue${priced ? ` · ${inr(priced.totalInr)}` : ""}`} disabled={!agreed} busy={act.isPending && act.variables === "accept"} onPress={() => act.mutate("accept")} />
          <Row><View style={{ flex: 1 }}><Button label="Ask for changes" kind="secondary" onPress={() => setMode(mode === "changes" ? null : "changes")} /></View><View style={{ flex: 1 }}><Button label="Decline" kind="danger" onPress={() => setMode(mode === "decline" ? null : "decline")} /></View></Row>
          {mode ? (
            <>
              <Field label={mode === "changes" ? "What should we change?" : "Reason (optional)"} value={text} onChangeText={setText} multiline maxLength={mode === "changes" ? 1000 : 500} />
              <Button label={mode === "changes" ? "Send change request" : "Decline quote"} kind={mode === "changes" ? "primary" : "danger"} disabled={mode === "changes" && text.trim().length < 3} busy={act.isPending} onPress={() => act.mutate(mode)} />
            </>
          ) : null}
        </Card>
      ) : null}

      {payable ? (
        <Card>
          <Text variant="heading">{data.payment.paidInr > 0 ? "Balance due" : "Pay to confirm"}</Text>
          <Text dim>Secure payment by Razorpay (UPI, cards, netbanking) opens in a browser. Your booking updates here when it clears.</Text>
          <Button label={`Pay ${inr(data.payment.nextInr)}`} busy={act.isPending && act.variables === "pay"} onPress={() => act.mutate("pay")} />
        </Card>
      ) : null}
      {(data.status === "accepted" || data.status === "part_paid") && !data.payment.configured ? <Text dim>Online payment is not available right now. Message us and we will arrange it.</Text> : null}
      {data.payment.paidInr > 0 ? <Text color={c.success}>Paid {inr(data.payment.paidInr)}{data.payment.balanceInr > 0 ? ` · ${inr(data.payment.balanceInr)} to go` : " · fully paid"}</Text> : null}

      {act.error ? <ErrorBox message={messageOf(act.error)} /> : null}

      <Text variant="label" dim>Conversation</Text>
      {data.events.length === 0 ? <Text dim>Nothing yet.</Text> : null}
      {[...data.events].reverse().map((e) => <EventRow key={e.id} e={e} />)}

      {open ? (
        <Card>
          {mode ? null : (
            <>
              <Field label="Message the team" value={text} onChangeText={setText} multiline maxLength={1000} placeholder="Ask a question — it won't change your quote." />
              <Button label="Send message" disabled={text.trim().length === 0} busy={act.isPending && act.variables === "message"} onPress={() => act.mutate("message")} />
            </>
          )}
          {data.status === "pending" || data.status === "in_review" || data.status === "changes_requested" ? <Button label="Withdraw request" kind="danger" onPress={() => act.mutate("cancel")} /> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function EventRow({ e }: { e: RequestEvent }) {
  const c = useTheme();
  const mine = e.actor === "traveller";
  const isMessage = e.type === "message";
  if (!isMessage) {
    return <Text variant="small" dim style={{ textAlign: "center" }}>{e.summary} · {timeAgo(e.createdAt)}</Text>;
  }
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", backgroundColor: mine ? c.accent : c.surfaceHi, borderRadius: radius.lg, padding: space.md, gap: 2 }}>
      <Text color={mine ? c.onAccent : c.text}>{e.summary}</Text>
      <Text variant="small" color={mine ? c.onAccent : c.textDim}>{mine ? "You" : "Retro Holidays"} · {timeAgo(e.createdAt)}</Text>
    </View>
  );
}
