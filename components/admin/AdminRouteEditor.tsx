"use client";

/**
 * The route and day plan, laid out as something to rearrange.
 *
 * The admin sees the trip as a list of stops, each with its days and the outings
 * on them, and can: drag stops into a new order (or use the arrows), set nights
 * per stop, drag an outing to another day at the same destination, add a site to
 * any day, switch one off, add or remove a destination, and pick the transport
 * for every hop. Everything is a request edit, so the quote re-prices live and the
 * same engine that priced the traveller's version prices this one.
 *
 * Dragging is a convenience, never the only way: every drag has a button or menu
 * that does the same thing, for keyboards, touch screens and screen readers.
 */
import { useMemo, useState } from "react";
import type { CoreBundle, TransportMode } from "@retro/core/atlas/schema";
import type { PlannedDay, Quotation, QuoteRequest, SightseeingOption } from "@retro/core/atlas/engine/types";
import { formatDuration, formatInr } from "@retro/core/atlas/engine/text";
import { btnSmall, chipClass, chipStyle, selectStyle, toneStyle } from "@/components/plan/theme";
import {
  MAX_TRIP_NIGHTS, addStop, canPlaceOnDay, hasSplitVisit, moveStop, nightsMismatch, placeOuting, removeStop,
  resetRoute, setOutingOn, setStopNights, stopsOf, type RouteEdit, type Stop,
} from "./route-edits";

type Edit = (next: (r: QuoteRequest) => QuoteRequest) => void;

type Props = {
  core: CoreBundle;
  quote: Quotation;
  request: QuoteRequest;
  onChange: Edit;
  /** Step back / forward through this session's edits. */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
};

const MODE_LABEL: Partial<Record<TransportMode, string>> = { private_vehicle: "Private car", shared_vehicle: "Shared cab" };
const modeLabel = (m: string) => MODE_LABEL[m as TransportMode] ?? m.replace(/_/g, " ");

type OutingDrag = { clusterId: string; title: string };

