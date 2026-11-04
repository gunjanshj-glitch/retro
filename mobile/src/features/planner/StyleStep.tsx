import { ScrollView } from "react-native";
import { Text } from "@/ui";
import { space } from "@/theme";
import { Pick, Section, Toggle } from "./controls";
import { usePlanner } from "./state";

const STYLES = ["romantic", "honeymoon", "family", "luxury", "adventure", "culture", "budget", "pilgrimage"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));
const NATIONS = [["IND", "India"], ["USA", "United States"], ["GBR", "United Kingdom"], ["ARE", "UAE"], ["CAN", "Canada"], ["AUS", "Australia"], ["SGP", "Singapore"], ["NPL", "Nepal"], ["LKA", "Sri Lanka"], ["BGD", "Bangladesh"]].map(([value, label]) => ({ value: value!, label: label! }));

export function StyleStep() {
  const { request, patch } = usePlanner();
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: 140 }}>
      <Text variant="title">Your kind of trip</Text>
      <Section title="Style"><Pick options={STYLES} value={request.tripStyle} onChange={(v) => patch({ tripStyle: v as typeof request.tripStyle })} /></Section>
      <Section title="Pace"><Pick options={[{ value: "relaxed", label: "Relaxed" }, { value: "balanced", label: "Balanced" }, { value: "packed", label: "Packed" }]} value={request.pace} onChange={(v) => patch({ pace: v })} /></Section>
      <Section title="Hotels"><Pick options={[{ value: "3 Star", label: "3 star" }, { value: "4 Star", label: "4 star" }, { value: "5 Star", label: "5 star" }, { value: "Luxury 5 Star", label: "Luxury" }]} value={request.hotelStar} onChange={(v) => patch({ hotelStar: v })} /></Section>
      <Section title="Location"><Pick options={[{ value: "Central", label: "Central" }, { value: "Outskirts", label: "Outskirts (cheaper)" }]} value={request.hotelZone} onChange={(v) => patch({ hotelZone: v })} /></Section>
      <Section title="Meals"><Pick options={[{ value: "breakfast", label: "Breakfast" }, { value: "half-board", label: "Half board" }, { value: "full-board", label: "Full board" }]} value={request.mealPlan} onChange={(v) => patch({ mealPlan: v })} /></Section>
      <Section title="Food"><Pick options={[{ value: "no-preference", label: "Anything" }, { value: "veg", label: "Veg" }, { value: "non-veg", label: "Non-veg" }, { value: "vegan", label: "Vegan" }, { value: "jain", label: "Jain" }, { value: "halal", label: "Halal" }]} value={request.food} onChange={(v) => patch({ food: v })} /></Section>
      <Section title="Getting between cities"><Pick options={[{ value: "cheapest", label: "Cheapest" }, { value: "balanced", label: "Balanced" }, { value: "fastest", label: "Fastest" }]} value={request.transportPreference} onChange={(v) => patch({ transportPreference: v })} /></Section>
      <Section title="Passport" hint="Visa needs depend on it"><Pick options={NATIONS} value={request.nationality} onChange={(v) => patch({ nationality: v })} /></Section>
      <Section title="Include in the price">
        <Toggle label="Return flights" hint="From your departure city. Off prices the land package alone." value={request.includeFlight} onChange={(v) => patch({ includeFlight: v })} />
        {request.includeFlight ? <Pick options={[{ value: "Economy", label: "Economy" }, { value: "Premium Economy", label: "Premium" }, { value: "Business", label: "Business" }]} value={request.cabin} onChange={(v) => patch({ cabin: v })} /> : null}
        <Toggle label="Visa support" value={request.includeVisa} onChange={(v) => patch({ includeVisa: v })} />
        <Toggle label="Travel insurance" value={request.includeInsurance} onChange={(v) => patch({ includeInsurance: v })} />
      </Section>
    </ScrollView>
  );
}
