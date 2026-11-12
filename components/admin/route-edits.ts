/**
 * Every change the admin can make to the route and the day plan, as plain
 * functions from one `QuoteRequest` to the next. The UI (drag, buttons, menus)
 * only decides *which* of these to call, so the rules live in one place and are
 * tested without a browser.
 *
 * The route is "frozen" the first time it is touched: the order, and the nights
 * at every stop, are written into the request so that what the admin sees is
 * exactly what is priced, and the planner stops moving things behind their back.
 */
import type { Quotation, QuoteRequest, SightseeingOption } from "@retro/core/atlas/engine/types";
import policy from "@/content/quote-policy.json";

export const MAX_TRIP_NIGHTS = policy.guardrails.maxNights;
export const DEFAULT_NEW_STOP_NIGHTS = 2;

export type Stop = {
  placeId: string;
  name: string;
  nights: number;
  /** In the request's own list. False for a night the planner added beside the airport. */
  chosen: boolean;
  /** In the request, but the planner left it out (e.g. not combinable with the rest). It has no nights. */
  dropped?: boolean;
};

/** The stops in travel order, a place visited twice shown once, with all its nights. */
export function stopsOf(quote: Pick<Quotation, "stays">, request: Pick<QuoteRequest, "placeIds">, nameOf: (placeId: string) => string = (id) => id): Stop[] {
  const byPlace = new Map<string, Stop>();
  for (const s of quote.stays) {
    const stop = byPlace.get(s.placeId);
    if (stop) stop.nights += s.nights;
    else byPlace.set(s.placeId, { placeId: s.placeId, name: s.placeName, nights: s.nights, chosen: request.placeIds.includes(s.placeId) });
  }
  // A place in the request that the engine did not put in the itinerary: shown, so it is never a silent no-op.
  for (const id of request.placeIds) {
    if (!byPlace.has(id)) byPlace.set(id, { placeId: id, name: nameOf(id), nights: 0, chosen: true, dropped: true });
  }
  return [...byPlace.values()];
}

/** The stops the admin orders and sets nights on: in the itinerary and picked by the request. */
const chosenOf = (stops: Stop[]) => stops.filter((s) => s.chosen && !s.dropped);
const droppedOf = (stops: Stop[]) => stops.filter((s) => s.dropped);

/** True when a place is visited in two separate spells (e.g. both ends of the trip). */
export function hasSplitVisit(quote: Pick<Quotation, "stays">): boolean {
  const seen = new Set<string>();
  for (const s of quote.stays) {
    if (seen.has(s.placeId)) return true;
    seen.add(s.placeId);
  }
  return false;
}

/**
 * Write the current route into the request: order, nights per stop, and the
 * total (the sum, so the trip length can never disagree with the stops).
 */
export function freeze(r: QuoteRequest, stops: Stop[]): QuoteRequest {
  const chosen = chosenOf(stops);
  return {
    ...r,
    // Left-out places stay in the list (at the end) until the admin removes them.
    placeIds: [...chosen, ...droppedOf(stops)].map((s) => s.placeId),
    placeOrder: chosen.map((s) => s.placeId),
    nightOverrides: Object.fromEntries(chosen.map((s) => [s.placeId, s.nights])),
    nights: Math.max(1, Math.min(MAX_TRIP_NIGHTS, chosen.reduce((a, s) => a + s.nights, 0))),
  };
}

/**
 * A pinned transport mode belongs to one hop: "arrive in B from A". Once B's
 * neighbour changes it is a different hop and the pin would quietly apply to a
 * journey the admin never chose it for, so it is dropped. Pins on hops that did
 * not change are kept. Returns the kept map and how many were dropped.
 */
export function keepLegModes(
  legModes: QuoteRequest["legModes"],
  before: string[],
  after: string[],
): { legModes: QuoteRequest["legModes"]; dropped: number } {
  const previous = (order: string[], id: string) => (order.indexOf(id) > 0 ? order[order.indexOf(id) - 1] : null);
  const next: QuoteRequest["legModes"] = {};
  let dropped = 0;
  for (const [key, mode] of Object.entries(legModes)) {
    const placeId = key.split("#")[0];
    const isStopKey = before.includes(placeId) || after.includes(placeId);
    if (!isStopKey) {
      next[key] = mode; // an airport link: tied to a place, not to its neighbour
      continue;
    }
    const sameHop = !key.includes("#") && after.includes(placeId) && previous(before, placeId) === previous(after, placeId);
    if (sameHop) next[key] = mode;
    else dropped++;
  }
  return { legModes: next, dropped };
}

export type RouteEdit = { request: QuoteRequest; droppedLegPins: number };

/** Move the stop at `from` so it sits at `to` (indexes among the stops the admin controls). */
export function moveStop(r: QuoteRequest, stops: Stop[], from: number, to: number): RouteEdit {
  const chosen = chosenOf(stops);
  if (from === to || from < 0 || to < 0 || from >= chosen.length || to >= chosen.length) return { request: r, droppedLegPins: 0 };
  const order = chosen.map((s) => s.placeId);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const frozen = freeze(r, stops);
  const kept = keepLegModes(r.legModes, chosen.map((s) => s.placeId), order);
  // placeIds follows too: the summary line and the traveller's email read it, and must name the stops in travel order.
  const leftOut = droppedOf(stops).map((d) => d.placeId);
  return { request: { ...frozen, placeIds: [...order, ...leftOut], placeOrder: order, legModes: kept.legModes }, droppedLegPins: kept.dropped };
}

