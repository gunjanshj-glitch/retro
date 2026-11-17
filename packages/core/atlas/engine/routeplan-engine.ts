/**
 * Connects the route planner (`routeplan.ts`) to the catalogue: which airport serves each stop, what a return
 * fare to it costs, and what a hop between two stops costs and takes. Everything the planner needs comes from
 * data the quotation already holds, so a planned route and its price never disagree about the inputs.
 */
import type { CoreBundle, FlightBand } from "../schema";
import { haversineKm } from "./geo";
import {
  GATEWAY_EXIT_DISCOUNT, GATEWAY_KM_WEIGHT, ORDER_PRECEDENCE, PRECEDENCE_PENALTY, THIN_GATEWAY_KM,
  type RouteLookup,
} from "./itinerary";
import {
  bestPerObjective, costOfOrder, planRoutes, rankRoutes,
  type RouteCandidate, type RoutePlanInput,
} from "./routeplan";
import type { QuoteRequest, RoutePlanInfo } from "./types";

type Pt = { lat: number; lon: number };

/** The planner's fare is a stand-in only where the catalogue has no band for a country. */
const FALLBACK_INR_PER_KM_RETURN = 6;
const FALLBACK_MIN_FARE_INR = 6000;
/** A hop with no known route or coordinates: a day's worth of travel and a day's worth of money. */
const UNKNOWN_HOP = { inr: 12_000, minutes: 600 };
/** Straight-line fallback for a hop the route table cannot price. */
const FALLBACK_HOP_INR_PER_KM = 8;
const FALLBACK_HOP_KMH = 50;

/** The catalogue band a return fare to this country is read from: same choice of carrier and cabin the pricer makes. */
function pickBand(core: CoreBundle, countryId: string, request: Pick<QuoteRequest, "carrier" | "cabin" | "departureCity">): FlightBand | undefined {
  const forCountry = core.flightBands.filter((b) => b.destCountryId === countryId);
  const exact = forCountry.filter((b) => b.carrier === request.carrier && b.cabin === request.cabin);
  const sameCabin = forCountry.filter((b) => b.cabin === request.cabin);
  const economy = forCountry.filter((b) => b.cabin === "Economy");
  const pool = exact.length ? exact : sameCabin.length ? sameCabin : economy;
  return pool.find((b) => b.originCity === request.departureCity) ?? pool.find((b) => b.originCity === "*") ?? pool[0];
}

export type PlanStopInput = { id: string; nights: number };

