import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import type { QuoteRequest } from "@retro/core/atlas/engine/types";

const ATLAS = path.join("public", "atlas");
const read = (p: string) => JSON.parse(readFileSync(path.join(ATLAS, p), "utf8"));
const core = CoreBundle.parse(read("core.json"));
const routes: Route[] = read("routes.json").routes;
const visaRules: VisaRule[] = read("visa.json").rules;

function quote(ids: string[], nights: number, over: Partial<QuoteRequest> = {}) {
  const bundles = new Map<string, DestinationBundle>();
  for (const id of ids) {
    const place = core.places.find((p) => p.id === id)!;
    bundles.set(id, JSON.parse(readFileSync(path.join(ATLAS, "destinations", `${place.slug}.json`), "utf8")));
  }
  const request: QuoteRequest = {
    placeIds: ids, nights, startDate: "2026-06-10", adults: 2, childAges: [],
    travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "DEL",
    hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast",
    food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: false, includeFlight: true,
    interests: [], firstTimeVisitor: true, transportPreference: "balanced", legModes: {},
    excludedActivityCodes: [], excludedClusterIds: [], excludedLineKeys: [], lineOverrides: {}, marginPct: null,
    componentMarginPct: {}, customLines: [], sightseeingMode: "auto", addedActivityCodes: [], pinnedClusterIds: [],
    placeOrder: [], routeMode: "auto", nightOverrides: {}, clusterDays: {},
    ...over,
  } as QuoteRequest;
  return generateQuotation(request, { core, routes, visaRules, bundles });
}

const shape = (q: ReturnType<typeof quote>) => q.stays.map((s) => `${s.placeId}:${s.nights}`).join(">");

const TRIPS: [string[], number][] = [
  [["paris", "amsterdam", "brussels"], 7],
  [["paris", "rome", "zurich"], 9],
  [["dubai", "abu-dhabi", "muscat"], 7],
  [["tokyo", "kyoto", "osaka"], 8],
  [["bangkok", "pattaya", "phuket"], 8],
  [["ha-noi", "danang", "hochiminh", "phu-quoc"], 10],
];

