import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type Route } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { buildRouteLookup } from "@retro/core/atlas/engine/itinerary";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const lookup = buildRouteLookup(routes, core.places, core.countries);

describe("Krabi and Koh Samui", () => {
  it("knows Koh Samui as a Thai place", () => {
    const samui = core.places.find((p) => p.id === "koh-samui");
    expect(samui).toBeDefined();
    expect(core.countries.find((c) => c.id === samui!.countryId)?.name).toBe("Thailand");
  });

  it("drives the leg: one car plus car ferry at INR 10,000 a vehicle, in both directions", () => {
    for (const [from, to] of [["krabi", "koh-samui"], ["koh-samui", "krabi"]] as const) {
      const options = lookup.options(from, to, "balanced", 2);
      expect(options).toHaveLength(1);
      const [leg] = options;
      expect(leg.mode).toBe("private_vehicle");
      expect(leg.car?.perVehicleInr).toBe(10_000);
      expect(leg.car?.totalInr).toBe(10_000 * leg.car!.vehicles);
      expect(leg.car?.className).toMatch(/car ferry/);
      expect(leg.car?.breakdown.tollsInr).toBe(3_000 * leg.car!.vehicles);
    }
  });

  it("bills the car per vehicle, so a big party needs more vehicles at the same per-vehicle figure", () => {
    const two = lookup.options("krabi", "koh-samui", "balanced", 2)[0].car!;
    const big = lookup.options("krabi", "koh-samui", "balanced", 30)[0].car!;
    expect(big.vehicles).toBeGreaterThan(two.vehicles);
    expect(big.totalInr).toBe(10_000 * big.vehicles);
  });

  it("leaves other Thai legs alone", () => {
    const best = lookup.best("bangkok", "krabi", "balanced", 2);
    expect(best?.car?.className ?? "").not.toMatch(/car ferry/);
  });

  const quoteFor = (placeIds: string[]) => {
    const req = QuoteRequest.parse({
      placeIds, nights: 7, startDate: "2026-12-05", adults: 2, childAges: [], travellerType: "couple",
      tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "CCU", hotelStar: "4 Star",
      hotelZone: "Central", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast", food: "no-preference",
      pace: "balanced", includeVisa: true, includeInsurance: true, includeFlight: true,
    });
    return generateQuotation(req, { core, routes, visaRules: [], bundles: new Map() });
  };

  it("bills the agency's INR 10,000 as is: not calibrated, and marked as a manual rate", () => {
    const q = quoteFor(["krabi", "koh-samui"]);
    const leg = q.lineItems.find((i) => i.component === "intercity-transport" && /car ferry/.test(i.detail));
    expect(leg).toBeDefined();
    expect(leg!.unitPriceInr).toBe(10_000);
    expect(leg!.source).toBe("manual");
  });

  it("flies a trip to Koh Samui alone, into USM", () => {
    const q = quoteFor(["koh-samui"]);
    expect(q.lineItems.some((i) => /car ferry/.test(i.detail))).toBe(false);
    const fare = q.lineItems.find((i) => i.component === "flight");
    expect(fare?.detail).toContain("(USM)");
  });
});

describe("Krabi and Koh Samui ordering", () => {
  it("enters at Krabi (the bigger airport) and leaves from Samui", () => {
    const req = QuoteRequest.parse({
      placeIds: ["krabi", "koh-samui"], nights: 7, startDate: "2026-12-05", adults: 2, childAges: [], travellerType: "couple",
      tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "CCU", hotelStar: "4 Star",
      hotelZone: "Central", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast", food: "no-preference",
      pace: "balanced", includeVisa: true, includeInsurance: true, includeFlight: true,
    });
    const q = generateQuotation(req, { core, routes, visaRules: [], bundles: new Map() });
    expect(q.stays[0].placeId).toBe("krabi");
    expect(q.stays[q.stays.length - 1].placeId).toBe("koh-samui");
  });
});

describe("Samui in the Thailand package", () => {
  it("is in the package, and is reached by air or car-and-ferry, never train or bus", () => {
    const pkg = core.packages.find((p) => p.name === "Thailand")!;
    expect(pkg.placeIds).toContain("koh-samui");
    for (const from of ["bangkok", "pattaya", "phuket", "krabi"]) {
      const modes = lookup.options(from, "koh-samui", "balanced", 2).map((o) => o.mode);
      expect(modes).not.toContain("train");
      expect(modes).not.toContain("bus");
    }
    const phuket = lookup.options("phuket", "koh-samui", "balanced", 2)[0];
    expect(phuket.car?.perVehicleInr).toBe(12_000);
  });
});
