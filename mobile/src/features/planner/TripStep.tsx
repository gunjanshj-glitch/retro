import { ScrollView, View } from "react-native";
import { useEffect, useMemo } from "react";
import { Chip, ChipRow, Text } from "@/ui";
import { space, useTheme } from "@/theme";
import { useCatalogueState } from "@/features/catalogue/CatalogueProvider";
import { getBounds, openCatalogue } from "@/features/catalogue/data";
import { Pick, Section, Stepper } from "./controls";
import { usePlanner } from "./state";

const WHO = [
  { value: "couple", label: "Couple" }, { value: "family", label: "Family" }, { value: "friends", label: "Friends" },
  { value: "solo", label: "Solo" }, { value: "stags", label: "Stag / hen" }, { value: "pilgrimage", label: "Pilgrimage" }, { value: "business", label: "Business" },
] as const;
const STYLE_FOR: Record<string, string> = { family: "family", couple: "romantic", friends: "adventure", stags: "adventure", business: "luxury", pilgrimage: "pilgrimage", solo: "culture" };
const CITIES = [["DEL", "Delhi"], ["BOM", "Mumbai"], ["MAA", "Chennai"], ["BLR", "Bengaluru"], ["HYD", "Hyderabad"], ["CCU", "Kolkata"], ["COK", "Kochi"], ["AMD", "Ahmedabad"], ["PNQ", "Pune"], ["GOI", "Goa"]] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

export function TripStep() {
  const c = useTheme();
  const { local } = useCatalogueState();
  const { request, patch } = usePlanner();
  const catalogue = useMemo(() => (local ? openCatalogue(local) : null), [local]);

  // How long these places realistically take for this kind of party: the same rules the website's slider uses.
  const boundsFor = (travellerType: string, tripStyle: string) =>
    local && catalogue && request.placeIds.length
      ? getBounds(local).computeNightsBounds(catalogue.core, request.placeIds, { travellerType, tripStyle } as never)
      : null;
  const bounds = useMemo(() => boundsFor(request.travellerType, request.tripStyle), [local, catalogue, request.placeIds, request.travellerType, request.tripStyle]); // eslint-disable-line react-hooks/exhaustive-deps
  const minNights = bounds?.min || 1;
  const maxNights = Math.max(bounds?.max || 28, minNights);
  const shownNights = Math.min(Math.max(request.nights, minNights), maxNights);
  // Pricing bills the request, not the display, so write a clamped length back (never touched otherwise: the
  // length changes only when the traveller changes it, or changes who is travelling).
  useEffect(() => {
    if (shownNights !== request.nights) patch({ nights: shownNights, nightOverrides: {} });
  }, [shownNights, request.nights, patch]);

  const [y, m, d] = request.startDate.split("-").map(Number) as [number, number, number];
  const now = new Date();
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // How good a month is for the places chosen, averaged: the same score the quote's seasonality warnings use.
  const monthScore = (month1: number) => {
    const sums = (catalogue?.core.placeSummaries ?? []).filter((s) => request.placeIds.includes(s.placeId)).map((s) => s.monthOverall?.[String(month1)]).filter((v): v is number => typeof v === "number");
    return sums.length ? Math.round(sums.reduce((a, b) => a + b, 0) / sums.length) : null;
  };
  const verdict = (n: number | null) => (n == null ? null : n >= 75 ? { t: "A great time to go", col: c.success } : n >= 55 ? { t: "A fair time to go", col: c.accent } : { t: "Not the best season here", col: c.danger });
  const v = verdict(monthScore(m));

  const setDate = (yy: number, mm: number, dd: number) => {
    const clamped = Math.min(dd, daysIn(yy, mm - 1));
    const iso = `${yy}-${pad(mm)}-${pad(clamped)}`;
    const min = new Date(); min.setDate(min.getDate() + 1);
    patch({ startDate: iso < min.toISOString().slice(0, 10) ? min.toISOString().slice(0, 10) : iso });
  };

  const children = request.childAges;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
      <Text variant="title">When and who</Text>

      <Section title="Month" hint="Seasonal score for your places">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {months.map((dt) => {
            const mm = dt.getMonth() + 1;
            return <Chip key={`${dt.getFullYear()}-${mm}`} label={`${MONTHS[mm - 1]} ${String(dt.getFullYear()).slice(2)}`} selected={y === dt.getFullYear() && m === mm} onPress={() => setDate(dt.getFullYear(), mm, d)} />;
          })}
        </ScrollView>
        {v ? <Text variant="small" color={v.col}>{v.t} ({monthScore(m)}/100)</Text> : null}
        <Stepper label="Day" value={d} min={1} max={daysIn(y, m - 1)} onChange={(n) => setDate(y, m, n)} />
      </Section>

      <Section title="Length of trip">
        <Stepper label="Nights" value={shownNights} min={minNights} max={maxNights} suffix="nights" onChange={(n) => patch({ nights: n, nightOverrides: {} })} />
        {bounds ? (
          <Text variant="small" color={c.textDim}>
            {bounds.min}–{bounds.max} is realistic for {request.placeIds.length} destination{request.placeIds.length === 1 ? "" : "s"} · {bounds.recommended} recommended.{bounds.profileNote ? ` ${bounds.profileNote}` : ""}
          </Text>
        ) : null}
      </Section>

      <Section title="Who is going">
        <Pick options={WHO as unknown as { value: string; label: string }[]} value={request.travellerType} onChange={(t) => {
          // Who is travelling changes how long the same places take: suggest the new length, as the website does.
          const recommended = boundsFor(t, STYLE_FOR[t] as string)?.recommended;
          patch({ travellerType: t as typeof request.travellerType, tripStyle: STYLE_FOR[t] as typeof request.tripStyle, ...(recommended ? { nights: recommended, nightOverrides: {} } : {}) });
        }} />
        <Stepper label="Adults" value={request.adults} min={1} max={20} onChange={(n) => patch({ adults: n, rooms: undefined })} />
        <Stepper label="Children" value={children.length} min={0} max={8} onChange={(n) => patch({ childAges: n > children.length ? [...children, 8] : children.slice(0, n), rooms: undefined })} />
        {children.map((age, i) => (
          <View key={i} style={{ gap: space.xs }}>
            <Stepper label={`Child ${i + 1} age`} value={age} min={0} max={17} onChange={(n) => patch({ childAges: children.map((a, j) => (j === i ? n : a)) })} />
          </View>
        ))}
        {children.length ? <Text variant="small" dim>Ages set room needs and activity prices.</Text> : null}
      </Section>

      <Section title="Flying from">
        <ChipRow>
          {CITIES.map(([code, label]) => <Chip key={code} label={label} selected={request.departureCity === code} onPress={() => patch({ departureCity: code })} />)}
        </ChipRow>
      </Section>
    </ScrollView>
  );
}
