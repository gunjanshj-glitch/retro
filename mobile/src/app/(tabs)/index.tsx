import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import { type PackageCard, fetchPackages } from "@/features/packages/data";
import { SITE_URL } from "@/lib/env";
import { inr } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";
import { Button, Card, ErrorBox, Loading, Text } from "@/ui";

export default function Explore() {
  const c = useTheme();
  const [q, setQ] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["packages"], queryFn: fetchPackages, staleTime: 6 * 3600_000 });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((p) => !needle || `${p.name} ${p.tagline ?? ""} ${p.destinationSlug}`.toLowerCase().includes(needle));
  }, [data, q]);

  if (isLoading) return <Loading />;
  if (error) return <View style={{ padding: space.lg }}><ErrorBox message="Could not load packages. Check your connection." onRetry={() => void refetch()} /></View>;

  return (
    <FlatList<PackageCard>
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      data={shown}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <Text variant="title">Where to next?</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="Search Kerala, Egypt, Bali…" placeholderTextColor={c.textDim} accessibilityLabel="Search packages" style={{ backgroundColor: c.surface, color: c.text, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12, fontSize: 16, borderColor: c.border, borderWidth: 1 }} />
          <Button label="Plan your own trip" onPress={() => router.push("/plan")} />
          <Button label="Not sure? Talk to us" kind="secondary" onPress={() => router.push("/chat")} />
        </View>
      }
      ListEmptyComponent={<Text dim>No packages match “{q}”.</Text>}
      renderItem={({ item }) => (
        <Card onPress={() => router.push({ pathname: "/package/[id]", params: { id: item.id } })} style={{ padding: 0, overflow: "hidden" }}>
          <Image source={{ uri: `${SITE_URL}${item.coverImage}` }} style={{ height: 170, width: "100%" }} contentFit="cover" transition={150} accessibilityLabel={item.name} />
          <View style={{ padding: space.lg, gap: space.xs }}>
            <Text variant="heading">{item.name}</Text>
            <Text variant="small" dim numberOfLines={2}>{item.tagline ?? ""}</Text>
            <Text color={c.accent} style={{ fontWeight: "700" }}>
              from {inr(item.priceFromInr)} per person{item.priceIncludesFlight ? "" : " · flights extra"}
            </Text>
          </View>
        </Card>
      )}
    />
  );
}