export function AdminRouteEditor({ core, quote, request, onChange, history }: Props) {
  const stops = useMemo(() => stopsOf(quote, request, (id) => core.places.find((p) => p.id === id)?.name ?? id), [quote, request, core.places]);
  const chosen = useMemo(() => stops.filter((s) => s.chosen && !s.dropped), [stops]);
  /** In the request but not in the itinerary: the planner left them out. */
  const leftOut = useMemo(() => stops.filter((s) => s.dropped), [stops]);
  const inItinerary = useMemo(() => stops.filter((s) => !s.dropped), [stops]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragStop, setDragStop] = useState<string | null>(null);
  const [overStop, setOverStop] = useState<string | null>(null);
  const [dragOuting, setDragOuting] = useState<OutingDrag | null>(null);
  const [overDay, setOverDay] = useState<number | null>(null);
  const [addingToDay, setAddingToDay] = useState<number | null>(null);
  const [newPlace, setNewPlace] = useState("");

  const options = quote.sightseeingOptions ?? [];
  const mismatch = nightsMismatch(request, stops);
  const totalNights = chosen.reduce((a, s) => a + s.nights, 0);
  // The admin is internal, so every warning counts, not only the traveller-facing ones.
  const warnings = [...new Set(quote.warnings.filter((w) => w.level === "warning").map((w) => w.message))];
  /** Why the planner left a place out: the engine's own sentence, when it gave one. */
  const reasonFor = (name: string) => quote.warnings.find((w) => w.message.includes(name) && /dropped|left out|not realistically|cannot|can't/i.test(w.message))?.message ?? null;
  const indexOf = (placeId: string) => chosen.findIndex((s) => s.placeId === placeId);

  const apply = (edit: RouteEdit, message: string) => {
    onChange(() => edit.request);
    setNotice(edit.droppedLegPins > 0 ? `${message} ${edit.droppedLegPins} transport choice${edit.droppedLegPins === 1 ? " was" : "s were"} reset because the hop changed.` : message);
  };

  const route = (order: string[]) => order.map((id) => stops.find((s) => s.placeId === id)?.name ?? id).join(" → ");

  const move = (placeId: string, to: number) => {
    const from = indexOf(placeId);
    const edit = moveStop(request, stops, from, to);
    if (edit.request === request) return;
    const nextOrder = edit.request.placeOrder;
    apply(edit, `Moved ${stops.find((s) => s.placeId === placeId)?.name} to stop ${to + 1}. Route: ${route(nextOrder)}.`);
  };

  const nights = (s: Stop, n: number) => {
    const next = setStopNights(request, stops, s.placeId, n);
    if (next === request) {
      setNotice(n < 1 ? `${s.name} needs at least one night. To drop it, remove the stop.` : `A trip can be at most ${MAX_TRIP_NIGHTS} nights.`);
      return;
    }
    onChange(() => next);
    setNotice(`${s.name}: ${n} night${n === 1 ? "" : "s"}. Trip is now ${next.nights} nights.`);
  };

  const remove = (s: Stop) => {
    const edit = removeStop(request, stops, s.placeId);
    if (edit.request === request) {
      setNotice("A trip needs at least one destination.");
      return;
    }
    apply(edit, `Removed ${s.name}. Trip is now ${edit.request.nights} nights.`);
  };

  const places = useMemo(() => {
    const countryName = new Map(core.countries.map((c) => [c.id, c.name]));
    const groups = new Map<string, { id: string; name: string }[]>();
    for (const p of core.places) {
      if (!p.hasRates || request.placeIds.includes(p.id)) continue;
      const k = countryName.get(p.countryId) ?? "Other";
      const g = groups.get(k) ?? [];
      g.push({ id: p.id, name: p.name });
      groups.set(k, g);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([country, list]) => ({ country, list: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [core, request.placeIds]);

  const addPlace = () => {
    const place = core.places.find((p) => p.id === newPlace);
    if (!place) return;
    const edit = addStop(request, stops, place.id, place.name);
    if (edit.request === request) {
      setNotice(`A trip can be at most ${MAX_TRIP_NIGHTS} nights, so ${place.name} can't be added.`);
      return;
    }
    apply(edit, `Added ${place.name} (${edit.request.nightOverrides[place.id]} nights) at the end of the route. If the planner can't fit it in, it will be listed under "Left out".`);
    setNewPlace("");
  };

  // ---- outings --------------------------------------------------------------
  const dropOuting = (day: PlannedDay) => {
    const drag = dragOuting;
    setDragOuting(null);
    setOverDay(null);
    if (!drag) return;
    const check = canPlaceOnDay(quote, drag.clusterId, day.dayNumber);
    if (!check.ok) return setNotice(check.reason);
    const current = quote.days.find((d) => d.activities.concat(d.excludedActivities).some((a) => a.clusterId === drag.clusterId));
    if (current?.dayNumber === day.dayNumber) return;
    const opt = options.find((o) => o.clusterId === drag.clusterId);
    onChange((r) => placeOuting(r, drag.clusterId, day.dayNumber, opt?.status !== "planned"));
    setNotice(`${drag.title} is now on Day ${day.dayNumber}.`);
  };

  const addSite = (o: SightseeingOption, day: PlannedDay) => {
    onChange((r) => placeOuting(r, o.clusterId!, day.dayNumber, true));
    setNotice(`Added ${o.title} to Day ${day.dayNumber}.`);
    setAddingToDay(null);
  };

  const toggleOuting = (o: Pick<SightseeingOption, "clusterId" | "status" | "title">, on: boolean) => {
    onChange((r) => setOutingOn(r, o, on));
    setNotice(`${o.title} ${on ? "added back" : "taken out"}.`);
  };

  const pinned = new Set(request.pinnedClusterIds);
  const excluded = new Set(request.excludedClusterIds);
  /** Wanted by the admin but the days are full. */
  const noRoom = options.filter((o) => o.status === "unscheduled" && o.clusterId && pinned.has(o.clusterId) && !excluded.has(o.clusterId));

  const dayRow = (stop: Stop, day: PlannedDay) => {
    const all = [...day.activities, ...day.excludedActivities].sort((x, y) => (x.slot ?? 0) - (y.slot ?? 0));
    const sameStopDays = quote.days.filter((d) => d.placeId === stop.placeId);
    const full = day.budgetHours > 0 && day.activeHours >= day.budgetHours - 0.05;
    const available = options.filter((o) => o.placeId === stop.placeId && o.clusterId && (o.status !== "planned" || excluded.has(o.clusterId)));
    const addable = available.filter((o) => !(o.status === "unscheduled" && pinned.has(o.clusterId!) && !excluded.has(o.clusterId!)));
    return (
      <li
        key={day.dayNumber}
        data-testid={`day-${day.dayNumber}`}
        onDragOver={(e) => {
          if (!dragOuting) return;
          e.preventDefault();
          setOverDay(day.dayNumber);
        }}
        onDragLeave={() => setOverDay((d) => (d === day.dayNumber ? null : d))}
        onDrop={(e) => {
          e.preventDefault();
          dropOuting(day);
        }}
        className="rounded-xl border p-3 transition-colors"
        style={{
          borderColor: overDay === day.dayNumber ? "var(--sun-deep)" : "var(--line)",
          background: overDay === day.dayNumber ? "color-mix(in srgb, var(--sun) 16%, var(--card))" : "var(--surface)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            Day {day.dayNumber}
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>{day.date}</span>
            {day.airport && (
              <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                {day.airport.kind === "arrival" ? "Land" : "Fly home"} · {day.airport.iata}
              </span>
            )}
          </span>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums" style={full ? { background: "var(--coral-soft)", color: "var(--accent)" } : { background: "var(--card)", color: "var(--muted)" }}>
            {day.activeHours}h of {day.budgetHours}h{full ? " · full" : ""}
          </span>
        </div>
        {day.notes.length > 0 && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{day.notes.join(" · ")}</p>}

        {all.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {all.map((a) => {
              const off = a.clusterId ? excluded.has(a.clusterId) : false;
              const movable = Boolean(a.clusterId) && !a.locked;
              return (
                <li
                  key={`${day.dayNumber}-${a.clusterId ?? a.title}`}
                  data-testid={a.clusterId ? `outing-${a.clusterId}` : undefined}
                  draggable={movable}
                  onDragStart={(e) => {
                    if (!movable) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", a.clusterId!);
                    setDragOuting({ clusterId: a.clusterId!, title: a.title });
                  }}
                  onDragEnd={() => {
                    setDragOuting(null);
                    setOverDay(null);
                  }}
                  className="flex items-start gap-2 rounded-lg border bg-[var(--card)] px-2.5 py-2"
                  style={{ borderColor: "var(--line)", cursor: movable ? "grab" : "default", opacity: dragOuting?.clusterId === a.clusterId ? 0.5 : 1 }}
                >
                  <span aria-hidden="true" className="select-none pt-0.5 text-sm" style={{ color: movable ? "var(--muted)" : "transparent" }}>⠿</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={`text-sm ${off ? "line-through opacity-50" : ""}`}>{a.title}</span>
                      <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                        {a.hours}h{a.pricePerPersonInr > 0 && ` · ${formatInr(a.pricePerPersonInr)} pp`}
                      </span>
                    </div>
                    {a.attractions.length > 0 && <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{a.attractions.slice(0, 4).join(" · ")}</p>}
                    {movable && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {sameStopDays.length > 1 && !off && (
                          <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
                            Day
                            <select
                              style={selectStyle}
                              className="rounded-md border px-1.5 py-0.5"
                              value={day.dayNumber}
                              aria-label={`Move ${a.title} to another day`}
                              onChange={(e) => {
                                const to = Number(e.target.value);
                                const opt = options.find((o) => o.clusterId === a.clusterId);
                                onChange((r) => placeOuting(r, a.clusterId!, to, opt?.status !== "planned"));
                                setNotice(`${a.title} is now on Day ${to}.`);
                              }}
                            >
                              {sameStopDays.map((d) => (
                                <option key={d.dayNumber} value={d.dayNumber}>
                                  {d.dayNumber} · {d.date}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <button
                          type="button"
                          className="text-xs font-semibold underline underline-offset-2"
                          style={{ color: off ? "var(--accent)" : "var(--ink-2)" }}
                          aria-label={off ? `Add ${a.title} back` : `Take ${a.title} out of the plan`}
                          onClick={() => toggleOuting({ clusterId: a.clusterId, status: "planned", title: a.title }, off)}
                        >
                          {off ? "Add back" : "Take out"}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {all.length === 0 && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {dragOuting ? "Drop here to plan it on this day." : "Nothing planned. A free day."}
          </p>
        )}

        <div className="mt-2">
          <button
            type="button"
            className={btnSmall}
            aria-expanded={addingToDay === day.dayNumber}
            aria-label={`Add a site to Day ${day.dayNumber}`}
            onClick={() => setAddingToDay((d) => (d === day.dayNumber ? null : day.dayNumber))}
          >
            + Add site
          </button>
          {addingToDay === day.dayNumber && (
            <div className="mt-2 rounded-xl border bg-[var(--card)] p-2" style={{ borderColor: "var(--line)" }} role="group" aria-label={`Sites available in ${stop.name}`}>
              {addable.length === 0 ? (
                <p className="px-2 py-1.5 text-xs" style={{ color: "var(--muted)" }}>Everything on offer in {stop.name} is already in the plan.</p>
              ) : (
                <ul className="flex max-h-64 flex-col divide-y divide-[var(--line)] overflow-y-auto">
                  {addable.map((o) => (
                    <li key={o.clusterId} className="flex items-center justify-between gap-3 px-2 py-2">
                      <span className="min-w-0 text-sm">
                        {o.title}
                        <span className="ml-2 text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                          {o.hours}h{o.pricePerPersonInr > 0 && ` · ${formatInr(o.pricePerPersonInr)} pp`}
                        </span>
                      </span>
                      <button type="button" className={btnSmall} aria-label={`Add ${o.title} to Day ${day.dayNumber}`} onClick={() => addSite(o, day)}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  /** The hop that arrives at this stop (its first visit). */
  const legTo = (placeId: string) => quote.days.find((d) => d.transfer && (d.transfer.legKey ?? d.placeId) === placeId)?.transfer ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Drag a stop by its handle to reorder the route, or use the arrows. Drag an outing to another day at the same destination. {chosen.length} stops · {totalNights} nights.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSmall} onClick={history.undo} disabled={!history.canUndo} aria-label="Undo last change">↶ Undo</button>
          <button type="button" className={btnSmall} onClick={history.redo} disabled={!history.canRedo} aria-label="Redo">↷ Redo</button>
          <button
            type="button"
            className={btnSmall}
            disabled={!request.placeOrder.length && !Object.keys(request.nightOverrides).length}
            onClick={() => {
              onChange(resetRoute);
              setNotice("The planner will order the route and split the nights again.");
            }}
          >
            Let the planner re-order
          </button>
        </div>
      </div>

      <p role="status" aria-live="polite" data-testid="route-notice" className="min-h-0 text-sm font-medium" style={{ color: "var(--ink-2)" }}>
        {notice}
      </p>

      {mismatch && (
        <p role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm" style={toneStyle.warning}>
          <span>
            Trip details say {mismatch.requested} nights but the stops below add up to {mismatch.route}. The stops win.
          </span>
          <button type="button" className={btnSmall} onClick={() => onChange((r) => ({ ...r, nights: Math.min(MAX_TRIP_NIGHTS, Math.max(1, mismatch.route)) }))}>
            Set trip to {mismatch.route} nights
          </button>
        </p>
      )}
      {hasSplitVisit(quote) && (
        <p className="rounded-xl border px-4 py-3 text-xs" style={toneStyle.info}>
          The planner split a stay across both ends of the trip (so the flight home leaves from a hotel by the airport). Editing the route here merges those nights into one stop.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Things to check">
          {warnings.map((message) => (
            <li key={message} className="rounded-xl border px-3.5 py-2.5 text-sm" style={toneStyle.warning}>{message}</li>
          ))}
        </ul>
      )}

      {quote.gateways && (
        <p className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--surface)" }}>
          <span className="font-semibold">Trip starts: </span>
          lands at {quote.gateways.arrival.name} ({quote.gateways.arrival.iata}), then on to {stops[0]?.name}.
        </p>
      )}

      {/* The route: short rows, so a stop can be dragged anywhere on one screen. */}
      <ol className="flex flex-col gap-2" aria-label="Route">
        {inItinerary.map((stop) => {
          const idx = indexOf(stop.placeId);
          const isDrop = overStop === stop.placeId && dragStop && dragStop !== stop.placeId;
          return (
            <li
              key={stop.placeId}
              data-testid={`stop-${stop.placeId}`}
              onDragOver={(e) => {
                if (!dragStop || !stop.chosen) return;
                e.preventDefault();
                setOverStop(stop.placeId);
              }}
              onDragLeave={() => setOverStop((s) => (s === stop.placeId ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragStop;
                setDragStop(null);
                setOverStop(null);
                if (from && stop.chosen) move(from, idx);
              }}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-[var(--card)] p-2.5 sm:px-4"
              style={{
                borderColor: isDrop ? "var(--sun-deep)" : "var(--line)",
                boxShadow: isDrop ? "inset 0 0 0 2px var(--sun-deep)" : "var(--shadow-sm)",
                opacity: dragStop === stop.placeId ? 0.5 : 1,
              }}
            >
              {stop.chosen ? (
                <span
                  draggable
                  role="img"
                  aria-label={`Drag ${stop.name} to reorder`}
                  data-testid={`handle-${stop.placeId}`}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", stop.placeId);
                    setDragStop(stop.placeId);
                  }}
                  onDragEnd={() => {
                    setDragStop(null);
                    setOverStop(null);
                  }}
                  className="flex h-11 w-9 cursor-grab select-none items-center justify-center rounded-lg text-lg active:cursor-grabbing"
                  style={{ color: "var(--muted)", background: "var(--surface)", touchAction: "none" }}
                >
                  ⠿
                </span>
              ) : (
                <span className="w-9" />
              )}
              <span className="flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums" style={{ background: "var(--surface)", border: "1px solid var(--line)" }} aria-hidden="true">
                {stop.chosen ? idx + 1 : "•"}
              </span>
              <h4 className="min-w-0 flex-1 basis-32 font-display text-lg">{stop.name}</h4>

              {stop.chosen ? (
                <>
                  <span className="inline-flex items-center gap-1" role="group" aria-label={`Nights in ${stop.name}`}>
                    <button type="button" className={btnSmall} aria-label={`One fewer night in ${stop.name}`} onClick={() => nights(stop, stop.nights - 1)} disabled={stop.nights <= 1}>−</button>
                    <span className="min-w-20 text-center text-sm font-bold tabular-nums" data-testid={`nights-${stop.placeId}`}>{stop.nights} night{stop.nights === 1 ? "" : "s"}</span>
                    <button type="button" className={btnSmall} aria-label={`One more night in ${stop.name}`} onClick={() => nights(stop, stop.nights + 1)} disabled={totalNights >= MAX_TRIP_NIGHTS}>+</button>
                  </span>
                  <span className="inline-flex gap-1">
                    <button type="button" className={btnSmall} aria-label={`Move ${stop.name} earlier`} onClick={() => move(stop.placeId, idx - 1)} disabled={idx <= 0}>↑</button>
                    <button type="button" className={btnSmall} aria-label={`Move ${stop.name} later`} onClick={() => move(stop.placeId, idx + 1)} disabled={idx >= chosen.length - 1}>↓</button>
                    <button type="button" className={btnSmall} aria-label={`Remove ${stop.name} from the trip`} onClick={() => remove(stop)} disabled={chosen.length <= 1}>Remove</button>
                  </span>
                </>
              ) : (
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={toneStyle.neutral}>
                  {stop.nights} night{stop.nights === 1 ? "" : "s"} · added by the planner (airport night)
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {leftOut.length > 0 && (
        <div className="rounded-xl border px-4 py-3 text-sm" style={toneStyle.warning} role="alert" data-testid="left-out">
          <p className="font-semibold">Left out of the itinerary</p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {leftOut.map((s) => (
              <li key={s.placeId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <strong>{s.name}</strong> is in the request but the planner did not schedule it.
                  {reasonFor(s.name) && <span className="block text-xs">{reasonFor(s.name)}</span>}
                </span>
                <button type="button" className={btnSmall} aria-label={`Remove ${s.name} from the trip`} onClick={() => remove(s)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Each stop's days: how it is reached, and what is planned on each day. */}
      <h4 className="mt-2 font-display text-xl">Day by day</h4>
      <ol className="flex flex-col gap-4" aria-label="Days by stop">
        {inItinerary.map((stop, position) => {
          const leg = position > 0 ? legTo(stop.placeId) : null;
          const days = quote.days.filter((d) => d.placeId === stop.placeId);
          return (
            <li key={stop.placeId} data-testid={`stopdays-${stop.placeId}`} className="rounded-2xl border bg-[var(--card)] p-3 sm:p-4" style={{ borderColor: "var(--line)" }}>
              <h5 className="font-display text-lg">
                {stop.name}
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>{stop.nights} night{stop.nights === 1 ? "" : "s"}</span>
              </h5>

              {leg && leg.alternatives.length > 0 && (
                <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface)" }}>
                  <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                    Getting here · {leg.from} → {leg.to}
                    {leg.distanceKm ? ` · ${leg.distanceKm} km` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={`Transport from ${leg.from} to ${leg.to}`}>
                    {leg.alternatives.map((alt) => {
                      const active = alt.mode === leg.mode;
                      return (
                        <button
                          key={alt.mode}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`${chipClass} !min-h-10 !px-3 text-xs`}
                          style={chipStyle(active)}
                          onClick={() => {
                            onChange((r) => ({ ...r, legModes: { ...r.legModes, [leg.legKey ?? stop.placeId]: alt.mode } }));
                            setNotice(`${leg.from} → ${leg.to} by ${modeLabel(alt.mode)}.`);
                          }}
                        >
                          <span className="capitalize">{modeLabel(alt.mode)}</span>
                          <span className="ml-1.5 font-normal tabular-nums">
                            {alt.includedInVehicle ? "in vehicle" : formatInr(alt.priceInr)} · {formatDuration(alt.minutes)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <ol className="mt-3 flex flex-col gap-2" aria-label={`Days in ${stop.name}`}>
                {days.map((d) => dayRow(stop, d))}
              </ol>
            </li>
          );
        })}
      </ol>

      {noRoom.length > 0 && (
        <div className="rounded-xl border px-4 py-3 text-sm" style={toneStyle.warning} role="status">
          <p className="font-semibold">Wanted, but no day has room</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {noRoom.map((o) => (
              <li key={o.clusterId} className="flex flex-wrap items-center justify-between gap-2">
                <span>{o.title} ({o.placeName}, {o.hours}h)</span>
                <button type="button" className={btnSmall} onClick={() => toggleOuting(o, false)}>Take out</button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs">Add a night at that destination, or take something else out of a full day.</p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-dashed p-4" style={{ borderColor: "var(--line-strong)" }}>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
          Add a destination
          <select value={newPlace} onChange={(e) => setNewPlace(e.target.value)} style={selectStyle} className="min-h-11 rounded-xl border px-3 text-sm font-normal" aria-label="Add a destination">
            <option value="">Choose a place…</option>
            {places.map((g) => (
              <optgroup key={g.country} label={g.country}>
                {g.list.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" className={btnSmall} disabled={!newPlace} onClick={addPlace}>
          + Add to trip
        </button>
      </div>
    </div>
  );
}
