import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { allocateMarkup, COMPONENT_LABEL } from "@retro/core/quote-pricing";
import type { Quotation } from "@retro/core/atlas/engine/types";
import { inr, shortDate } from "@/lib/format";
import { Card, Text } from "@/ui";
import { radius, space, useTheme } from "@/theme";
import { usePlanner } from "./state";

export function QuoteView({ quote, pending }: { quote: Quotation; pending: boolean }) {
  const c = useTheme();
  const { request, patch } = usePlanner();
  const [open, setOpen] = useState<number | null>(1);
  const nights = quote.stays.reduce((a, s) => a + s.nights, 0);

  // Contingency and the agency's margin are never shown as lines of their own: they are folded into each category (same rule as the website).
  const split = useMemo(() => {
    const hidden = quote.totals.contingency + quote.totals.agentMarkup;
    const base = new Map<string, number>();
    for (const i of quote.lineItems) base.set(i.component, (base.get(i.component) ?? 0) + i.totalInr);
    const share = allocateMarkup(base, hidden);
    return [...base.entries()].map(([k, v]) => ({ key: k, label: COMPONENT_LABEL[k] ?? k, amount: Math.round(v + (share.get(k) ?? 0)) })).sort((a, b) => b.amount - a.amount);
  }, [quote]);

  const excluded = new Set(request.excludedActivityCodes);
  const warnings = quote.warnings.filter((w) => w.audience === "traveller");
  const toggleActivity = (code: string) =>
    patch({ excludedActivityCodes: excluded.has(code) ? request.excludedActivityCodes.filter((x) => x !== code) : [...request.excludedActivityCodes, code] });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 140, opacity: pending ? 0.55 : 1 }}>
      <View style={{ gap: space.xs }}>
        <Text variant="label" color={c.accent}>Your estimate</Text>
        <Text variant="title" accessibilityLabel={`Total ${inr(quote.totals.total)}`}>{inr(quote.totals.total)}</Text>
        <Text dim>{inr(quote.totals.perPerson)} per person · {quote.pax.total} traveller{quote.pax.total > 1 ? "s" : ""} · {nights} nights</Text>
        <Text variant="small" dim>This is an estimate from our pricing engine. Our team checks availability and confirms the final price before you pay anything.</Text>
      </View>

      {warnings.map((w, i) => (
        <Card key={i}><Text variant="small" color={w.level === "warning" ? c.danger : c.textDim}>{w.message}</Text></Card>
      ))}

      <View style={{ gap: space.sm }}>
        <Text variant="heading">Where the money goes</Text>
        <Card>
          {split.map((row) => (
            <View key={row.key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
              <Text>{row.label}</Text>
              <Text style={{ fontVariant: ["tabular-nums"] }}>{inr(row.amount)}</Text>
            </View>
          ))}
          {quote.totals.salesVat > 0 ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
              <Text dim>GST</Text>
              <Text dim style={{ fontVariant: ["tabular-nums"] }}>{inr(quote.totals.salesVat)}</Text>
            </View>
          ) : null}
        </Card>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="heading">Day by day</Text>
        {quote.days.map((day) => {
          const isOpen = open === day.dayNumber;
          return (
            <View key={day.dayNumber} style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.surface }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : day.dayNumber)} style={{ padding: space.md, minHeight: 56, justifyContent: "center" }}>
                <Text style={{ fontWeight: "700" }}>Day {day.dayNumber} · {day.placeName}</Text>
                <Text variant="small" dim>{shortDate(day.date)}{day.isTransferDay ? " · travel day" : ""}{day.isFreeDay ? " · free day" : ""}</Text>
              </Pressable>
              {isOpen ? (
                <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
                  {day.transfer ? <Text variant="small" dim>Travel: {day.transfer.from} to {day.transfer.to}, {String(day.transfer.mode).replace(/_/g, " ")}</Text> : null}
                  {day.activities.map((a, i) => {
                    const off = a.code ? excluded.has(a.code) : false;
                    return (
                      <View key={`${a.title}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ textDecorationLine: off ? "line-through" : "none" }}>{a.title}</Text>
                          <Text variant="small" dim>{a.hours}h{a.pricePerPersonInr ? ` · ${inr(a.pricePerPersonInr)} pp` : ""}</Text>
                        </View>
                        {!a.locked && a.code ? (
                          <Pressable accessibilityRole="button" accessibilityLabel={`${off ? "Add" : "Remove"} ${a.title}`} onPress={() => toggleActivity(a.code!)} style={{ minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center" }}>
                            <Text color={c.accent} style={{ fontWeight: "700" }}>{off ? "Add" : "Remove"}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                  {day.activities.length === 0 ? <Text variant="small" dim>A free day to explore at your own pace.</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {request.excludedActivityCodes.length === 0 && quote.suggestions.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="heading">You might also like</Text>
          {quote.suggestions.slice(0, 5).map((s) => (
            <Card key={s.code ?? s.title}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1 }}><Text>{s.title}</Text><Text variant="small" dim>+{inr(s.pricePerPersonInr)} per person</Text></View>
                {s.code ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Add ${s.title}`} onPress={() => patch({ addedActivityCodes: [...request.addedActivityCodes, s.code!] })} style={{ minHeight: 44, minWidth: 56, alignItems: "center", justifyContent: "center" }}>
                    <Text color={c.accent} style={{ fontWeight: "700" }}>Add</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
