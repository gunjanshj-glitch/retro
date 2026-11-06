"use client";

/**
 * Admin sightseeing picker: every outing available at every destination, each
 * with its own tick, whether or not the planner happened to schedule it.
 *
 * The day-by-day view only lists what the planner placed. Unticking one of
 * those used to make the planner quietly pull the next-ranked place into the
 * freed time, and the place just unticked vanished from the list, so the admin
 * could neither see everything nor settle on a fixed set. Two modes fix that:
 *
 *  - "Planner fills the days" (auto): ticking and unticking works as before, but
 *    every place stays listed, ticked or not, so any of them can be brought back.
 *  - "I choose the places" (manual): the ticked places are the itinerary and
 *    nothing else is added behind the admin's back.
 */
import type { QuoteRequest, Quotation, SightseeingOption } from "@retro/core/atlas/engine/types";
import { formatInr } from "@retro/core/atlas/engine/text";
import { btnSmall, toneStyle } from "@/components/plan/theme";

type Props = {
  quote: Quotation;
  request: QuoteRequest;
  onChange: (next: (r: QuoteRequest) => QuoteRequest) => void;
  disabled?: boolean;
};

const STATUS_TEXT: Record<SightseeingOption["status"], string> = {
  planned: "In the itinerary",
  unscheduled: "Not scheduled",
  excluded: "Switched off",
};

export function SightseeingPanel({ quote, request, onChange, disabled }: Props) {
  const options = quote.sightseeingOptions ?? [];
  const manual = request.sightseeingMode === "manual";
  const pinned = new Set(request.pinnedClusterIds);
  const excluded = new Set(request.excludedClusterIds);

  // Which day each planned outing landed on.
  const dayOf = new Map<string, number>();
  for (const d of quote.days) for (const a of d.activities) if (a.clusterId && !dayOf.has(a.clusterId)) dayOf.set(a.clusterId, d.dayNumber);

  /** Ticked means "wanted": scheduled by the planner, or asked for by the admin (even if the days are full). */
  const isOn = (o: SightseeingOption) => {
    const id = o.clusterId ?? "";
    if (excluded.has(id)) return false;
    return manual ? pinned.has(id) : o.status === "planned" || pinned.has(id);
  };

  /** Tick or untick outings, with the rule each mode needs. */
  const setOn = (items: SightseeingOption[], on: boolean) =>
    onChange((r) => {
      const nextPinned = new Set(r.pinnedClusterIds);
      const nextExcluded = new Set(r.excludedClusterIds);
      for (const o of items) {
        const id = o.clusterId;
        if (!id) continue;
        if (on) {
          nextExcluded.delete(id);
          // Already scheduled by the planner in auto mode: nothing to pin.
          if (r.sightseeingMode === "manual" || o.status !== "planned") nextPinned.add(id);
        } else if (r.sightseeingMode === "manual") {
          nextPinned.delete(id);
        } else {
          nextExcluded.add(id);
          nextPinned.delete(id);
        }
      }
      return { ...r, pinnedClusterIds: [...nextPinned], excludedClusterIds: [...nextExcluded] };
    });

  const setMode = (toManual: boolean) =>
    onChange((r) => {
      if (!toManual) return { ...r, sightseeingMode: "auto" };
      // Start from exactly what is planned now, so switching changes nothing yet.
      const planned = (quote.sightseeingOptions ?? []).filter((o) => o.status === "planned" && o.clusterId).map((o) => o.clusterId!);
      return { ...r, sightseeingMode: "manual", pinnedClusterIds: [...new Set([...r.pinnedClusterIds, ...planned])] };
    });

  if (!options.length) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        No sightseeing is on offer for these destinations.
      </p>
    );
  }

  // Keep destinations in itinerary order.
  const byPlace = new Map<string, { name: string; items: SightseeingOption[] }>();
  for (const o of options) {
    const g = byPlace.get(o.placeId) ?? { name: o.placeName, items: [] };
    g.items.push(o);
    byPlace.set(o.placeId, g);
  }

  const noData = quote.stays.filter((st) => !byPlace.has(st.placeId)).map((st) => st.placeName);

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="flex flex-col gap-2 rounded-xl p-3.5 sm:flex-row sm:gap-6" style={{ background: "var(--surface)" }}>
        <legend className="sr-only">How sightseeing is chosen</legend>
        {(
          [
            [false, "Planner fills the days", "Untick a place and the planner may pull the next one into the free time."],
            [true, "I choose the places", "Only the places you tick are in the itinerary. Nothing is added behind your back."],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={title} className="flex min-h-11 flex-1 cursor-pointer items-start gap-3 text-sm">
            <input type="radio" name="sightseeing-mode" checked={manual === value} onChange={() => setMode(value)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]" />
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="block text-xs" style={{ color: "var(--muted)" }}>
                {hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {[...byPlace.entries()].map(([placeId, g]) => {
        const on = g.items.filter(isOn);
        const hours = on.reduce((s, o) => s + o.hours, 0);
        return (
          <section key={placeId} className="rounded-xl border" style={{ borderColor: "var(--line)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
              <h4 className="font-semibold">
                {g.name}
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>
                  {on.length} of {g.items.length} ticked · {Number(hours.toFixed(1))}h
                </span>
              </h4>
              <span className="flex gap-2">
                <button type="button" disabled={disabled || on.length === g.items.length} onClick={() => setOn(g.items.filter((o) => !isOn(o)), true)} className={btnSmall}>
                  Tick all
                </button>
                <button type="button" disabled={disabled || on.length === 0} onClick={() => setOn(on, false)} className={btnSmall}>
                  Untick all
                </button>
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-[var(--line)]">
              {g.items.map((o) => {
                const ticked = isOn(o);
                const noRoom = ticked && o.status === "unscheduled";
                const day = o.clusterId ? dayOf.get(o.clusterId) : undefined;
                return (
                  <li key={o.clusterId ?? o.title} className="px-4 py-2.5">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                        checked={ticked}
                        disabled={disabled || !o.clusterId}
                        onChange={() => setOn([o], !ticked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="text-sm font-medium" style={ticked ? undefined : { color: "var(--ink-2)" }}>
                            {o.title}
                          </span>
                          <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                            {o.hours}h{o.pricePerPersonInr > 0 && ` · ${formatInr(o.pricePerPersonInr)} pp`}
                          </span>
                        </span>
                        {o.attractions.length > 0 && (
                          <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                            {o.attractions.slice(0, 4).join(" · ")}
                          </span>
                        )}
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                          <span className="rounded-full px-2 py-0.5" style={ticked && !noRoom ? toneStyle.success : toneStyle.neutral}>
                            {noRoom ? "No room yet" : STATUS_TEXT[o.status]}
                            {o.status === "planned" && day != null ? ` · Day ${day}` : ""}
                          </span>
                          {noRoom && (
                            <span style={{ color: "var(--warning)" }}>Every day is full. Add a night here, or untick something else, to fit it in.</span>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {noData.length > 0 && (
        <p className="rounded-xl border px-3.5 py-2.5 text-sm" style={toneStyle.neutral}>
          No sightseeing is on file for {noData.join(", ")}, so there is nothing to tick there. Add what it costs as a charge in the price split.
        </p>
      )}
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        A day holds a limited number of sightseeing hours. A place the days cannot fit stays ticked and is flagged &ldquo;No room yet&rdquo; rather than quietly dropped. What each place costs is in the price split below.
      </p>
    </div>
  );
}
