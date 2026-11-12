import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { buildRouteLookup, sequencePlaces } from "@retro/core/atlas/engine/itinerary";

const DIR = path.join("public", "atlas");
const read = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
const core = CoreBundle.parse(read("core.json"));
const routes = (read("routes.json") as { routes: Route[] }).routes;
const visaRules = (read("visa.json") as { rules: VisaRule[] }).rules;
const lookup = buildRouteLookup(routes, core.places, core.countries);

function stays(packageName: string): string[] {
  const pkg = core.packages.find((p) => p.name === packageName)!;
  const request = QuoteRequest.parse({
    placeIds: pkg.placeIds, nights: pkg.nights, startDate: "2026-11-05", adults: 2, childAges: [],
    travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "DEL",
    hotelStar: "3 Star", hotelZone: "Outskirts", carrier: "LCC", cabin: "Economy", mealPlan: "breakfast",
    food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: false, includeFlight: pkg.priceIncludesFlight,
  });
  return generateQuotation(request, { core, routes, visaRules, bundles: new Map(), ignorePackageFloor: true }).stays.map((s) => s.placeId);
}

describe("India routes follow the published-itinerary pattern", () => {
  it("never re-enters the airport city for a stay within a normal first-day drive", () => {
    // Kerala used to read Cochin > Alleppey > Cochin, Punjab Chandigarh > Patiala > Chandigarh.
    for (const name of ["Kerala", "Punjab", "Tamil Nadu", "Madhya Pradesh"]) {
      const ids = stays(name);
      expect(new Set(ids).size, `${name}: ${ids.join(" > ")}`).toBe(ids.length);
    }
  });

  it("starts Kerala and Punjab at the gateway city", () => {
    expect(stays("Kerala")[0]).toBe("cochin");
    expect(stays("Punjab")[0]).toBe("chandigarh");
  });

  it("puts the port city at the stated end even when the middle is cheaper", () => {
    // A line a - b - c - d: the cheapest open path is a..d, but with b anchored it must start or end at b.
    const ids = ["a", "b", "c", "d"];
    const km: Record<string, number> = { "a|b": 100, "b|c": 100, "c|d": 100 };
    const fake = {
      best: () => ({ priceInr: 0, minutes: 0 }),
      distanceKm: (x: string, y: string) => km[`${x}|${y}`] ?? km[`${y}|${x}`] ?? 300,
    } as unknown as Parameters<typeof sequencePlaces>[1];
    const free = sequencePlaces(ids, fake);
    expect(["a", "d"]).toContain(free[0]);
    // Added for a long road home: not negotiable, so b must take the stated end.
    const atEnd = sequencePlaces(ids, fake, null, new Map(), true, undefined, "b", "end");
    expect(atEnd[atEnd.length - 1]).toBe("b");
    const atStart = sequencePlaces(ids, fake, null, new Map(), true, undefined, "b", "start");
    expect(atStart[0]).toBe("b");
  });

  it("still returns through the port when a stay is too far to drive to on the last morning", () => {
    const ids = stays("Arunachal Pradesh");
    expect(ids[ids.length - 1]).toBe("guwahati");
  });

  it("runs Kerala the way the published circuits do: hills, then Alleppey, then the south coast", () => {
    expect(stays("Kerala")).toEqual(["cochin", "munnar", "thekkady", "alleppey", "trivandrum", "kanyakumari"]);
  });

  it("keeps the Chhattisgarh package inside Chhattisgarh", () => {
    const pkg = core.packages.find((p) => p.name === "Chhattisgarh")!;
    for (const id of ["patiala", "chandigarh", "anandpur-sahib"]) expect(pkg.placeIds).not.toContain(id);
    const ids = stays("Chhattisgarh");
    expect(ids).toHaveLength(7);
    expect(ids).toContain("raipur");
  });

  it("puts the airport night after a long drive back at the end, not the start", () => {
    const ids = stays("Uttarakhand Pilgrimage");
    expect(ids[ids.length - 1]).toBe("nainital");
    expect(ids[0]).not.toBe("nainital");
  });
});

describe("the port city is a soft start, not a rule", () => {
  it("does not make Uttar Pradesh jump back 500 km because Lucknow, its port, sits mid-line", () => {
    const ids = stays("Uttar Pradesh");
    // Varanasi - Ayodhya - Lucknow - Kanpur - Agra is one line; Lucknow must stay in the middle of it.
    expect(ids).toEqual(["varanasi", "ayodhya", "lucknow", "kanpur", "agra"]);
  });

  it("does not end a hill trip on a stop more than six hours from the airport when the port city is on the trip", () => {
    const ids = stays("Ladakh");
    expect(ids[ids.length - 1]).not.toBe("hanle");
    expect(ids[ids.length - 1]).not.toBe("tso-moriri");
  });
});
