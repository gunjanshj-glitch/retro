import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { RefreshControl, ScrollView } from "react-native";
import { useAuth } from "@/features/auth/AuthProvider";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { inr, shortDate, timeAgo } from "@/lib/format";
import { space, useTheme } from "@/theme";
import { Button, Card, Empty, ErrorBox, Loading, Row, StatusPill, Text } from "@/ui";

export default function Trips() {
  const { user } = useAuth();
  const c = useTheme();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({ queryKey: ["requests"], queryFn: api.requests.list, enabled: Boolean(user) });

  const pkgs = useQuery({ queryKey: ["package-requests"], queryFn: api.packageRequests.list, enabled: Boolean(user) });

  if (!user) return <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg }}><Empty title="Your trips live here" body="Sign in to send a request and follow your quote, chat with us and pay securely." action={<Button label="Sign in" onPress={() => router.push("/auth")} />} /></ScrollView>;
  if (isLoading) return <Loading />;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.lg, gap: space.md }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); void pkgs.refetch(); }} />}>
      {error ? <ErrorBox message={messageOf(error)} onRetry={() => void refetch()} /> : null}
      {data?.length === 0 && !pkgs.data?.length ? <Empty title="No trips yet" body="Plan a trip and get a live estimate, or pick a package. We reply here." action={<Button label="Plan a trip" onPress={() => router.push("/plan")} />} /> : null}
      {data?.map((r) => (
        <Card key={r.id} onPress={() => router.push({ pathname: "/trip/[id]", params: { id: r.id } })}>
          <Row between>
            <StatusPill status={r.status} />
            {r.needsAction ? <Text variant="label" color={c.accent}>Your move</Text> : null}
          </Row>
          <Text variant="heading">{r.destinationSummary}</Text>
          <Text variant="small" dim>{r.nights} nights{r.startDate ? ` · from ${shortDate(r.startDate)}` : ""} · updated {timeAgo(r.updatedAt)}</Text>
          <Text style={{ fontWeight: "700" }}>{r.quotedTotalInr != null ? `Quote ${inr(r.quotedTotalInr)}` : `Estimate ${inr(r.totalInr)}`}</Text>
        </Card>
      ))}
      {pkgs.data?.length ? <Text variant="label" dim>Package requests</Text> : null}
      {pkgs.data?.map((p) => (
        <Card key={p.id}>
          <Text variant="small" dim>{p.status === "quoted" ? "Quote ready" : p.status === "closed" ? "Closed" : "With our experts"}</Text>
          <Text variant="heading">{p.packageName}</Text>
          <Text variant="small" dim>{p.adults + p.children} travellers{p.startDate ? ` · from ${shortDate(p.startDate)}` : ""}</Text>
          {p.quote ? <Text style={{ fontWeight: "700" }}>{inr(p.quote.amountInr)}{p.quote.note ? ` · ${p.quote.note}` : ""}</Text> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
