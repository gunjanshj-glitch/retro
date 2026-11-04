import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/features/auth/AuthProvider";
import { fetchPackages } from "@/features/packages/data";
import { api } from "@/lib/api";
import { SITE_URL } from "@/lib/env";
import { messageOf } from "@/lib/errors";
import { inr } from "@/lib/format";
import { registerForPush } from "@/lib/push";
import { space } from "@/theme";
import { Button, Card, Chip, ChipRow, ErrorBox, Field, Loading, Screen, Text } from "@/ui";

const TRIP_TYPES = ["couple", "family", "friends", "solo", "pilgrimage", "business"] as const;
const HOTELS = ["3 Star", "4 Star", "5 Star", "Luxury 5 Star"] as const;

export default function PackageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["packages"], queryFn: fetchPackages });
  const pkg = data?.find((p) => p.id === id);

  const [tripType, setTripType] = useState<(typeof TRIP_TYPES)[number]>("couple");
  const [hotel, setHotel] = useState<(typeof HOTELS)[number]>("4 Star");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per form: a retry after a dropped connection can never create a second request.
  const [key] = useState(() => api.key());

  if (isLoading) return <Loading />;
  if (!pkg) return <Screen><Text>That package is no longer available.</Text></Screen>;

  async function submit() {
    if (!pkg) return;
    if (!user) return router.push("/auth");
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return setError("Enter the date as YYYY-MM-DD, or leave it empty if undecided.");
    setBusy(true);
    setError(null);
    try {
      await api.packageRequests.create(
        { destinationSlug: pkg.destinationSlug, packageSlug: pkg.slug, destinationName: pkg.destinationSlug.replace(/-/g, " "), packageName: pkg.name, tripType, adults, children, startDate: startDate || null, hotelStar: hotel, food: "no-preference", includeFlights: !pkg.priceIncludesFlight ? false : true, notes: notes || null },
        key,
      );
      void registerForPush().catch(() => {});
      router.replace("/(tabs)/trips");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: pkg.name }} />
      <Image source={{ uri: `${SITE_URL}${pkg.coverImage}` }} style={{ height: 210, borderRadius: 14 }} contentFit="cover" accessibilityLabel={pkg.name} />
      <Text variant="title">{pkg.name}</Text>
      <Text dim>{pkg.nights} nights · {pkg.days} days</Text>
      <Text>{pkg.tagline}</Text>
      <Text style={{ fontWeight: "700" }}>from {inr(pkg.priceFromInr)} per person{pkg.priceIncludesFlight ? "" : " (flights extra)"}</Text>

      <Card>
        <Text variant="heading">Ask for a final quote</Text>
        <Text variant="small" dim>An expert checks every rate and sends you a priced quote here. Nothing is charged until you accept it.</Text>
        <Text variant="label" dim>Trip type</Text>
        <ChipRow>{TRIP_TYPES.map((t) => <Chip key={t} label={t} selected={tripType === t} onPress={() => setTripType(t)} />)}</ChipRow>
        <Text variant="label" dim>Hotel</Text>
        <ChipRow>{HOTELS.map((h) => <Chip key={h} label={h} selected={hotel === h} onPress={() => setHotel(h)} />)}</ChipRow>
        <View style={{ flexDirection: "row", gap: space.lg }}>
          <Stepper label="Adults" value={adults} min={1} max={40} onChange={setAdults} />
          <Stepper label="Children" value={children} min={0} max={20} onChange={setChildren} />
        </View>
        <Field label="Start date (optional)" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        <Field label="Anything we should know?" value={notes} onChangeText={setNotes} multiline maxLength={1000} />
        {error ? <ErrorBox message={error} /> : null}
        <Button label={user ? "Send request" : "Sign in to send request"} onPress={() => void submit()} busy={busy} />
      </Card>
    </Screen>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Text variant="label" dim>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Chip label="−" onPress={() => onChange(Math.max(min, value - 1))} />
        <Text variant="heading">{value}</Text>
        <Chip label="+" onPress={() => onChange(Math.min(max, value + 1))} />
      </View>
    </View>
  );
}
