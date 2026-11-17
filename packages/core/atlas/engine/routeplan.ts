/**
 * Route planner: where to land, in what order to travel, and where to fly home from.
 *
 * The sequencer in `itinerary.ts` orders stops by the cost of the hops between them
 * plus a distance term for the gateway. That is blind to the thing that usually moves
 * the price most: a return ticket flown in and out of the *same* airport is cheaper
 * than an open-jaw one, and an itinerary can be bent to make that possible
 * (A → B → C → back to A, then fly home) when A, B and C are close together. When
 * they are far apart, doubling back costs more than the saving, and the better plan
 * flies out of the last stop instead.
 *
 * This module scores every candidate plan on the same three things the traveller already
 * chooses between: money, time, and a balance of the two. It is pure and synchronous:
 * costs come in through `RoutePlanInput`, so the algorithm is tested without any catalogue.
 *
 * A plan is
 *   - an order of the stops,
 *   - the airport it lands at (the first stop's) and the airport it leaves from, which
 *     is the last stop's, or an earlier stop's when `returnVia` sends the traveller back.
 *
 * Search: every order when there are at most `EXHAUSTIVE_MAX` stops (8! = 40,320 orders,
 * a few milliseconds with cached hops), otherwise nearest-neighbour tours from every start
 * improved by 2-opt, plus their reverses. Each order is then expanded into its exit variants.
 */
import type { TransportPreference } from "./itinerary";

/** Exhaustive search up to this many stops. */
export const EXHAUSTIVE_MAX = 8;

/**
 * What an hour of the traveller's time is worth, in INR, per objective. Deliberately the same
 * figures the transport router uses (`HOUR_VALUE_INR` in itinerary.ts), so "cheapest",
 * "balanced" and "fastest" mean one thing across the product.
 */
export const OBJECTIVE_HOUR_VALUE_INR: Record<TransportPreference, number> = {
  cheapest: 60,
  balanced: 500,
  fastest: 2500,
};

/**
 * How much dearer an open-jaw ticket (in at one airport, home from another) is than the same
 * return flown from a single airport. Return fares are priced as a pair; splitting them costs
 * extra, and this is what lets a small premium be weighed against a long drive back.
 */
export const OPEN_JAW_PREMIUM = 0.05;

export type PlanStop = {
  id: string;
  /** Nights allocated to the stop; a stop needs at least two to be revisited at the end. */
  nights: number;
  /**
   * The airport serving the stop (IATA, or any stable key). Two stops with the same key share
   * an airport, so flying out of either is the same return ticket. Null falls back to the stop id.
   */
  airport: string | null;
  /** Shown to people; falls back to the airport key. */
  airportName?: string;
};

export type HopCost = { inr: number; minutes: number };

export type RoutePlanInput = {
  stops: PlanStop[];
  /** Ground or air cost of getting from one stop to another, per traveller. */
  hop: (fromId: string, toId: string) => HopCost;
  /** The return fare home to the airport serving this stop, per traveller. */
  roundTripInr: (stopId: string) => number;
  /** Open-jaw surcharge as a fraction of the fare; defaults to `OPEN_JAW_PREMIUM`. */
  openJawPremium?: number;
  /** Let a plan return to an earlier stop for its flight home. Default true. */
  allowReturnVia?: boolean;
  /** Fix the first stop (where the traveller must land). */
  fixedFirst?: string;
  /**
   * Known preferences that are not money or time: authored "this stop comes before that one" rules, a thin
   * airport counting as farther from home. In INR-equivalents, added to the score but not to the price shown.
   */
  penalty?: (order: string[], returnVia: string | null) => number;
};

export type RouteCandidate = {
  /** Stable key: the visiting order and, when set, the stop returned to. */
  id: string;
  /** Stops in the order they are visited, each once. */
  order: string[];
  /** The earlier stop the traveller goes back to before flying home; null when the trip ends where it ends. */
  returnVia: string | null;
  entryAirport: string;
  exitAirport: string;
  /** In and out of different airports. */
  openJaw: boolean;
  flightInr: number;
  /** Money spent moving between stops, the way back to `returnVia` included. */
  groundInr: number;
  groundMinutes: number;
  /** Flights plus ground, per traveller. */
  totalInr: number;
  /** Authored ordering preferences counted against the plan; part of `score`, not of `totalInr`. */
  penalty: number;
  /** Total cost with time priced at the objective's rate, plus `penalty`; lower is better. */
  score: number;
  /** No other candidate is both cheaper and quicker. */
  pareto: boolean;
};

