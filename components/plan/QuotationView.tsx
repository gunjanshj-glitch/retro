"use client";

/**
 * The quotation view: line-item pricing, the day-by-day itinerary and the
 * levers a traveller can pull. Structural land-package costs are shown as
 * locked; everything else can be dropped or added, and the price recomputes.
 */
import { useMemo, useState } from "react";
import type { Quotation, QuoteRequest } from "@retro/core/atlas/engine/types";
import type { TransportMode } from "@retro/core/atlas/schema";
import { formatDuration, formatInr } from "@retro/core/atlas/engine/text";
import policy from "@/content/quote-policy.json";
import { useAuth } from "@/components/auth/AuthProvider";
import { COMPONENT_LABEL, hiddenByComponent } from "@retro/core/quote-pricing";
import { SendForApprovalModal } from "./SendForApprovalModal";
import { btnGhost, btnInk, cardClass, chipClass, chipStyle, optionCardStyle } from "./theme";

/** Traveller-facing mode names; the raw enum reads like a database column. */
const MODE_LABEL: Partial<Record<TransportMode, string>> = {
  private_vehicle: "Private car",
  shared_vehicle: "Shared cab",
};
const modeLabel = (mode: string) => MODE_LABEL[mode as TransportMode] ?? mode.replace(/_/g, " ");

/** The hard ceiling on sightseeing in any one day; shown so the traveller can
 *  see why an outing will not fit rather than just finding that it does not. */
const maxSightseeingHours = policy.dayPlanning.maxSightseeingHoursPerDay;

/** Structural components kept visible even when they price to zero, so an
 *  absent cost (e.g. no tourist tax on this route) reads as "included, none
 *  due" rather than looking like the line was dropped. */
const ALWAYS_VISIBLE_COMPONENTS = ["city-tax"];

/**
 * The optional side of the quote: everything a traveller can actually take out
 * or put back. Anything absent from this map is structural (the land package
 * the agency's policy says is always included) and is tagged "Included".
 *
 * `requestKey` is set only where the whole component is a single yes/no on the
 * request, which is what lets those rows carry their own add/remove control
 * and still appear — priced at zero — when they are switched off. The rest are
 * optional in the sense that they can be tuned elsewhere in this page, so they
 * say where rather than offering a toggle that would be a lie.
 */
const OPTIONAL_COMPONENTS: Record<
  string,
  { note: string; requestKey?: "includeFlight" | "includeVisa" | "includeInsurance" }
> = {
  flight: {
    requestKey: "includeFlight",
    note: "Return airfare from your departure city. Drop it to price the land package on its own.",
  },
  visa: {
    requestKey: "includeVisa",
    note: "Visa fees and handling. Drop it if you would rather apply yourself.",
  },
  insurance: {
    requestKey: "includeInsurance",
    note: "Priced from a typical daily rate pending the agency's own provider figures.",
  },
  sightseeing: {
    note: "Entry tickets for the outings below — deselect any of them in the day-by-day plan to drop it.",
  },
  meals: {
    note: "Set by the meal plan you chose; breakfast always comes with the room.",
  },
};

type Props = {
  quote: Quotation;
  request: QuoteRequest;
  onChange: (next: QuoteRequest) => void;
  /** Absent in the admin editor, which has no earlier step to go back to. */
  onBack?: () => void;
  /** Human-readable place list (e.g. "Kashmir, Ladakh"), used as the subject
   *  line/summary for a final-approval request and nowhere else — the
   *  engine itself only ever deals in place ids. */
  destinationSummary: string;
  /**
   * "traveller" is the planner. "admin" is the same view inside the quote
   * editor: every lever still works, but there is nothing to send for approval
   * and no earlier step to return to.
   */
  mode?: "traveller" | "admin";
  /**
   * Live fares are still being fetched, so every figure here is about to change.
   * They are hidden rather than shown and then replaced, and the quote cannot be
   * sent until they settle.
   */
  pricing?: boolean;
};

