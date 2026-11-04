import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { evaluatePlaceSelectability } from "@retro/core/atlas/engine/bounds";
import { useCatalogueState } from "@/features/catalogue/CatalogueProvider";
import { openCatalogue } from "@/features/catalogue/data";
import { RegionCanvas } from "@/features/map/RegionCanvas";
import { buildPins, REGION_ASSET, type MapPin, type RegionMarkers } from "@/features/map/regions";
import { usePlanner } from "@/features/planner/state";
import { Button, Chip, Loading, Text } from "@/ui";
import { radius, space, useTheme } from "@/theme";

export default function MapScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { local } = useCatalogueState();
  const { request, setPlaces } = usePlanner();
  const catalogue = useMemo(() => (local ? openCatalogue(local) : null), [local]);
  const [regionId, setRegionId] = useState<string>("india");
  const [choices, setChoices] = useState<MapPin[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ country: string; nonce: number } | null>(null);

  const core = catalogue?.core;
  const regions = useMemo(() => (core ? core.regions.filter((r) => REGION_ASSET[r.id] && catalogue!.regionMarkers(REGION_ASSET[r.id]!)) : []), [core, catalogue]);

  const data = useMemo(() => {
    if (!catalogue || !core) return null;
    const asset = REGION_ASSET[regionId];
    const svg = asset ? catalogue.regionMapSvg(asset) : null;
    const markers = asset ? catalogue.regionMarkers<RegionMarkers>(asset) : null;
    if (!svg || !markers) return null;
    const placeByName = new Map(core.places.map((p) => [p.name.toLowerCase(), p]));
    return { svg, markers, pins: buildPins(markers, placeByName) };
  }, [catalogue, core, regionId]);

  const selectability = useMemo(() => (core ? evaluatePlaceSelectability(core, request.placeIds) : new Map()), [core, request.placeIds]);
  const selected = useMemo(() => new Set(request.placeIds), [request.placeIds]);
  const blocked = useMemo(() => new Set([...selectability.entries()].filter(([id, s]) => !s.allowed && !selected.has(id)).map(([id]) => id)), [selectability, selected]);

  const toggle = useCallback((pin: MapPin) => {
    if (!pin.place) { setFocus({ country: pin.marker.country, nonce: Date.now() }); return; }
    const id = pin.place.id;
    const s = selectability.get(id);
    if (!selected.has(id) && s && !s.allowed) { setNotice(s.reason ?? "That place can't be combined with your current choices."); return; }
    setNotice(null);
    setPlaces((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, [selectability, selected, setPlaces]);

  const onTap = useCallback((pins: MapPin[]) => {
    if (pins.length === 0) { setChoices(null); return; }
    if (pins.length === 1) { setChoices(null); toggle(pins[0]!); return; }
    setChoices(pins);
  }, [toggle]);

  if (!local || !core) return <View style={{ flex: 1, backgroundColor: c.bg }}><Loading /></View>;
  const names = request.placeIds.map((id) => core.places.find((p) => p.id === id)?.name).filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg }}>
          <Text variant="heading">Browse on map</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close map" onPress={() => router.back()} style={{ minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" }}>
            <Text color={c.accent} style={{ fontWeight: "700" }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {regions.map((r) => <Chip key={r.id} label={r.name} selected={regionId === r.id} onPress={() => { setRegionId(r.id); setChoices(null); setFocus(null); }} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        {data ? (
          <RegionCanvas key={regionId} svg={data.svg} markers={data.markers} pins={data.pins} selected={selected} blocked={blocked} onTap={onTap} focus={focus} />
        ) : (
          <Text dim style={{ padding: space.lg }}>This map is not available. Use the list instead.</Text>
        )}
        {notice ? (
          <View style={{ position: "absolute", left: space.lg, right: space.lg, top: space.sm, backgroundColor: c.surfaceHi, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: c.border }}>
            <Text variant="small">{notice}</Text>
          </View>
        ) : null}
      </View>

      {choices ? (
        <View style={{ backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.sm, borderTopWidth: 1, borderColor: c.border }}>
          <Text variant="heading">{choices.length} places here</Text>
          {choices.map((p) => {
            const on = !!p.place && selected.has(p.place.id);
            return (
              <Pressable key={p.key} accessibilityRole="button" onPress={() => { toggle(p); setChoices(null); }} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text>{p.place?.name ?? p.marker.label ?? p.marker.name}</Text>
                <Text color={c.accent} style={{ fontWeight: "700" }}>{!p.place ? "Zoom in" : on ? "Remove" : "Add"}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ padding: space.lg, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.sm, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
        <Text variant="small" dim numberOfLines={2}>{names.length ? names.join("  →  ") : "Tap a pin to add a place. Pinch to zoom."}</Text>
        <Button label={names.length ? `Done · ${names.length} selected` : "Back to the list"} onPress={() => router.back()} />
      </View>
    </View>
  );
}
