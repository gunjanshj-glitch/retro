import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { evaluatePlaceSelectability } from "@retro/core/atlas/engine/bounds";
import { openCatalogue } from "@/features/catalogue/data";
import { useCatalogueState } from "@/features/catalogue/CatalogueProvider";
import { Button, Card, Chip, Text } from "@/ui";
import { radius, space, useTheme } from "@/theme";
import { usePlanner } from "./state";
import { inr } from "@/lib/format";

export function WhereStep({ onNext }: { onNext: () => void }) {
  const c = useTheme();
  const { local } = useCatalogueState();
  const { request, setPlaces, patch } = usePlanner();
  const catalogue = useMemo(() => (local ? openCatalogue(local) : null), [local]);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<string | null>(null);

  const core = catalogue?.core;
  const countryName = useMemo(() => new Map(core?.countries.map((x) => [x.id, x.name]) ?? []), [core]);
  const countryRegion = useMemo(() => new Map(core?.countries.map((x) => [x.id, x.regionId]) ?? []), [core]);
  const selectability = useMemo(() => (core ? evaluatePlaceSelectability(core, request.placeIds) : new Map()), [core, request.placeIds]);

  const rows = useMemo(() => {
    if (!core) return [];
    const q = query.trim().toLowerCase();
    return core.places
      .filter((p) => (!region || countryRegion.get(p.countryId) === region) && (!q || p.name.toLowerCase().includes(q) || (countryName.get(p.countryId) ?? "").toLowerCase().includes(q)))
      .sort((a, b) => Number(request.placeIds.includes(b.id)) - Number(request.placeIds.includes(a.id)) || a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [core, query, region, countryRegion, countryName, request.placeIds]);

  if (!core || !catalogue) return null;
  const selectedNames = request.placeIds.map((id) => core.places.find((p) => p.id === id)?.name).filter(Boolean) as string[];
  const toggle = (id: string) => setPlaces((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingBottom: space.md }}>
            <Text variant="title">Where to?</Text>
            <TextInput
              value={query} onChangeText={setQuery} placeholder="Search a city or country" placeholderTextColor={c.textDim}
              autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search places"
              style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, color: c.text, borderRadius: radius.md, paddingHorizontal: space.lg, height: 48, fontSize: 16 }}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              <Chip label="All" selected={!region} onPress={() => setRegion(null)} />
              {core.regions.map((r) => <Chip key={r.id} label={r.name} selected={region === r.id} onPress={() => setRegion(region === r.id ? null : r.id)} />)}
            </ScrollView>
            <Button label="Browse on map" kind="secondary" onPress={() => router.push("/map")} />
            {selectedNames.length ? (
              <View style={{ gap: space.xs }}>
                <Text variant="label" dim>Your route</Text>
                <Text>{selectedNames.join("  →  ")}</Text>
              </View>
            ) : (
              <View style={{ gap: space.sm }}>
                <Text variant="label" dim>Or start from a package</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                  {core.packages.filter((p) => p.placeIds.length).slice(0, 24).map((p) => (
                    <Card key={p.id} style={{ width: 200 }} onPress={() => { setPlaces(p.placeIds); patch({ nights: Math.max(1, p.nights) }); }}>
                      <Text numberOfLines={2} style={{ fontWeight: "700" }}>{p.name}</Text>
                      <Text variant="small" dim>{p.nights} nights · from {inr(p.priceFromInr)}</Text>
                    </Card>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const on = request.placeIds.includes(item.id);
          const s = selectability.get(item.id);
          const blocked = !on && s && !s.allowed;
          return (
            <Pressable
              onPress={() => !blocked && toggle(item.id)} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!blocked }}
              accessibilityLabel={`${item.name}, ${countryName.get(item.countryId) ?? ""}${blocked ? ". Not available with your current choices." : ""}`}
              style={{ minHeight: 56, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.surfaceHi : c.surface, opacity: blocked ? 0.45 : 1, justifyContent: "center" }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600" }}>{item.name}</Text>
                  <Text variant="small" dim>{blocked ? s?.reason : countryName.get(item.countryId)}</Text>
                </View>
                {on ? <Text color={c.accent} style={{ fontWeight: "700" }}>Added ✓</Text> : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text dim style={{ padding: space.lg }}>No places match “{query}”. Try a country name, or clear the region filter.</Text>}
      />
      <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
        <Button label={request.placeIds.length ? `Continue with ${request.placeIds.length} place${request.placeIds.length > 1 ? "s" : ""}` : "Pick at least one place"} disabled={!request.placeIds.length} onPress={onNext} />
      </View>
    </View>
  );
}