export function QuotationView({ quote, request, onChange, onBack, destinationSummary, mode = "traveller", pricing = false }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof quote.lineItems>();
    for (const item of quote.lineItems) {
      const list = map.get(item.component);
      if (list) list.push(item);
      else map.set(item.component, [item]);
    }
    const rows = [...map.entries()].sort(
      (a, b) =>
        b[1].reduce((s, i) => s + i.totalInr, 0) - a[1].reduce((s, i) => s + i.totalInr, 0),
    );
    // A component the traveller has switched off contributes no line items, so
    // it would otherwise vanish from the breakdown entirely — leaving no way to
    // tell "not charged for" from "not offered". Keep an empty row for each so
    // every optional part of the quote is visible and can be added back.
    for (const [component, meta] of Object.entries(OPTIONAL_COMPONENTS)) {
      if (!meta.requestKey || map.has(component) || request[meta.requestKey]) continue;
      rows.push([component, []]);
    }
    // Structural components can legitimately price to zero (no tourist tax on
    // this route, say) — keep the row rather than let it vanish and look like
    // it was quietly dropped.
    for (const component of ALWAYS_VISIBLE_COMPONENTS) {
      if (!map.has(component)) rows.push([component, []]);
    }
    return rows;
  }, [quote, request]);

  // Contingency + agent margin are computed by the engine but never shown on
  // their own — they are folded into each category in proportion to its cost.
  const markupAllocation = useMemo(() => hiddenByComponent(quote), [quote]);

  // The flight fare is a same-day approximation, not a fixed price — this
  // note is one click away rather than always on screen.
  const [showFlightNote, setShowFlightNote] = useState(false);

  // Sending this quotation off for a human-checked final answer. Requires an
  // account purely so the agency has somewhere to send the confirmed figure
  // back to, and so the traveller has a page to track it from — nothing
  // else on the site needs one.
  const { user, requireAuth } = useAuth();
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);

  const handleRequestFinalQuotation = () => {
    if (pricing) return;
    requireAuth(() => setApprovalOpen(true));
  };

  const excludedClusters = new Set(request.excludedClusterIds);

  // Internal notes explain how the engine reached a number; they belong in the
  // calibration report, not in front of the traveller.
  const travellerWarnings = quote.warnings.filter((w) => w.audience === "traveller");

  /** Turning a planned activity off, or back on again. */
  const toggleCluster = (clusterId: string) => {
    const turningOff = !excludedClusters.has(clusterId);
    onChange({
      ...request,
      excludedClusterIds: turningOff
        ? [...request.excludedClusterIds, clusterId]
        : request.excludedClusterIds.filter((id) => id !== clusterId),
      // Dropping something the traveller had previously asked for must also
      // release the pin, or the planner would keep forcing it back in.
      pinnedClusterIds: turningOff
        ? request.pinnedClusterIds.filter((id) => id !== clusterId)
        : request.pinnedClusterIds,
    });
  };

  /**
   * Adding a suggested outing to the itinerary.
   *
   * A suggestion is a cluster that was never excluded — it simply did not fit
   * the day budget — so toggling its exclusion would have removed it
   * altogether. It has to be *pinned* instead, which pushes it to the front
   * of the planner's queue while still respecting the daily sightseeing cap.
   */
  const addCluster = (clusterId: string) => {
    if (request.pinnedClusterIds.includes(clusterId)) return;
    onChange({
      ...request,
      pinnedClusterIds: [...request.pinnedClusterIds, clusterId],
      excludedClusterIds: request.excludedClusterIds.filter((id) => id !== clusterId),
    });
  };

  const setNights = (placeId: string, nights: number) => {
    onChange({ ...request, nightOverrides: { ...request.nightOverrides, [placeId]: nights } });
  };

  /** Transfer days that are a real intercity hop, in itinerary order. */
  const transferLegs = useMemo(
    () =>
      quote.days
        .filter((d) => d.isTransferDay && d.transfer && d.transfer.alternatives.length > 0)
        .map((d) => ({ placeId: d.placeId, leg: d.transfer! })),
    [quote.days],
  );

  const setLegMode = (placeId: string, mode: TransportMode) => {
    onChange({ ...request, legModes: { ...request.legModes, [placeId]: mode } });
  };

  return (
    <div className="flex flex-col gap-10">
      {/* ---- headline ---- */}
      <section
        className="relative overflow-hidden rounded-3xl border p-6 shadow-[var(--shadow)] sm:p-8"
        style={{
          borderColor: "var(--line)",
          background:
            "radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--sun) 22%, transparent) 0%, transparent 55%), var(--card)",
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="eyebrow">
              {quote.referencePackage
                ? `Based on ${quote.referencePackage.name}`
                : "A custom itinerary built for you"}
            </p>
            <h2 className="font-display mt-2 text-3xl leading-tight md:text-4xl">
              {quote.stays.map((s) => s.placeName).join(" · ")}
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {quote.days.length} days · {quote.stays.reduce((a, s) => a + s.nights, 0)} nights ·{" "}
              {quote.pax.adults} adult{quote.pax.adults !== 1 && "s"}
              {quote.pax.children > 0 && `, ${quote.pax.children} child`}
              {quote.pax.infants > 0 && `, ${quote.pax.infants} infant`} · {quote.pax.rooms} room
              {quote.pax.rooms !== 1 && "s"}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-sm font-semibold" style={{ color: "var(--muted)" }}>
              Total for the group
            </p>
            <p className="font-display text-4xl tabular-nums sm:text-5xl" style={{ color: "var(--ink)" }}>
              {pricing ? "…" : formatInr(quote.totals.total)}
            </p>
            <p className="text-sm tabular-nums" style={{ color: "var(--muted)" }} role={pricing ? "status" : undefined}>
              {pricing ? "Checking today's live fares…" : `${formatInr(quote.totals.perPerson)} per person`}
            </p>
          </div>
        </div>

        {travellerWarnings.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2 text-sm">
            {travellerWarnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
                style={
                  w.level === "warning"
                    ? { background: "var(--warning-soft)", color: "var(--warning)" }
                    : { background: "var(--surface)", color: "var(--ink-2)" }
                }
              >
                {w.level === "warning" ? <WarningIcon /> : <InfoIcon />}
                <span>
                  <span className="sr-only">{w.level === "warning" ? "Warning: " : "Note: "}</span>
                  {w.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- adjusters ---- */}
      <section className="flex flex-col gap-4">
        <h3 className="font-display text-2xl md:text-[28px]">Adjust the trip</h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Slide nights between destinations and the price follows.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {quote.stays.map((stay) => (
            <div
              key={stay.placeId}
              className={`${cardClass} p-4 sm:p-5`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{stay.placeName}</span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums"
                  style={{ background: "var(--surface)", color: "var(--ink)" }}
                >
                  {stay.nights} night{stay.nights !== 1 && "s"}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={14}
                value={stay.nights}
                onChange={(e) => setNights(stay.placeId, Number(e.target.value))}
                className="mt-3 h-8 w-full accent-[var(--accent)]"
                aria-label={`Nights in ${stay.placeName}`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ---- transport legs ---- */}
      {transferLegs.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="font-display text-2xl md:text-[28px]">Getting between destinations</h3>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Every leg is priced on the mode we think suits your trip. Switch any of them to trade
            fare against journey time — the total updates immediately.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              Across the whole trip:
            </span>
            {(
              [
                ["cheapest", "Cheapest"],
                ["balanced", "Balanced"],
                ["fastest", "Fastest"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onChange({ ...request, transportPreference: key, legModes: {} })
                }
                aria-pressed={request.transportPreference === key}
                className={`${chipClass} hover:border-[var(--ink-2)]`}
                style={chipStyle(request.transportPreference === key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {transferLegs.map(({ placeId, leg }) => {
              const chosen = leg.alternatives.find((a) => a.mode === leg.mode);
              return (
                <div key={placeId} className={`${cardClass} p-4 sm:p-5`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">
                      {leg.from} → {leg.to}
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                      {leg.distanceKm ? `${leg.distanceKm} km` : ""}
                    </span>
                  </div>

                  {leg.alternatives.length > 1 ? (
                    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`Transport from ${leg.from} to ${leg.to}`}>
                      {leg.alternatives.map((alt) => {
                        const isChosen = alt.mode === leg.mode;
                        const deltaInr = chosen ? alt.priceInr - chosen.priceInr : 0;
                        const deltaMin = chosen ? alt.minutes - chosen.minutes : 0;
                        return (
                          <button
                            key={alt.mode}
                            type="button"
                            role="radio"
                            aria-checked={isChosen}
                            onClick={() => setLegMode(placeId, alt.mode)}
                            className="min-h-11 rounded-xl border-[1.5px] px-3.5 py-2.5 text-left text-sm transition-[border-color,background-color] hover:border-[var(--line-strong)]"
                            style={optionCardStyle(isChosen)}
                          >
                            <div className="font-semibold capitalize">{modeLabel(alt.mode)}</div>
                            <div className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                              {alt.includedInVehicle ? "Included in your vehicle" : `${formatInr(alt.priceInr)} pp`} · {formatDuration(alt.minutes)}
                            </div>
                            {alt.car && !alt.includedInVehicle && (
                              <div className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                                {formatInr(alt.car.totalInr)} total · {alt.car.vehicles > 1 ? `${alt.car.vehicles} × ` : ""}
                                {alt.car.className.split(" (")[0]}
                              </div>
                            )}
                            {!isChosen && (deltaInr !== 0 || deltaMin !== 0) && (
                              <div className="text-xs tabular-nums" style={{ color: "var(--accent)" }}>
                                {deltaInr === 0
                                  ? "same fare"
                                  : `${deltaInr > 0 ? "+" : "−"}${formatInr(Math.abs(deltaInr))}`}
                                {" · "}
                                {deltaMin === 0
                                  ? "same time"
                                  : `${deltaMin > 0 ? "+" : "−"}${formatDuration(Math.abs(deltaMin))}`}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                      <span className="capitalize">{modeLabel(leg.mode)}</span>
                      {leg.durationMinutes != null && ` · ${formatDuration(leg.durationMinutes)}`}
                      {" — the only service on this route."}
                    </p>
                  )}

                  {leg.airportLinks && leg.airportLinks.length > 0 && (
                    <div className="mt-3 flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--hairline)" }}>
                      <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                        Getting to and from the airports
                      </p>
                      {leg.airportLinks.map((link) => {
                        const chosenLink = link.alternatives.find((a) => a.mode === link.mode);
                        return (
                          <div key={link.key}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                              <span>
                                {link.from} → {link.to}
                              </span>
                              <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                                {link.distanceKm} km · {link.airportIata}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={`Transport from ${link.from} to ${link.to}`}>
                              {link.alternatives.map((alt) => {
                                const isChosen = alt.mode === link.mode;
                                const deltaInr = chosenLink ? alt.priceInr - chosenLink.priceInr : 0;
                                return (
                                  <button
                                    key={alt.mode}
                                    type="button"
                                    role="radio"
                                    aria-checked={isChosen}
                                    onClick={() => setLegMode(link.key, alt.mode)}
                                    className="min-h-11 rounded-xl border-[1.5px] px-3.5 py-2.5 text-left text-sm transition-[border-color,background-color] hover:border-[var(--line-strong)]"
                                    style={optionCardStyle(isChosen)}
                                  >
                                    <div className="font-semibold capitalize">
                                      {modeLabel(alt.mode)}
                                      {isChosen && (
                                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                                          {link.userChosen ? "your pick" : "suggested"}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                                      {formatInr(alt.priceInr)} pp · {formatDuration(alt.minutes)}
                                    </div>
                                    {alt.car && (
                                      <div className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                                        {formatInr(alt.car.totalInr)} total · {alt.car.vehicles > 1 ? `${alt.car.vehicles} × ` : ""}
                                        {alt.car.className.split(" (")[0]}
                                      </div>
                                    )}
                                    {!isChosen && deltaInr !== 0 && (
                                      <div className="text-xs tabular-nums" style={{ color: "var(--accent)" }}>
                                        {deltaInr > 0 ? "+" : "−"}
                                        {formatInr(Math.abs(deltaInr))}
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        These links sit outside your itinerary but are part of the journey, so they are included in the total.
                      </p>
                    </div>
                  )}

                  {leg.includedInVehicle && (
                    <p className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: "var(--surface)", color: "var(--muted)" }}>
                      This drive runs in your chauffeur-driven vehicle, which is billed per day for the whole trip — airport
                      transfers, intercity drives and sightseeing together.
                    </p>
                  )}
                  {leg.car && !leg.includedInVehicle && (
                    <p className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: "var(--surface)", color: "var(--muted)" }}>
                      Chauffeur-driven {leg.car.vehicles > 1 ? `${leg.car.vehicles} × ` : ""}
                      {leg.car.className} for {leg.car.roadKm} road km
                      {leg.car.drivingDays > 1 ? ` over ${leg.car.drivingDays} days` : ""}:{" "}
                      fuel {formatInr(leg.car.breakdown.fuelInr)} · vehicle {formatInr(leg.car.breakdown.vehicleInr)} · driver{" "}
                      {formatInr(leg.car.breakdown.driverInr)} · tolls {formatInr(leg.car.breakdown.tollsInr)} ={" "}
                      <span className="tabular-nums" style={{ color: "var(--accent)" }}>{formatInr(leg.car.totalInr)}</span>
                      {" "}for the whole group. Estimate — the final quote confirms the exact vehicle.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- itinerary ---- */}
      <section className="flex flex-col gap-4">
        <h3 className="font-display text-2xl md:text-[28px]">Day by day</h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No day is planned beyond {maxSightseeingHours} hours of sightseeing, so there is always
          time to eat, travel between sites and rest.
        </p>
        <ol className="flex flex-col gap-3">
          {quote.days.map((day) => {
            const full = day.budgetHours > 0 && day.activeHours >= day.budgetHours - 0.05;
            return (
            <li
              key={day.dayNumber}
              className={`${cardClass} p-4 sm:p-5`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-3 font-semibold">
                  <span
                    className="flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums"
                    style={{ background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)" }}
                    aria-hidden="true"
                  >
                    {day.dayNumber}
                  </span>
                  <span>
                    <span className="sr-only">Day {day.dayNumber} · </span>
                    {day.placeName}
                  </span>
                </span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums"
                  style={
                    full
                      ? { background: "var(--coral-soft)", color: "var(--accent)" }
                      : { background: "var(--surface)", color: "var(--muted)" }
                  }
                >
                  {day.date} · {day.activeHours}h of {day.budgetHours}h
                  {full ? " · full" : ""}
                </span>
              </div>

              {day.notes.length > 0 && (
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  {day.notes.join(" · ")}
                </p>
              )}

              {day.activities.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {day.activities.map((a) => {
                    const off = a.clusterId ? excludedClusters.has(a.clusterId) : false;
                    return (
                      <li key={`${day.dayNumber}-${a.clusterId ?? a.title}`} className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)] disabled:cursor-not-allowed"
                          checked={!off}
                          disabled={a.locked || !a.clusterId}
                          onChange={() => a.clusterId && toggleCluster(a.clusterId)}
                          aria-label={`Include ${a.title}`}
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className={off ? "line-through opacity-50" : ""}>{a.title}</span>
                            <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                              {a.hours}h
                              {a.pricePerPersonInr > 0 && ` · ${formatInr(a.pricePerPersonInr)} pp`}
                            </span>
                          </div>
                          {a.attractions.length > 0 && (
                            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                              {a.attractions.slice(0, 4).join(" · ")}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
            );
          })}
        </ol>
      </section>

      {/* ---- suggestions ---- */}
      {quote.suggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-display text-2xl md:text-[28px]">You could also add</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {quote.suggestions.map((s) => {
              const pinned = s.clusterId ? request.pinnedClusterIds.includes(s.clusterId) : false;
              return (
                <button
                  key={s.clusterId ?? s.title}
                  type="button"
                  onClick={() => s.clusterId && (pinned ? toggleCluster(s.clusterId) : addCluster(s.clusterId))}
                  aria-pressed={pinned}
                  className="rounded-2xl border-[1.5px] p-4 text-left transition-[border-color,box-shadow] hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-sm)]"
                  style={optionCardStyle(pinned)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px]"
                        style={
                          pinned
                            ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                            : { borderColor: "var(--line-strong)", color: "var(--ink)" }
                        }
                        aria-hidden="true"
                      >
                        {pinned ? <CheckIcon size={11} /> : <PlusIcon />}
                      </span>
                      {s.title}
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: "var(--accent)" }}>
                      +{formatInr(s.pricePerPersonInr)} pp
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {s.hours}h · {s.attractions.slice(0, 3).join(" · ")}
                  </p>
                  {pinned && (
                    <p className="mt-1 text-xs font-semibold" style={{ color: "var(--warning)" }}>
                      Requested — no room yet. Add a night to fit it in.
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            A day holds at most {maxSightseeingHours} hours of sightseeing, so adding one of these
            may need an extra night in that destination.
          </p>
        </section>
      )}

      {/* ---- price breakdown ---- */}
      <section className="flex flex-col gap-4">
        <h3 className="font-display text-2xl md:text-[28px]">What you are paying for</h3>
        <div className={`${cardClass} overflow-hidden`}>
          {grouped.map(([component, items]) => {
            const optional = OPTIONAL_COMPONENTS[component];
            const requestKey = optional?.requestKey;
            const isOn = requestKey ? Boolean(request[requestKey]) : items.length > 0;
            // Structural components are locked by the pricing engine; anything
            // the traveller can drop is flagged optional so the two are never
            // confused on the bill.
            const included = !optional && items.every((i) => i.locked);
            const baseTotal = items.reduce((s, i) => s + i.totalInr, 0);
            const displayTotal = baseTotal + (markupAllocation.get(component) ?? 0);
            const isFlight = component === "flight";
            return (
              <div
                key={component}
                className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 last:border-b-0 sm:px-5"
                style={{ borderColor: "var(--line)" }}
              >
                {/* font-medium is also the hook the breakdown tests use to find a row's label. */}
                <span className="font-medium">
                  {COMPONENT_LABEL[component] ?? component}
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={
                      included
                        ? { background: "var(--surface)", color: "var(--ink-2)", border: "1px solid var(--line)" }
                        : { background: "var(--coral-soft)", color: "var(--accent)" }
                    }
                  >
                    {included ? "Included" : "Optional"}
                  </span>
                  {optional && !isOn && (
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                      not in this quote
                    </span>
                  )}
                  {isFlight && (
                    <button
                      type="button"
                      onClick={() => setShowFlightNote((v) => !v)}
                      aria-expanded={showFlightNote}
                      className="ml-2 inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] font-bold uppercase tracking-wide transition-colors hover:border-[var(--ink)]"
                      style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)" }}
                    >
                      Approximation
                    </button>
                  )}
                  {isFlight && showFlightNote && (
                    <p className="mt-1 max-w-sm text-xs font-normal normal-case" style={{ color: "var(--muted)" }}>
                      The flight price is an approximation. The actual price will be provided on
                      request confirmation.
                    </p>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {requestKey && (
                    <button
                      type="button"
                      onClick={() => onChange({ ...request, [requestKey]: !isOn })}
                      className="inline-flex min-h-9 items-center rounded-full border-[1.5px] px-3.5 text-xs font-bold transition-colors"
                      style={
                        isOn
                          ? { borderColor: "var(--line-strong)", color: "var(--ink-2)", background: "var(--card)" }
                          : { borderColor: "var(--sun-deep)", color: "var(--on-sun)", background: "var(--sun)" }
                      }
                    >
                      {isOn ? "Remove" : "Add"}
                    </button>
                  )}
                  <span className="min-w-[88px] text-right font-semibold tabular-nums">{pricing ? "…" : formatInr(displayTotal)}</span>
                </span>
              </div>
            );
          })}
        </div>

        <dl className="ml-auto flex w-full max-w-sm flex-col gap-1 text-sm">
          {(
            [
              ["Direct cost", quote.totals.costBeforeMarkup + quote.totals.agentMarkup],
              ["GST", quote.totals.salesVat],
            ] as const
          ).map(([label, amount]) =>
            amount > 0 ? (
              <div key={label} className="flex justify-between">
                <dt style={{ color: "var(--muted)" }}>{label}</dt>
                <dd className="tabular-nums">{pricing ? "…" : formatInr(amount)}</dd>
              </div>
            ) : null,
          )}
          <div
            className="mt-2 flex items-baseline justify-between border-t pt-3"
            style={{ borderColor: "var(--line-strong)" }}
          >
            <dt className="font-bold">Total</dt>
            <dd className="font-display text-2xl tabular-nums" style={{ color: "var(--ink)" }}>
              {pricing ? "…" : formatInr(quote.totals.total)}
            </dd>
          </div>
        </dl>
      </section>

      {/* ---- request a final, human-checked quotation ---- */}
      {mode === "traveller" && (
        <section
          className="flex flex-col gap-3 rounded-3xl p-6 sm:p-8"
          style={{
            background: "linear-gradient(120deg, #fff6d6 0%, color-mix(in srgb, var(--sun) 55%, #fff) 100%)",
            border: "1px solid color-mix(in srgb, var(--sun-deep) 35%, transparent)",
          }}
        >
          <h3 className="font-display text-2xl md:text-3xl">Ready to lock this in?</h3>
          <p className="max-w-2xl text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
            This is a live, adjustable estimate. Send it to us and a person on our team will check
            every rate — including the flight approximation — adjust anything that needs it, and
            email you a final quote. You then accept it and pay securely online.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRequestFinalQuotation}
              disabled={Boolean(sentId) || pricing}
              className={`${btnInk} shadow-[var(--shadow)] disabled:opacity-80`}
            >
              {sentId ? (
                <>
                  Sent for review <CheckIcon size={14} />
                </>
              ) : (
                <>
                  Send for final approval <span aria-hidden="true">→</span>
                </>
              )}
            </button>
            {sentId && (
              <span className="text-sm" style={{ color: "var(--ink)" }}>
                <a href={`/my-requests/view?id=${encodeURIComponent(sentId)}`} className="font-semibold underline underline-offset-2" style={{ color: "var(--ink)" }}>
                  Track this request
                </a>{" "}
                or see all in{" "}
                <a href="/my-requests" className="font-semibold underline underline-offset-2" style={{ color: "var(--ink)" }}>
                  My requests
                </a>
                .
              </span>
            )}
          </div>
        </section>
      )}
      {approvalOpen && user && (
        <SendForApprovalModal
          user={user}
          request={request}
          quote={quote}
          destinationSummary={destinationSummary}
          onClose={() => setApprovalOpen(false)}
          onSent={setSentId}
        />
      )}

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className={`${btnGhost} self-start`}
        >
          <span aria-hidden="true">←</span>
          Change my choices
        </button>
      )}
    </div>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 2.5 20h19L12 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" />
    </svg>
  );
}