const airportKey = (s: PlanStop) => s.airport ?? s.id;

/** All orders of `items`, in a deterministic order. */
function* permutations<T>(items: T[]): Generator<T[]> {
  const a = [...items];
  const n = a.length;
  const c = new Array<number>(n).fill(0);
  yield [...a];
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [a[k], a[i]] = [a[i], a[k]];
      yield [...a];
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/** A tour of the stops built greedily from `start`, then improved by 2-opt on `dist`. */
function greedyTour(ids: string[], start: string, dist: (a: string, b: string) => number): string[] {
  const left = new Set(ids);
  left.delete(start);
  const tour = [start];
  while (left.size) {
    const from = tour[tour.length - 1];
    let pick = "";
    let best = Infinity;
    for (const id of left) {
      const d = dist(from, id);
      if (d < best - 1e-9 || (Math.abs(d - best) <= 1e-9 && id < pick)) {
        best = d;
        pick = id;
      }
    }
    tour.push(pick);
    left.delete(pick);
  }
  let improved = true;
  let guard = 0;
  const len = (t: string[]) => t.slice(1).reduce((s, id, i) => s + dist(t[i], id), 0);
  let cur = len(tour);
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const cand = [...tour.slice(0, i), ...tour.slice(i, j + 1).reverse(), ...tour.slice(j + 1)];
        const l = len(cand);
        if (l < cur - 1e-9) {
          tour.splice(0, tour.length, ...cand);
          cur = l;
          improved = true;
        }
      }
    }
  }
  return tour;
}

/** The orders worth scoring: all of them for a small trip, otherwise the best tours from each start. */
export function candidateOrders(
  ids: string[],
  hop: RoutePlanInput["hop"],
  fixedFirst?: string,
): string[][] {
  if (ids.length <= 1) return [[...ids]];
  if (ids.length <= EXHAUSTIVE_MAX) {
    const out: string[][] = [];
    for (const p of permutations([...ids].sort())) if (!fixedFirst || p[0] === fixedFirst) out.push(p);
    return out;
  }
  const dist = (a: string, b: string) => {
    const h = hop(a, b);
    return h.inr + (h.minutes / 60) * OBJECTIVE_HOUR_VALUE_INR.balanced;
  };
  const seen = new Set<string>();
  const out: string[][] = [];
  const add = (t: string[]) => {
    const k = t.join(">");
    if (seen.has(k) || (fixedFirst && t[0] !== fixedFirst)) return;
    seen.add(k);
    out.push(t);
  };
  for (const start of [...ids].sort()) {
    const t = greedyTour(ids, start, dist);
    add(t);
    add([...t].reverse());
  }
  return out;
}

/** Marks the candidates no other candidate beats on both price and time. */
function markPareto(list: RouteCandidate[]): void {
  const sorted = [...list].sort((a, b) => a.totalInr - b.totalInr || a.groundMinutes - b.groundMinutes);
  let bestMinutes = Infinity;
  for (const c of sorted) {
    c.pareto = c.groundMinutes < bestMinutes - 1e-9;
    if (c.pareto) bestMinutes = c.groundMinutes;
  }
}

