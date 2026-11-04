import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { RefreshControl, ScrollView } from "react-native";
import { AGENCY_TURN } from "@retro/core/quote-workflow";
import { useAuth } from "@/features/auth/AuthProvider";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { inr, timeAgo } from "@/lib/format";
import { space, useTheme } from "@/theme";
import { Button, Card, Empty, ErrorBox, Loading, Row, StatusPill, Text } from "@/ui";

export default function Queue() {
  const { isStaff } = useAuth();
  const c = useTheme();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({ queryKey: ["staff-requests"], queryFn: api.staff.requests, enabled: isStaff, refetchInterval: 30_000 });
  // Server-enforced; this guard only keeps a non-staff user from landing on an empty screen.
  if (!isStaff) return <Redirect href="/" />;
  if (isLoading) return <Loading />;

  const waiting = data?.filter((r) => AGENCY_TURN.includes(r.status)) ?? [];
  const rest = data?.filter((r) => !AGENCY_TURN.includes(r.status)) ?? [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.lg, gap: space.md }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}>
      <Button label="Leads" kind="secondary" onPress={() => router.push("/staff/leads")} />
      {error ? <ErrorBox message={messageOf(error)} onRetry={() => void refetch()} /> : null}
      {data?.length === 0 ? <Empty title="Queue is clear" body="New requests appear here and you get a notification." /> : null}
      {waiting.length ? <Text variant="label" dim>Waiting on us ({waiting.length})</Text> : null}
      {waiting.map((r) => <Item key={r.id} r={r} />)}
      {rest.length ? <Text variant="label" dim>Everything else</Text> : null}
      {rest.map((r) => <Item key={r.id} r={r} />)}
    </ScrollView>
  );
}

function Item({ r }: { r: NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.staff.requests>>>>["data"]>[number] }) {
  return (
    <Card onPress={() => router.push({ pathname: "/staff/[id]", params: { id: r.id } })}>
      <Row between><StatusPill status={r.status} /><Text variant="small" dim>{timeAgo(r.updatedAt)}</Text></Row>
      <Text variant="heading">{r.destinationSummary}</Text>
      <Text dim>{r.travellerName ?? r.travellerEmail ?? ""} · {r.nights} nights · {inr(r.quotedTotalInr ?? r.totalInr)}</Text>
    </Card>
  );
}
