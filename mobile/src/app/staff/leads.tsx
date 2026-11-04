import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { Button, Card, Empty, ErrorBox, Loading, Screen, Text } from "@/ui";

export default function Leads() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["staff-leads"], queryFn: api.staff.enquiries });
  if (isLoading) return <Loading />;
  return (
    <Screen>
      {error ? <ErrorBox message={messageOf(error)} onRetry={() => void refetch()} /> : null}
      {data?.length === 0 ? <Empty title="No leads yet" body="Chat and contact-form enquiries appear here." /> : null}
      {data?.map((l) => (
        <Card key={l.id}>
          <Text variant="small" dim>{l.source ?? "enquiry"} · {timeAgo(l.createdAt)}</Text>
          <Text variant="heading">{l.name}</Text>
          <Text dim>{[l.destination, l.travelWindow, l.travellers].filter(Boolean).join(" · ")}</Text>
          {l.notes ? <Text variant="small">{l.notes}</Text> : null}
          {l.phone ? <Button label={`Call ${l.phone}`} kind="secondary" onPress={() => void Linking.openURL(`tel:${l.phone}`)} /> : null}
          {l.phone ? <Button label="WhatsApp" kind="secondary" onPress={() => void Linking.openURL(`https://wa.me/${l.phone!.replace(/\D/g, "")}`)} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
