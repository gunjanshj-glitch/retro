import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button, Empty, Loading, Screen, Text } from "@/ui";
import { useCatalogueState } from "@/features/catalogue/CatalogueProvider";
import { QuoteView } from "@/features/planner/QuoteStep";
import { SendSheet } from "@/features/planner/SendSheet";
import { StyleStep } from "@/features/planner/StyleStep";
import { TripStep } from "@/features/planner/TripStep";
import { WhereStep } from "@/features/planner/WhereStep";
import { usePlanner, type Step } from "@/features/planner/state";
import { useQuote } from "@/features/planner/useQuote";
import { inr } from "@/lib/format";
import { space, useTheme } from "@/theme";

const ORDER: Step[] = ["where", "trip", "style", "quote"];
const LABEL: Record<Step, string> = { where: "Where", trip: "When & who", style: "Style", quote: "Quote" };

export default function Plan() {
  const c = useTheme();
  const { user } = useAuth();
  const { local } = useCatalogueState();
  const { request, step, setStep, restored, reset } = usePlanner();
  const [sendOpen, setSendOpen] = useState(false);
  // Price live while the traveller shapes the trip (the sticky bar), not only on the last screen.
  const { quote, pending, error, catalogue } = useQuote(request, step !== "where");

  const summary = useMemo(
    () => request.placeIds.map((id) => catalogue?.core.places.find((p) => p.id === id)?.name).filter(Boolean).join(", "),
    [catalogue, request.placeIds],
  );

  if (!local || !restored) return <Screen scroll={false}><Loading /></Screen>;
  const index = ORDER.indexOf(step);
  const go = (d: 1 | -1) => setStep(ORDER[Math.max(0, Math.min(ORDER.length - 1, index + d))]!);

  const body = step === "where" ? <WhereStep onNext={() => go(1)} /> : step === "trip" ? <TripStep /> : step === "style" ? <StyleStep /> : quote ? <QuoteView quote={quote} pending={pending} /> : error ? <Empty title="We could not price this trip" body={`${error}. Try a different combination of places or fewer nights.`} action={<Button label="Change the trip" onPress={() => setStep("where")} />} /> : <Loading />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Plan a trip", headerLeft: () => null }} />
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: space.lg, paddingTop: space.md }} accessibilityRole="progressbar" accessibilityLabel={`Step ${index + 1} of 4, ${LABEL[step]}`}>
        {ORDER.map((s, i) => <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= index ? c.accent : c.surfaceHi }} />)}
      </View>

      <View style={{ flex: 1 }}>{body}</View>

      {step !== "where" ? (
        <View style={{ padding: space.lg, gap: space.sm, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
          {step !== "quote" && quote ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", opacity: pending ? 0.5 : 1 }}>
              <Text dim>From</Text>
              <Text variant="heading" accessibilityLabel={`Estimated total ${inr(quote.totals.total)}`}>{inr(quote.totals.total)} <Text variant="small" dim>· {inr(quote.totals.perPerson)} pp</Text></Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="Back" kind="secondary" onPress={() => go(-1)} /></View>
            <View style={{ flex: 2 }}>
              {step === "quote"
                ? <Button label="Send to Retro for final quote" disabled={!quote} onPress={() => (user ? setSendOpen(true) : router.push("/auth"))} />
                : <Button label={step === "style" ? "Build my quote" : "Continue"} onPress={() => go(1)} />}
            </View>
          </View>
          {step === "quote" ? <Text variant="small" dim style={{ textAlign: "center" }} onPress={() => { reset(); router.back(); }}>Start over</Text> : null}
        </View>
      ) : null}

      {quote ? <SendSheet quote={quote} summary={summary} visible={sendOpen} onClose={() => setSendOpen(false)} /> : null}
    </KeyboardAvoidingView>
  );
}
