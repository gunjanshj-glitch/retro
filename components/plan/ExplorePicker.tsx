"use client";

/**
 * "I want to explore" — the alternative to the map.
 *
 * The traveller answers a few bounded questions and the catalogue is ranked
 * against them using the destination suitability scores and month-by-month
 * ratings already compiled into the core bundle. Still no free text.
 */
import { useMemo, useState } from "react";
import type { CoreBundle, TripStyle } from "@retro/core/atlas/schema";
import { styleScore } from "@retro/core/atlas/engine";
import { evaluatePlaceSelectability } from "@retro/core/atlas/engine/bounds";

import { cardClass, chipClass, chipStyle, fieldClass, optionCardStyle, selectStyle } from "./theme";

const STYLES: { value: TripStyle; label: string }[] = [
  { value: "family", label: "Family time" },
  { value: "romantic", label: "Romance" },
  { value: "honeymoon", label: "Honeymoon" },
  { value: "luxury", label: "Luxury" },
  { value: "adventure", label: "Adventure" },
  { value: "culture", label: "Culture & history" },
  { value: "budget", label: "Great value" },
  { value: "pilgrimage", label: "Pilgrimage" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUDGETS: { value: "value" | "mid" | "premium"; label: string; stars: string }[] = [
  { value: "value", label: "Keep it lean", stars: "3 star" },
  { value: "mid", label: "Comfortable", stars: "4 star" },
  { value: "premium", label: "Spare no expense", stars: "5 star and above" },
];

type Props = {
  core: CoreBundle;
  selected: string[];
  onChange: (placeIds: string[]) => void;
};

export function ExplorePicker({ core, selected, onChange }: Props) {
  const [style, setStyle] = useState<TripStyle>("culture");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [budget, setBudget] = useState<"value" | "mid" | "premium">("mid");
  const [regionId, setRegionId] = useState<string>("any");

  const summaries = useMemo(
    () => new Map(core.placeSummaries.map((s) => [s.placeId, s])),
    [core.placeSummaries],
  );
  const countryById = useMemo(
    () => new Map(core.countries.map((c) => [c.id, c])),
    [core.countries],
  );

  const ranked = useMemo(() => {
    const cheapestHotel = new Map<string, number>();
    for (const rate of core.hotelRates) {
      if (rate.star !== "3 Star" || rate.zone !== "Outskirts") continue;
      cheapestHotel.set(rate.placeId, rate.inr);
    }
    const prices = [...cheapestHotel.values()].sort((a, b) => a - b);
    const p33 = prices[Math.floor(prices.length * 0.33)] ?? 0;
    const p66 = prices[Math.floor(prices.length * 0.66)] ?? Infinity;

    return core.places
      .filter((p) => p.hasContent)
      .filter((p) => regionId === "any" || countryById.get(p.countryId)?.regionId === regionId)
      .map((place) => {
        const summary = summaries.get(place.id);
        const fit = styleScore(summary, style);
        // The destination files score each month for weather, crowd and price;
        // a high monthly price index means an expensive time to go.
        const monthIndex = summary?.monthPrice?.[String(month)] ?? 50;
        const nightly = cheapestHotel.get(place.id) ?? p33;

        let budgetFit = 0;
        if (budget === "value") budgetFit = nightly <= p33 ? 15 : nightly <= p66 ? 5 : -10;
        else if (budget === "mid") budgetFit = nightly <= p66 ? 10 : 0;
        else budgetFit = nightly > p66 ? 12 : 4;

        // Prefer months where the destination is not at peak pricing.
        const seasonFit = (100 - monthIndex) * 0.15;

        return { place, score: fit + budgetFit + seasonFit, fit };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);
  }, [core, summaries, countryById, style, month, budget, regionId]);

  const selectedSet = new Set(selected);
  const selectability = useMemo(() => evaluatePlaceSelectability(core, selected), [core, selected]);
  const toggle = (id: string) =>
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-col gap-8">
      <div className={`${cardClass} grid gap-6 p-5 sm:p-7 md:grid-cols-2`}>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">What kind of trip?</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Trip style">
            {STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={s.value === style}
                onClick={() => setStyle(s.value)}
                className={chipClass}
                style={chipStyle(s.value === style)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">Budget</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Budget">
            {BUDGETS.map((b) => (
              <button
                key={b.value}
                type="button"
                role="radio"
                aria-checked={b.value === budget}
                title={b.stars}
                onClick={() => setBudget(b.value)}
                className={chipClass}
                style={chipStyle(b.value === budget)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold">When?</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={fieldClass}
            style={selectStyle}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold">Anywhere in particular?</span>
          <select
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className={fieldClass}
            style={selectStyle}
          >
            <option value="any">Surprise me</option>
            {core.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h2 className="font-display text-2xl">Best matches</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Ranked on how well each destination suits a {STYLES.find((s) => s.value === style)?.label.toLowerCase()} trip
          in {MONTHS[month - 1]}.
        </p>
        {selected.length > 0 && (
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Destinations greyed out below aren&apos;t realistically combinable with what you&apos;ve already picked —
            deselect a place to bring them back.
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ranked.map(({ place, fit }) => {
            const on = selectedSet.has(place.id);
            const entry = selectability.get(place.id);
            const isDisabled = !on && entry?.allowed === false;
            const disabledReason = entry?.reason ?? "Not realistically combinable with your current selection";
            return (
              <button
                key={place.id}
                type="button"
                aria-pressed={on}
                aria-disabled={isDisabled}
                disabled={isDisabled}
                title={isDisabled ? disabledReason : undefined}
                onClick={() => !isDisabled && toggle(place.id)}
                className="relative min-h-[76px] rounded-2xl border-[1.5px] p-4 text-left transition-[border-color,box-shadow,background-color] hover:shadow-[var(--shadow-sm)] enabled:hover:border-[var(--line-strong)]"
                style={{
                  ...optionCardStyle(on),
                  ...(isDisabled
                    ? { background: "var(--surface)", borderColor: "var(--line)", borderStyle: "dashed", color: "var(--ink-2)" }
                    : null),
                  cursor: isDisabled ? "not-allowed" : "pointer",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px]"
                      style={
                        on
                          ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                          : { borderColor: "var(--line-strong)", background: "var(--card)" }
                      }
                      aria-hidden="true"
                    >
                      {on && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {place.name}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
                    style={
                      isDisabled
                        ? { background: "var(--line)", color: "var(--ink-2)" }
                        : { background: "var(--coral-soft)", color: "var(--accent)" }
                    }
                    title="Match score"
                  >
                    <span className="sr-only">Match score </span>
                    {Math.round(fit)}
                  </span>
                </div>
                <p className="mt-1 pl-7 text-xs" style={{ color: "var(--muted)" }}>
                  {countryById.get(place.countryId)?.name}
                </p>
                {isDisabled && (
                  <p className="mt-1 pl-7 text-xs" style={{ color: "var(--ink-2)" }}>
                    {disabledReason}
                  </p>
                )}
              </button>
            );
          })}
        </div>
        {!ranked.length && (
          <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
            No destinations match that combination yet — try a different region.
          </p>
        )}
      </div>
    </div>
  );
}
