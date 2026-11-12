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

  it("runs Ladakh the way published circuits do: Leh, Nubra, Pangong, Hanle, Tso Moriri, back to Leh", () => {
    const ids = stays("Ladakh");
    const at = (id: string) => ids.indexOf(id);
    expect(ids[0]).toBe("leh");
    expect(ids[ids.length - 1]).toBe("leh");
    expect(at("pangong-lake")).toBeLessThan(at("hanle"));
    expect(at("hanle")).toBeLessThan(at("tso-moriri"));
  });
});

describe("orders taken from published circuits", () => {
  const before = (ids: string[], a: string, b: string) => expect(ids.indexOf(a), `${a} before ${b}: ${ids.join(" > ")}`).toBeLessThan(ids.indexOf(b));

  it("Andaman: Ross Island, then Havelock, then Neil, with Baratang last", () => {
    const ids = stays("Andaman Island");
    expect(ids[0]).toBe("port-blair");
    before(ids, "ross-island", "havelock-island");
    before(ids, "havelock-island", "neil-island");
    before(ids, "neil-island", "baratang-island");
  });

  it("Kashmir Delights: Katra, then Pahalgam, Panjtarni and Amarnath, then Srinagar and Gulmarg", () => {
    const ids = stays("Kashmir Delights");
    expect(ids[0]).toBe("katra-vaishno-devi");
    before(ids, "pahalgam", "panjtarni");
    before(ids, "panjtarni", "amarnath");
    before(ids, "amarnath", "srinagar");
    before(ids, "srinagar", "gulmarg");
  });

  it("Madhya Pradesh: Bhopal, Sanchi, Pachmarhi, then Jabalpur and Kanha; Indore, Ujjain, Omkareshwar, Mandu", () => {
    const ids = stays("Madhya Pradesh");
    before(ids, "bhopal", "sanchi");
    before(ids, "sanchi", "pachmarhi");
    before(ids, "pachmarhi", "jabalpur");
    before(ids, "jabalpur", "bandhavgarh-and-kanha");
    before(ids, "indore", "ujjain");
    before(ids, "ujjain", "omkareshwar");
    before(ids, "omkareshwar", "mandu");
  });

  it("Himachal Delights runs Shimla side, Kinnaur, Spiti, then out through Manali", () => {
    const ids = stays("Himachal Delights");
    before(ids, "narkanda", "sangla");
    before(ids, "sangla", "kinnaur-and-kalpa");
    before(ids, "kinnaur-and-kalpa", "tabo");
    before(ids, "tabo", "kaza");
    before(ids, "kaza", "losar");
    before(ids, "losar", "manali");
  });

  it("Gujarat and Odisha follow their circuits", () => {
    const g = stays("Gujarat");
    before(g, "vadodara", "rajkot");
    before(g, "rajkot", "bhuj");
    before(g, "bhuj", "dhordo");
    const o = stays("Odisha");
    before(o, "bhubaneswar", "puri");
    before(o, "puri", "bhitarkanika");
    before(o, "bhitarkanika", "similipal");
    before(o, "similipal", "daringbadi");
  });
});
