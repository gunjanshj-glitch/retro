import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@/lib/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@/lib/atlas/engine";
import { evaluatePlaceSelectability } from "@/lib/atlas/engine/bounds";

const ATLAS = path.join("public", "atlas");
const read = (p: string) => JSON.parse(readFileSync(path.join(ATLAS, p), "utf8"));
const core = CoreBundle.parse(read("core.json"));
const routes: Route[] = read("routes.json").routes;
const visaRules: VisaRule[] = read("visa.json").rules;

const cities: { name: string; country: string }[] = readdirSync(path.join("content", "europe-cities"))
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => JSON.parse(readFileSync(path.join("content", "europe-cities", f), "utf8")).cities);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "");
const ALIAS: Record<string, string> = { edinburgh: "edinburg", crete: "creteheraklion" };
const placeFor = (name: string) =>
  core.places.find((p) => norm(p.name) === (ALIAS[norm(name)] ?? norm(name)));

function quote(ids: string[], nights: number) {
  const bundles = new Map<string, DestinationBundle>();
  for (const id of ids) {
    const place = core.places.find((p) => p.id === id)!;
    bundles.set(id, JSON.parse(readFileSync(path.join(ATLAS, "destinations", `${place.slug}.json`), "utf8")));
  }
  return generateQuotation(
    {
      placeIds: ids, nights, startDate: "2026-06-10", adults: 2, childAges: [],
      travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple, nationality: "IND", departureCity: "DEL",
      hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy", mealPlan: "breakfast",
      food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: false, includeFlight: true,
      interests: [], firstTimeVisitor: true, transportPreference: "balanced", legModes: {},
      excludedActivityCodes: [], excludedClusterIds: [], addedActivityCodes: [], pinnedClusterIds: [], nightOverrides: {},
    },
    { core, routes, visaRules, bundles },
  );
}

describe("Europe city supplement", () => {
  it("makes every listed city a located, quotable place with content", () => {
    const missing = cities.filter((c) => !placeFor(c.name)).map((c) => c.name);
    expect(missing).toEqual([]);
    for (const c of cities) {
      const p = placeFor(c.name)!;
      expect(p.lat, c.name).not.toBeNull();
      expect(p.hasRates, c.name).toBe(true);
      expect(p.hasContent, c.name).toBe(true);
    }
  });

  it("gives no two places the same coordinate", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const p of core.places) {
      if (p.lat == null || p.lon == null) continue;
      const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      if (seen.has(key)) clashes.push(`${seen.get(key)} / ${p.name}`);
      else seen.set(key, p.name);
    }
    expect(clashes).toEqual([]);
  });

  it("prices a multi-city trip with sightseeing and real intercity fares", () => {
    const q = quote(["paris", "lyon", "nice"], 8);
    expect(q.totals.total).toBeGreaterThan(0);
    expect(q.stays).toHaveLength(3);
    const legs = q.days.filter((d) => d.isTransferDay && d.transfer);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    // Roughly 450 km by train in Europe costs thousands of rupees, not hundreds.
    expect(legs.every((d) => d.transfer!.priceInr > 1500)).toBe(true);
    expect(q.lineItems.some((l) => l.component === "sightseeing" && l.totalInr > 0)).toBe(true);
  });

  it("reaches an island by air or sea, never by road or rail", () => {
    const q = quote(["barcelona", "mallorca"], 6);
    const leg = q.days.find((d) => d.transfer && /mallorca/i.test(d.transfer.to + d.transfer.from));
    expect(leg?.transfer?.mode).toMatch(/flight|ferry/);
  });

  it("keeps a town on the same island connected by road", () => {
    const q = quote(["reykjavik", "vik"], 5);
    const leg = q.days.find((d) => d.transfer && d.transfer.mode !== "transfer" && /vik|reykjavik/i.test(d.transfer.to));
    expect(leg?.transfer?.mode).not.toMatch(/ferry|flight/);
  });
});

describe("whole-country places and their cities", () => {
  it("lets a trip hold France or Paris, never both", () => {
    const france = core.places.find((p) => p.id === "france")!;
    const paris = core.places.find((p) => p.id === "paris")!;
    expect(paris.parentPlaceId).toBe(france.id);

    const withFrance = evaluatePlaceSelectability(core, [france.id]);
    expect(withFrance.get(paris.id)?.allowed).toBe(false);
    expect(withFrance.get(paris.id)?.reason).toMatch(/France/);

    const withParis = evaluatePlaceSelectability(core, [paris.id]);
    expect(withParis.get(france.id)?.allowed).toBe(false);
    // Another French city is fine.
    expect(withParis.get("lyon")?.allowed).toBe(true);
  });
});
