import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { STATUS_COPY, type RequestEvent } from "@retro/core/quote-workflow";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { inr, timeAgo } from "@/lib/format";
import { Button, Card, ErrorBox, Field, Loading, Row, Screen, StatusPill, Text } from "@/ui";
import { useTheme } from "@/theme";

/** S1/S2 (docs/mobile/07): read the request, answer the traveller, keep private notes. Pricing edits stay on the web editor until S3. */
export default function StaffRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["staff-request", id], queryFn: () => api.staff.request(id), refetchInterval: 20_000 });
  const [text, setText] = useState("");
  const keys = useRef<Record<string, string>>({});

  const act = useMutation({
    mutationFn: async (a: "reply" | "note" | "review") => {
      const k = (keys.current[a] ??= api.key());
      if (a === "reply") await api.staff.reply(id, text.trim(), k);
      if (a === "note") await api.staff.note(id, text.trim());
      if (a === "review") await api.staff.startReview(id);
      return a;
    },
    onSuccess: (a) => { delete keys.current[a]; setText(""); void qc.invalidateQueries({ queryKey: ["staff-request", id] }); void qc.invalidateQueries({ queryKey: ["staff-requests"] }); },
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <Screen><ErrorBox message={messageOf(error)} onRetry={() => void refetch()} /></Screen>;

  return (
    <Screen>
      <StatusPill status={data.status} />
      <Text variant="title">{data.destinationSummary}</Text>
      <Text dim>{STATUS_COPY[data.status].label} · {data.nights} nights · estimate {inr(data.totalInr)}</Text>
      <Card>
        <Text variant="label" dim>Traveller</Text>
        <Text>{data.contact.name}</Text>
        <Text dim>{data.contact.email}{data.contact.phone ? ` · ${data.contact.phone}` : ""}</Text>
        {data.contact.note ? <Text variant="small">“{data.contact.note}”</Text> : null}
      </Card>
      {data.status === "pending" ? <Button label="Start preparing the quote" onPress={() => act.mutate("review")} busy={act.isPending && act.variables === "review"} /> : null}
      {data.quote ? <Text>Latest quote v{data.quote.version}: {inr(data.quote.baseTotalInr)}{data.quote.current ? " (sent)" : ""}</Text> : null}
      <Text variant="small" dim>To change prices or send a new quote revision, open this request in the web admin.</Text>

      <Text variant="label" dim>Conversation</Text>
      {[...data.events].reverse().map((e: RequestEvent) => (
        <Text key={e.id} color={e.internal ? c.textDim : c.text} variant={e.type === "message" ? "body" : "small"}>
          {e.internal ? "🔒 " : e.actor === "traveller" ? "Traveller: " : e.actor === "agency" ? "Us: " : ""}{e.summary} · {timeAgo(e.createdAt)}
        </Text>
      ))}

      <Card>
        <Field label="Reply or private note" value={text} onChangeText={setText} multiline maxLength={1000} />
        <Row>
          <Button label="Reply to traveller" disabled={!text.trim()} busy={act.isPending && act.variables === "reply"} onPress={() => act.mutate("reply")} />
          <Button label="Private note" kind="secondary" disabled={!text.trim()} busy={act.isPending && act.variables === "note"} onPress={() => act.mutate("note")} />
        </Row>
        {act.error ? <ErrorBox message={messageOf(act.error)} /> : null}
      </Card>
    </Screen>
  );
}
