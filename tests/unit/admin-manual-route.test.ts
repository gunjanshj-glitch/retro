import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";

const DIR = path.join("public", "atlas");
const read = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
const core = CoreBundle.parse(read("core.json"));
const routes = (read("routes.json") as { routes: Route[] }).routes;
const visaRules = (read("visa.json") as { rules: VisaRule[] }).rules;

function quote(pkgName: string, extra: Partial<QuoteRequest> = {}) {
  const pkg = core.packages.find((p) => p.name === pkgName)!;
  const request = QuoteRequest.parse({
    placeIds: pkg.placeIds, nights: pkg.nights, startDate: "2026-11-05", adults: 2, childAges: [],
    travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "DEL",
    hotelStar: "3 Star", hotelZone: "Outskirts", carrier: "LCC", cabin: "Economy", mealPlan: "breakfast",
    food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: false, includeFlight: pkg.priceIncludesFlight,
    ...extra,
  });
  return { pkg, request, q: generateQuotation(request, { core, routes, visaRules, bundles: new Map(), ignorePackageFloor: true }) };
}

describe("an admin-set route order (placeOrder)", () => {
  it("is followed literally, for every permutation of a three-stop trip", () => {
    const base = quote("Kerala");
    const ids = base.pkg.placeIds.slice(0, 3);
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.map((i) => ids[i]));
    for (const order of perms) {
      const { q } = quote("Kerala", { placeIds: ids, nights: 6, nightOverrides: { [ids[0]]: 2, [ids[1]]: 2, [ids[2]]: 2 }, placeOrder: order });
      const got = q.stays.map((s) => s.placeId).filter((id, i, a) => a.indexOf(id) === i);
      // The engine may add one airport-city night; every chosen stop must still appear in the chosen order.
      expect(got.filter((id) => ids.includes(id)), order.join(">")).toEqual(order);
    }
  });

  it("changes nothing when empty", () => {
    const a = quote("Kerala").q.stays.map((s) => s.placeId);
    const b = quote("Kerala", { placeOrder: [] }).q.stays.map((s) => s.placeId);
    expect(b).toEqual(a);
  });

  it("ignores places that are no longer in the trip and does not lose ones the order forgot", () => {
    const ids = quote("Kerala").pkg.placeIds.slice(0, 3);
    const { q } = quote("Kerala", { placeIds: ids, nights: 6, nightOverrides: { [ids[0]]: 2, [ids[1]]: 2, [ids[2]]: 2 }, placeOrder: ["not-a-place", ids[2]] });
    const got = q.stays.map((s) => s.placeId);
    expect(got[0]).toBe(ids[2]);
    for (const id of ids) expect(got).toContain(id);
  });
});