/** Builds the planner's inputs for the stops of a trip. */
export function buildRoutePlanInput(
  core: CoreBundle,
  request: Pick<QuoteRequest, "carrier" | "cabin" | "departureCity">,
  stops: PlanStopInput[],
  lookup: RouteLookup,
  names: Map<string, string>,
): RoutePlanInput {
  const placeById = new Map(core.places.map((p) => [p.id, p]));
  const home = (core.departureCities ?? []).find((c) => c.code === request.departureCity);
  const homePt: Pt | null = home?.lat != null && home.lon != null ? { lat: home.lat, lon: home.lon } : null;

  const airportOf = (id: string) => core.placeAirports?.[id] ?? null;
  const point = (id: string): Pt | null => {
    const a = airportOf(id);
    if (a) return { lat: a.lat, lon: a.lon };
    const p = placeById.get(id);
    return p && p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null;
  };

  // Within one country the band is a single figure; airports nearer home cost a little less than the average
  // of the airports in the trip and farther ones a little more, so landing at the closer gateway is rewarded.
  const distHome = (id: string) => (homePt && point(id) ? haversineKm(homePt, point(id)!) : null);
  const meanByCountry = new Map<string, number>();
  const group = new Map<string, number[]>();
  for (const s of stops) {
    const c = placeById.get(s.id)?.countryId;
    const d = distHome(s.id);
    if (!c || d == null) continue;
    const list = group.get(c) ?? [];
    // One entry per distinct airport, so a country with three stops on one airport is not weighted by them.
    list.push(d);
    group.set(c, list);
  }
  for (const [c, list] of group) meanByCountry.set(c, list.reduce((a, b) => a + b, 0) / list.length);

  const roundTripInr = (id: string): number => {
    const countryId = placeById.get(id)?.countryId;
    const band = countryId ? pickBand(core, countryId, request) : undefined;
    const d = distHome(id);
    if (!band) return Math.max(FALLBACK_MIN_FARE_INR, (d ?? 3000) * FALLBACK_INR_PER_KM_RETURN);
    const base = (band.priceLow + band.priceHigh) / 2;
    const mean = countryId ? meanByCountry.get(countryId) : undefined;
    if (!mean || d == null) return base;
    const factor = Math.min(1.2, Math.max(0.85, d / mean));
    return base * factor;
  };

  const hop = (a: string, b: string) => {
    const hit = lookup.best(a, b, "balanced", 1);
    if (hit) return { inr: hit.priceInr, minutes: hit.minutes };
    const pa = point(a);
    const pb = point(b);
    if (!pa || !pb) return UNKNOWN_HOP;
    const km = haversineKm(pa, pb);
    return { inr: km * FALLBACK_HOP_INR_PER_KM, minutes: (km / FALLBACK_HOP_KMH) * 60 };
  };

  // The sequencer's own judgement, carried over: authored order rules, and landing at the gateway nearest home
  // (a thin airport counts as farther). Without it the planner would see Munich-then-Interlaken and the reverse as
  // the same trip and pick between them by name.
  // Fares already reflect distance (see `roundTripInr`), so the distance part is only a tie-break here; a thin
  // airport's penalty keeps its full weight, since that is knowledge the fare table does not have.
  const DISTANCE_TIEBREAK = 0.1;
  const entryKm = (id: string) => (distHome(id) ?? 0) * DISTANCE_TIEBREAK + (THIN_GATEWAY_KM.get(id) ?? 0);
  const penalty = (order: string[], returnVia: string | null) => {
    const broken = ORDER_PRECEDENCE.filter((r) => {
      const a = order.indexOf(r.first);
      const b = order.indexOf(r.then);
      return a >= 0 && b >= 0 && a > b;
    }).length;
    const end = returnVia ?? order[order.length - 1];
    return broken * PRECEDENCE_PENALTY + (entryKm(order[0]) + entryKm(end) * GATEWAY_EXIT_DISCOUNT) * GATEWAY_KM_WEIGHT;
  };

  return {
    penalty,
    stops: stops.map((s) => ({
      id: s.id,
      nights: s.nights,
      airport: airportOf(s.id)?.iata ?? null,
      airportName: airportOf(s.id)?.name ?? names.get(s.id),
    })),
    hop,
    roundTripInr,
  };
}

const view = (c: RouteCandidate, names: Map<string, string>) => ({
  id: c.id,
  order: c.order,
  names: c.order.map((id) => names.get(id) ?? id),
  returnVia: c.returnVia,
  entryAirport: c.entryAirport,
  exitAirport: c.exitAirport,
  openJaw: c.openJaw,
  flightInr: c.flightInr,
  groundInr: c.groundInr,
  groundMinutes: c.groundMinutes,
  totalInr: c.totalInr,
  pareto: c.pareto,
});

/** How many ranked plans travel to the client. */
const SHOWN = 6;

/** The ranked plans, the chosen one, and the best for each objective, in the shape a quotation carries. */
export function describeRoutePlan(
  input: RoutePlanInput,
  request: Pick<QuoteRequest, "transportPreference">,
  names: Map<string, string>,
  /** What the quotation actually travels: the stops in order, and any stop returned to at the end. */
  actual: { order: string[]; returnVia: string | null },
  /** Whether the traveller or admin set the order by hand. */
  manual: boolean,
): RoutePlanInfo {
  const objective = request.transportPreference;
  const ranked = planRoutes(input, objective);
  const suggested = ranked[0] ?? null;
  const current = costOfOrder(input, actual.order, objective, actual.returnVia) ?? suggested;
  const best = bestPerObjective(ranked);
  const top = rankRoutes(ranked, objective).slice(0, SHOWN);
  // The chosen plan is always listed, even when it is ranked below the cut.
  const listed = current && !top.some((c) => c.id === current.id) ? [...top, current] : top;
  return {
    objective,
    manual,
    suggestedId: suggested?.id ?? null,
    currentId: current?.id ?? null,
    candidateCount: ranked.length,
    candidates: listed.map((c) => view(c, names)),
    best: {
      cheapest: best.cheapest ? best.cheapest.id : null,
      balanced: best.balanced ? best.balanced.id : null,
      fastest: best.fastest ? best.fastest.id : null,
    },
    stops: input.stops.map((s) => ({ id: s.id, name: names.get(s.id) ?? s.id, nights: s.nights, airport: s.airport ?? null })),
  };
}