/** Ranks plans best-first for an objective. Ties fall to price, then time, then the order itself. */
export function rankRoutes(list: RouteCandidate[], objective: TransportPreference): RouteCandidate[] {
  const rate = OBJECTIVE_HOUR_VALUE_INR[objective];
  const scored = list.map((c) => ({ ...c, score: c.totalInr + (c.groundMinutes / 60) * rate + c.penalty }));
  return scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.totalInr - b.totalInr ||
      a.groundMinutes - b.groundMinutes ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Builds scored plans from one input, sharing the hop and fare caches. */
function makeBuilder(input: RoutePlanInput) {
  const byId = new Map(input.stops.map((s) => [s.id, s]));
  const premium = input.openJawPremium ?? OPEN_JAW_PREMIUM;
  const hopCache = new Map<string, HopCost>();
  const hop = (a: string, b: string): HopCost => {
    const k = `${a}|${b}`;
    let v = hopCache.get(k);
    if (!v) {
      v = input.hop(a, b);
      hopCache.set(k, v);
    }
    return v;
  };
  const fareCache = new Map<string, number>();
  const fare = (id: string) => {
    let v = fareCache.get(id);
    if (v == null) {
      v = input.roundTripInr(id);
      fareCache.set(id, v);
    }
    return v;
  };
  const build = (order: string[], via: string | null): RouteCandidate => {
    let gi = 0;
    let gm = 0;
    for (let i = 0; i < order.length - 1; i++) {
      const h = hop(order[i], order[i + 1]);
      gi += h.inr;
      gm += h.minutes;
    }
    const first = byId.get(order[0])!;
    const last = byId.get(order[order.length - 1])!;
    let exitStop = last;
    if (via) {
      const h = hop(last.id, via);
      gi += h.inr;
      gm += h.minutes;
      exitStop = byId.get(via)!;
    }
    const openJaw = airportKey(first) !== airportKey(exitStop);
    const flightInr = openJaw ? ((fare(first.id) + fare(exitStop.id)) / 2) * (1 + premium) : fare(first.id);
    return {
      id: via ? `${order.join(">")}~${via}` : order.join(">"),
      order,
      returnVia: via,
      entryAirport: airportKey(first),
      exitAirport: airportKey(exitStop),
      openJaw,
      flightInr: Math.round(flightInr),
      groundInr: Math.round(gi),
      groundMinutes: Math.round(gm),
      totalInr: Math.round(flightInr + gi),
      penalty: Math.round(input.penalty?.(order, via) ?? 0),
      score: 0,
      pareto: false,
    };
  };
  return { byId, hop, build };
}

/**
 * Every plan worth considering, scored for `objective` and sorted best-first.
 * An empty or single-stop trip has exactly one plan.
 */
export function planRoutes(input: RoutePlanInput, objective: TransportPreference = "balanced"): RouteCandidate[] {
  const { stops } = input;
  if (!stops.length) return [];
  const { byId, hop, build } = makeBuilder(input);
  const allowReturn = input.allowReturnVia ?? true;
  const orders = candidateOrders(stops.map((s) => s.id), hop, input.fixedFirst);
  const out: RouteCandidate[] = [];

  for (const order of orders) {
    out.push(build(order, null));
    if (!allowReturn) continue;
    const last = byId.get(order[order.length - 1])!;
    for (let i = 0; i < order.length - 1; i++) {
      const s = byId.get(order[i])!;
      // Going back means a night there, so the stop must have one to give; and going back to an
      // airport the trip already ends at changes nothing.
      if (s.nights >= 2 && airportKey(s) !== airportKey(last)) out.push(build(order, s.id));
    }
  }

  markPareto(out);
  return rankRoutes(out, objective);
}

/** Best plan for each objective, for showing "cheapest / balanced / fastest" side by side. */
export function bestPerObjective(list: RouteCandidate[]): Record<TransportPreference, RouteCandidate | null> {
  const pick = (o: TransportPreference) => rankRoutes(list, o)[0] ?? null;
  return { cheapest: pick("cheapest"), balanced: pick("balanced"), fastest: pick("fastest") };
}

/** The same trip in the opposite direction. */
export function reverseOrder(order: string[]): string[] {
  return [...order].reverse();
}

/** A shuffled copy, driven by `rand` (0 ≤ r < 1) so a test can fix the outcome. */
export function shuffledOrder(order: string[], rand: () => number = Math.random): string[] {
  const a = [...order];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Moves the stop at `from` to index `to`, as a drag in a list does. Out-of-range indexes are ignored. */
export function moveInOrder(order: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return [...order];
  const a = [...order];
  const [m] = a.splice(from, 1);
  a.splice(to, 0, m);
  return a;
}

/**
 * Cost of an order the traveller chose, on the same footing as the planner's own plans, so the board can
 * say "this costs ₹X more than the suggestion". The trip ends at its last stop, or at `returnVia`.
 */
export function costOfOrder(
  input: RoutePlanInput,
  order: string[],
  objective: TransportPreference = "balanced",
  returnVia: string | null = null,
): RouteCandidate | null {
  const known = order.filter((id) => input.stops.some((s) => s.id === id));
  if (!known.length) return null;
  const { build } = makeBuilder(input);
  const c = build(known, returnVia && known.includes(returnVia) ? returnVia : null);
  return { ...c, score: c.totalInr + (c.groundMinutes / 60) * OBJECTIVE_HOUR_VALUE_INR[objective] + c.penalty };
}