/** Set one stop's nights. 1 to 28; the trip length follows. Returns the request unchanged at the limits. */
export function setStopNights(r: QuoteRequest, stops: Stop[], placeId: string, nights: number): QuoteRequest {
  const n = Math.round(nights);
  const chosen = chosenOf(stops);
  const others = chosen.filter((s) => s.placeId !== placeId).reduce((a, s) => a + s.nights, 0);
  if (!chosen.some((s) => s.placeId === placeId) || n < 1 || others + n > MAX_TRIP_NIGHTS) return r;
  return freeze(r, stops.map((s) => (s.placeId === placeId ? { ...s, nights: n } : s)));
}

/** Take a stop out of the trip. The last one cannot be removed: a trip needs somewhere to go. */
export function removeStop(r: QuoteRequest, stops: Stop[], placeId: string): RouteEdit {
  const chosen = chosenOf(stops);
  const dropped = droppedOf(stops).some((s) => s.placeId === placeId);
  if (!dropped && (chosen.length <= 1 || !chosen.some((s) => s.placeId === placeId))) return { request: r, droppedLegPins: 0 };
  const remaining = stops.filter((s) => s.placeId !== placeId);
  const frozen = freeze(r, remaining);
  const before = chosen.map((s) => s.placeId);
  const kept = keepLegModes(r.legModes, before, before.filter((id) => id !== placeId));
  // Clusters belong to the place; a removed place's outings go with it.
  // Cluster ids are `<placeId>:cluster:<slug>`; the colon keeps `new-york` apart from `new-york-city`.
  const stale = (id: string) => id.startsWith(`${placeId}:cluster:`);
  return {
    request: {
      ...frozen,
      legModes: kept.legModes,
      pinnedClusterIds: r.pinnedClusterIds.filter((id) => !stale(id)),
      excludedClusterIds: r.excludedClusterIds.filter((id) => !stale(id)),
      clusterDays: Object.fromEntries(Object.entries(r.clusterDays).filter(([id]) => !stale(id))),
    },
    droppedLegPins: kept.dropped,
  };
}

/** Add a destination at `position` (default: the end) with a starting number of nights. */
export function addStop(r: QuoteRequest, stops: Stop[], placeId: string, name: string, position?: number, nights = DEFAULT_NEW_STOP_NIGHTS): RouteEdit {
  const chosen = chosenOf(stops);
  if (stops.some((s) => s.placeId === placeId)) return { request: r, droppedLegPins: 0 };
  const total = chosen.reduce((a, s) => a + s.nights, 0);
  const n = Math.max(1, Math.min(nights, MAX_TRIP_NIGHTS - total));
  if (total + 1 > MAX_TRIP_NIGHTS) return { request: r, droppedLegPins: 0 };
  const at = position == null ? chosen.length : Math.max(0, Math.min(position, chosen.length));
  const next = [...chosen];
  next.splice(at, 0, { placeId, name, nights: n, chosen: true });
  const before = chosen.map((s) => s.placeId);
  const kept = keepLegModes(r.legModes, before, next.map((s) => s.placeId));
  const frozen = freeze(r, [...next, ...droppedOf(stops)]);
  return { request: { ...frozen, legModes: kept.legModes }, droppedLegPins: kept.dropped };
}

/** Give the route back to the planner: its order, its night split. The stops and total stay. */
export function resetRoute(r: QuoteRequest): QuoteRequest {
  return { ...r, placeOrder: [], nightOverrides: {}, legModes: {} };
}

/** The trip length the request claims versus what its stops add up to. */
export function nightsMismatch(r: QuoteRequest, stops: Stop[]): { requested: number; route: number } | null {
  const route = chosenOf(stops).reduce((a, s) => a + s.nights, 0);
  return route !== r.nights ? { requested: r.nights, route } : null;
}

// ---------------------------------------------------------------------------
// Day plan
// ---------------------------------------------------------------------------

/** Where an outing may go: only days spent at its own destination. */
export function canPlaceOnDay(quote: Pick<Quotation, "days" | "sightseeingOptions">, clusterId: string, dayNumber: number): { ok: true } | { ok: false; reason: string } {
  const option = quote.sightseeingOptions?.find((o) => o.clusterId === clusterId);
  const day = quote.days.find((d) => d.dayNumber === dayNumber);
  if (!option || !day) return { ok: false, reason: "That outing or day is no longer in the trip." };
  if (day.placeId !== option.placeId) {
    return { ok: false, reason: `${option.title} is in ${option.placeName}, so it can only go on a day spent there. To do it on Day ${dayNumber}, move the ${option.placeName} stop instead.` };
  }
  return { ok: true };
}

/** Put an outing on a day. `add` also pins it, for one that was not in the plan; a planned outing is only moved. */
export function placeOuting(r: QuoteRequest, clusterId: string, dayNumber: number, add: boolean): QuoteRequest {
  return {
    ...r,
    clusterDays: { ...r.clusterDays, [clusterId]: dayNumber },
    pinnedClusterIds: add && !r.pinnedClusterIds.includes(clusterId) ? [...r.pinnedClusterIds, clusterId] : r.pinnedClusterIds,
    excludedClusterIds: r.excludedClusterIds.filter((id) => id !== clusterId),
  };
}

/** Switch an outing on or off with the rule each sightseeing mode needs. */
export function setOutingOn(r: QuoteRequest, option: Pick<SightseeingOption, "clusterId" | "status">, on: boolean): QuoteRequest {
  const id = option.clusterId;
  if (!id) return r;
  const pinned = new Set(r.pinnedClusterIds);
  const excluded = new Set(r.excludedClusterIds);
  if (on) {
    excluded.delete(id);
    if (r.sightseeingMode === "manual" || option.status !== "planned") pinned.add(id);
  } else if (r.sightseeingMode === "manual") {
    pinned.delete(id);
  } else {
    excluded.add(id);
    pinned.delete(id);
  }
  return { ...r, pinnedClusterIds: [...pinned], excludedClusterIds: [...excluded] };
}