describe("route planner inside the quotation engine", () => {
  it("never prices a trip above what the distance-based sequencer would have", () => {
    for (const [ids, n] of TRIPS) {
      const auto = quote(ids, n);
      const classic = quote(ids, n, { routeMode: "classic" });
      expect(auto.totals.total, ids.join()).toBeLessThanOrEqual(classic.totals.total);
    }
  });

  it("when it flies home from the airport it landed at, bills one return ticket and keeps every night", () => {
    // Which plan wins depends on the fares and distances in the catalogue, so this holds for whatever it chose.
    for (const [ids, n] of TRIPS) {
      const q = quote(ids, n);
      const plan = q.routePlan!;
      const current = plan.candidates.find((c) => c.id === plan.currentId)!;
      expect(q.stays.reduce((a, s) => a + s.nights, 0)).toBe(n);
      if (!current.returnVia) continue;
      // The trip ends where it began: no open jaw, and the last stay is the stop it went back to.
      expect(q.stays[q.stays.length - 1].placeId).toBe(current.returnVia);
      expect(q.stays[0].placeId).toBe(q.stays[q.stays.length - 1].placeId);
      expect(q.gateways?.arrival.iata).toBe(q.gateways?.departure.iata);
      expect(q.lineItems.filter((l) => l.component === "flight").every((l) => !/^Open-jaw/.test(l.label))).toBe(true);
    }
  });

  it("flies home from the first stop when a hand-set route says so", () => {
    const q = quote(["paris", "amsterdam", "brussels"], 7, { placeOrder: ["brussels", "amsterdam", "paris", "brussels"] });
    expect(q.stays.map((s) => s.placeId)).toEqual(["brussels", "amsterdam", "paris", "brussels"]);
    expect(q.stays.reduce((a, s) => a + s.nights, 0)).toBe(7);
    expect(q.routePlan!.candidates.find((c) => c.id === q.routePlan!.currentId)!.returnVia).toBe("brussels");
    expect(q.gateways?.arrival.iata).toBe(q.gateways?.departure.iata);
  });

  it("still visits every chosen place once with its nights, whatever order it picks", () => {
    for (const [ids, n] of TRIPS) {
      const q = quote(ids, n);
      expect(new Set(q.stays.map((s) => s.placeId))).toEqual(new Set(ids));
      expect(q.stays.reduce((a, s) => a + s.nights, 0)).toBe(n);
    }
  });

  it("reports what it considered, with the chosen plan among the candidates", () => {
    const q = quote(["paris", "rome", "zurich"], 9);
    const plan = q.routePlan!;
    expect(plan).toBeDefined();
    expect(plan.manual).toBe(false);
    expect(plan.candidateCount).toBeGreaterThan(6);
    expect(plan.candidates.some((c) => c.id === plan.currentId)).toBe(true);
    expect(plan.suggestedId).toBe(plan.currentId);
    expect(plan.candidates.find((c) => c.id === plan.currentId)!.quoteTotalInr).toBe(q.totals.total);
    expect(plan.stops.map((s) => s.id).sort()).toEqual(["paris", "rome", "zurich"]);
    for (const k of ["cheapest", "balanced", "fastest"] as const) expect(plan.best[k]).toBeTruthy();
  });

  it("is deterministic", () => {
    const a = quote(["paris", "amsterdam", "brussels"], 7);
    const b = quote(["paris", "amsterdam", "brussels"], 7);
    expect(shape(a)).toBe(shape(b));
    expect(a.totals.total).toBe(b.totals.total);
  });

  it("follows the objective: more time-conscious choices never take longer on the ground", () => {
    const minutes = (o: "cheapest" | "balanced" | "fastest") => {
      const q = quote(["paris", "amsterdam", "brussels"], 7, { transportPreference: o });
      return q.routePlan!.candidates.find((c) => c.id === q.routePlan!.currentId)!.groundMinutes;
    };
    expect(minutes("fastest")).toBeLessThanOrEqual(minutes("cheapest"));
  });

  it("leaves a hand-set order exactly as given and says so", () => {
    const q = quote(["paris", "amsterdam", "brussels"], 7, { placeOrder: ["brussels", "paris", "amsterdam"] });
    expect(q.stays.map((s) => s.placeId)).toEqual(["brussels", "paris", "amsterdam"]);
    expect(q.routePlan!.manual).toBe(true);
    expect(q.routePlan!.currentId).toBe("brussels>paris>amsterdam");
  });

  it("re-prices when the order changes, and the flight reflects the new ends", () => {
    const a = quote(["paris", "amsterdam", "brussels"], 7, { placeOrder: ["paris", "amsterdam", "brussels"] });
    const b = quote(["paris", "amsterdam", "brussels"], 7, { placeOrder: ["amsterdam", "brussels", "paris"] });
    expect(a.gateways?.arrival.iata).not.toBe(b.gateways?.arrival.iata);
    expect(a.totals.total).not.toBe(b.totals.total);
  });

  it("keeps the earlier sequencer when asked", () => {
    const q = quote(["paris", "amsterdam", "brussels"], 7, { routeMode: "classic" });
    expect(shape(q)).toBe("amsterdam:2>brussels:3>paris:2");
  });

  it("offers no plan for a single stop", () => {
    expect(quote(["paris"], 4).routePlan).toBeUndefined();
  });

  it("does not steer a land-only quote, which has no flight to save on", () => {
    const q = quote(["paris", "amsterdam", "brussels"], 7, { includeFlight: false });
    expect(shape(q)).toBe(shape(quote(["paris", "amsterdam", "brussels"], 7, { includeFlight: false, routeMode: "classic" })));
  });

  it("bills an open-jaw ticket within one country a little above the same-airport return", () => {
    const q = quote(["ha-noi", "danang", "hochiminh", "phu-quoc"], 10);
    const fare = q.lineItems.find((l) => l.component === "flight" && l.label.startsWith("Return airfare"))!;
    expect(fare.detail).toMatch(/different airports \(5% above/);
  });

  it("prices a place by its own country, whichever stop the trip starts with", () => {
    // Calibration used to take the first stop's country for every line: Oman's x2.5 landed on Dubai's hotel
    // (UAE is x0.497) whenever Muscat came first, a five-fold swing for a place the order never touched.
    const nightly = (q: ReturnType<typeof quote>, label: RegExp) =>
      q.lineItems.find((l) => l.component === "hotel" && label.test(l.label))!.unitPriceInr;
    const alone = nightly(quote(["dubai", "abu-dhabi"], 7, { routeMode: "classic" }), /Dubai/);
    for (const order of [["muscat", "dubai", "abu-dhabi"], ["dubai", "abu-dhabi", "muscat"], ["abu-dhabi", "muscat", "dubai"]]) {
      const q = quote(order, 7, { routeMode: "classic", placeOrder: order });
      expect(nightly(q, /Dubai/), order.join()).toBe(alone);
    }
  });

  it("never lets one stop change what another stop costs, in any order, across countries", () => {
    // The guard for the whole bug class: a place's own hotel and sightseeing rates are a property of the place.
    const own = (q: ReturnType<typeof quote>, placeId: string) => {
      const name = core.places.find((p) => p.id === placeId)!.name;
      const hotel = q.lineItems.find((l) => l.component === "hotel" && l.placeId === placeId)?.unitPriceInr;
      const sights = q.lineItems.filter((l) => l.component === "sightseeing" && l.placeId === placeId).map((l) => `${l.label}=${l.unitPriceInr}`).sort();
      return { name, hotel, sights };
    };
    const trips: string[][] = [["muscat", "dubai", "abu-dhabi"], ["paris", "rome", "zurich"], ["london", "paris", "amsterdam"]];
    for (const ids of trips) {
      const alone = new Map(ids.map((id) => [id, own(quote([id], 6, { routeMode: "classic" }), id)]));
      const orders = [ids, [...ids].reverse(), [ids[1], ids[2], ids[0]]];
      for (const order of orders) {
        const q = quote(order, 9, { routeMode: "classic", placeOrder: order });
        for (const id of ids) {
          const got = own(q, id);
          const want = alone.get(id)!;
          expect(got.hotel, `${got.name} hotel in ${order.join(">")}`).toBe(want.hotel);
          // Every sightseeing line in the shared trip is priced as in the single-place trip.
          for (const line of got.sights) expect(want.sights.concat(got.sights).includes(line)).toBe(true);
          const sharedPrices = new Map(want.sights.map((x) => x.split("=") as [string, string]));
          for (const line of got.sights) {
            const [label, price] = line.split("=");
            if (sharedPrices.has(label)) expect(price, `${label} in ${order.join(">")}`).toBe(sharedPrices.get(label));
          }
        }
      }
    }
  });
});
