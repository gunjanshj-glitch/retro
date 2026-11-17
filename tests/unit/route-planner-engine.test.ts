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

  it("finds a real saving by flying home from the airport it landed at", () => {
    const ids = ["paris", "amsterdam", "brussels"];
    const auto = quote(ids, 7);
    const classic = quote(ids, 7, { routeMode: "classic" });
    expect(auto.totals.total).toBeLessThan(classic.totals.total * 0.95);
    // The trip ends where it began: one return ticket, no open jaw.
    expect(auto.stays[0].placeId).toBe(auto.stays[auto.stays.length - 1].placeId);
    expect(auto.gateways?.arrival.iata).toBe(auto.gateways?.departure.iata);
    expect(auto.lineItems.filter((l) => l.component === "flight").map((l) => l.label)).toEqual([expect.stringMatching(/^Return airfare/)]);
    // The return is a real extra hop and night, not hidden.
    expect(auto.stays.reduce((a, s) => a + s.nights, 0)).toBe(7);
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
});
