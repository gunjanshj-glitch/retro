import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { allocateNights } from "@retro/core/atlas/engine/itinerary";
import type { LiveRate } from "@retro/core/atlas/engine/pricing";
import {
  airportAlternatives,
  airportDistanceKm,
  bookendGateways,
  chooseAirport,
  isSatellite,
} from "@retro/core/atlas/engine/gateway";
import { loadFlightLiveRates } from "@/lib/atlas/client";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function bundlesFor(ids: string[]): Map<string, DestinationBundle> {
  const map = new Map<string, DestinationBundle>();
  for (const id of ids) {
    const place = core.places.find((p) => p.id === id);
    try {
      map.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place!.slug}.json`), "utf8")));
    } catch {
      /* no bundle for this place */
    }
  }
  return map;
}

function quote(
  placeIds: string[],
  nights: number,
  extra: Partial<QuoteRequest> = {},
  liveRates?: Map<string, LiveRate>,
) {
  const request = QuoteRequest.parse({
    startDate: "2026-12-21", adults: 2, childAges: [], travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple,
    nationality: "IND", departureCity: "CCU", hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy",
    mealPlan: "breakfast", food: "no-preference", pace: "balanced", includeVisa: true, includeInsurance: true, includeFlight: true,
    placeIds, nights, ...extra,
  });
  return generateQuotation(request, { core, routes, visaRules, bundles: bundlesFor(placeIds), liveRates });
}

const summary = (q: ReturnType<typeof quote>) => q.stays.map((s) => `${s.placeId}:${s.nights}`).join(" > ");
const nightsTotal = (q: ReturnType<typeof quote>) => q.stays.reduce((a, s) => a + s.nights, 0);

describe("which places are satellites of an airport", () => {
  it("knows Pattaya is served from Bangkok's airport, and Bangkok is not a satellite", () => {
    expect(core.placeAirports["pattaya"].iata).toBe("BKK");
    expect(isSatellite(core, "pattaya")).toBe(true);
    expect(isSatellite(core, "bangkok")).toBe(false);
    expect(airportDistanceKm(core, "bangkok")!).toBeLessThan(40);
    expect(airportDistanceKm(core, "pattaya")!).toBeGreaterThan(75);
  });

  it("is general: Kyoto, Kandy, Interlaken and Alexandria are satellites of Osaka, Colombo, Zurich and Cairo", () => {
    for (const [satellite, city] of [["kyoto", "osaka"], ["kandy", "colombo"], ["interlaken", "zurich"], ["alexandria", "cairo"]]) {
      expect(isSatellite(core, satellite), satellite).toBe(true);
      expect(isSatellite(core, city), city).toBe(false);
      expect(core.placeAirports[satellite].iata, satellite).toBe(core.placeAirports[city].iata);
    }
  });

  it("never treats a country-level pseudo-place as far from its hub", () => {
    for (const id of ["france", "germany", "spain", "poland", "norway", "sweden"]) {
      if (core.places.some((p) => p.id === id)) expect(isSatellite(core, id), id).toBe(false);
    }
  });

  it("lists both Bangkok airports, the popular one first, but only the listed one for a satellite", () => {
    expect(airportAlternatives(core, "bangkok").map((a) => a.iata)).toEqual(["BKK", "DMK"]);
    expect(airportAlternatives(core, "pattaya").map((a) => a.iata)).toEqual(["BKK"]);
    expect(airportAlternatives(core, "paris").map((a) => a.iata)).toEqual(["CDG"]);
  });

  it("takes the live fare's airport only when it is one that serves the place", () => {
    expect(chooseAirport(core, "bangkok", "DMK")).toMatchObject({ airport: { iata: "DMK" }, basis: "cheapest-fare" });
    expect(chooseAirport(core, "bangkok", undefined)).toMatchObject({ airport: { iata: "BKK" }, basis: "listed" });
    expect(chooseAirport(core, "bangkok", "UTP")).toMatchObject({ airport: { iata: "BKK" }, basis: "listed" });
    expect(chooseAirport(core, "pattaya", "DMK")).toMatchObject({ airport: { iata: "BKK" }, basis: "listed" });
  });
});

describe("bookending the route at the airport city", () => {
  const route = (...v: [string, number][]) => v.map(([placeId, nights]) => ({ placeId, nights }));
  const show = (r: { placeId: string; nights: number }[]) => r.map((v) => `${v.placeId}:${v.nights}`).join(" > ");

  it("sends the couple back to Bangkok: Bangkok, Pattaya, Bangkok", () => {
    expect(show(bookendGateways(core, route(["bangkok", 4], ["pattaya", 3])))).toBe("bangkok:2 > pattaya:3 > bangkok:2");
  });

  it("gives the larger half to the end of the trip when the nights are odd", () => {
    expect(show(bookendGateways(core, route(["bangkok", 3], ["pattaya", 4])))).toBe("bangkok:1 > pattaya:4 > bangkok:2");
  });

  it("fixes a route that starts at the satellite too", () => {
    expect(show(bookendGateways(core, route(["pattaya", 3], ["bangkok", 4])))).toBe("bangkok:2 > pattaya:3 > bangkok:2");
  });

  it("moves a single airport-city night to the end rather than splitting it", () => {
    expect(show(bookendGateways(core, route(["bangkok", 1], ["pattaya", 4])))).toBe("pattaya:4 > bangkok:1");
  });

  it("leaves a trip alone when the airport city is not in it", () => {
    expect(show(bookendGateways(core, route(["pattaya", 4])))).toBe("pattaya:4");
    expect(show(bookendGateways(core, route(["pattaya", 3], ["kanchanaburi", 2])))).toBe("pattaya:3 > kanchanaburi:2");
  });

  it("leaves a trip alone when it already starts and ends at airport cities", () => {
    expect(show(bookendGateways(core, route(["bangkok", 3], ["phuket", 3])))).toBe("bangkok:3 > phuket:3");
  });

  it("brings the airport city back at both ends of a longer circuit", () => {
    const r = bookendGateways(core, route(["colombo", 2], ["kandy", 3], ["nuwaraeliya", 2]));
    expect(r[0].placeId).toBe("colombo");
    expect(r[r.length - 1].placeId).toBe("colombo");
    expect(r.reduce((a, v) => a + v.nights, 0)).toBe(7);
  });

  it("never changes the nights, and never leaves a zero-night stop", () => {
    for (const nights of [1, 2, 3, 4, 5, 8]) {
      const r = bookendGateways(core, route(["bangkok", nights], ["pattaya", 3]));
      expect(r.reduce((a, v) => a + v.nights, 0), `bangkok ${nights}`).toBe(nights + 3);
      expect(r.every((v) => v.nights > 0), `bangkok ${nights}`).toBe(true);
    }
  });
});

describe("the Kolkata, Bangkok and Pattaya quote", () => {
  const q = quote(["bangkok", "pattaya"], 7);

  it("lands in Bangkok, tours Pattaya and returns to Bangkok before the flight", () => {
    expect(summary(q)).toBe("bangkok:2 > pattaya:3 > bangkok:2");
    expect(nightsTotal(q)).toBe(7);
    expect(q.days).toHaveLength(8);
    expect(q.days[0].placeId).toBe("bangkok");
    expect(q.days[q.days.length - 1].placeId).toBe("bangkok");
    expect(q.days.map((d) => d.placeId)).toEqual([
      "bangkok", "bangkok", "pattaya", "pattaya", "pattaya", "bangkok", "bangkok", "bangkok",
    ]);
  });

  it("names the airport on the way in and the way out", () => {
    expect(q.days[0].airport).toEqual({ kind: "arrival", iata: "BKK", name: "Suvarnabhumi Airport" });
    expect(q.days[0].notes.join(" ")).toMatch(/Land at Suvarnabhumi Airport \(BKK\)/);
    expect(q.days[0].transfer?.from).toBe("Suvarnabhumi Airport (BKK)");
    const last = q.days[q.days.length - 1];
    expect(last.airport).toEqual({ kind: "departure", iata: "BKK", name: "Suvarnabhumi Airport" });
    expect(last.notes.join(" ")).toMatch(/transfer to Suvarnabhumi Airport \(BKK\) for the flight home/);
    // Only the first and last days are flight days.
    expect(q.days.filter((d) => d.airport)).toHaveLength(2);
  });

  it("shows where the flight goes from and to", () => {
    expect(q.gateways).toMatchObject({
      home: { code: "CCU", label: "Kolkata" },
      arrival: { iata: "BKK", placeId: "bangkok", placeName: "Bangkok" },
      departure: { iata: "BKK", placeId: "bangkok" },
    });
    const flight = q.lineItems.find((i) => i.component === "flight" && i.totalInr > 0)!;
    expect(flight.detail).toMatch(/Kolkata \(CCU\) to Suvarnabhumi Airport \(BKK\) and back from the same airport/);
    const arrive = q.lineItems.find((i) => i.label.startsWith("Airport to hotel"))!;
    const depart = q.lineItems.find((i) => i.label.startsWith("Hotel to airport"))!;
    expect(arrive.label).toBe("Airport to hotel — Bangkok");
    expect(arrive.detail).toMatch(/From Suvarnabhumi Airport \(BKK\)/);
    expect(depart.label).toBe("Hotel to airport — Bangkok");
    expect(depart.detail).toMatch(/To Suvarnabhumi Airport \(BKK\)/);
  });

  it("books Bangkok as one hotel line for all four nights, and Pattaya for three", () => {
    const hotels = q.lineItems.filter((i) => i.component === "hotel" && !/extra bed/.test(i.label));
    expect(hotels.map((h) => `${h.label}|${h.quantity}`)).toEqual(["Bangkok — 4 Star|4", "Pattaya — 4 Star|3"]);
    expect(hotels[0].detail).toMatch(/2 \+ 2/);
  });

  it("charges the airport transfer once at each end, and the way back from Pattaya as an intercity leg", () => {
    expect(q.lineItems.filter((i) => i.component === "airport-transfer")).toHaveLength(2);
    const legs = q.days.filter((d) => d.isTransferDay).map((d) => `${d.transfer!.from}>${d.transfer!.to}`);
    expect(legs).toEqual(["Bangkok>Pattaya", "Pattaya>Bangkok"]);
    expect(q.lineItems.filter((i) => i.component === "intercity-transport")).toHaveLength(2);
  });

  it("does not plan an outing twice when the trip visits Bangkok twice", () => {
    const ids = q.days.flatMap((d) => d.activities.map((a) => a.clusterId)).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    const options = (q.sightseeingOptions ?? []).map((o) => o.clusterId);
    expect(new Set(options).size).toBe(options.length);
  });

  it("explains the plan to the traveller once", () => {
    const told = q.warnings.filter((w) => w.audience === "traveller" && /lands and departs from Bangkok/.test(w.message));
    expect(told).toHaveLength(1);
  });

  it("starts the first night's breakfast on day two and has no hotel on the last day", () => {
    expect(q.days[0].hotelPlaceId).toBe("bangkok");
    expect(q.days[q.days.length - 1].hotelPlaceId).toBeNull();
    expect(q.days.filter((d) => d.hotelPlaceId).length).toBe(7);
  });
});

describe("the traveller's own adjustments still work around a repeated stop", () => {
  it("one night slider per place moves all of that place's nights", () => {
    const q = quote(["bangkok", "pattaya"], 9, { nightOverrides: { bangkok: 6, pattaya: 3 } });
    const byPlace = new Map<string, number>();
    for (const s of q.stays) byPlace.set(s.placeId, (byPlace.get(s.placeId) ?? 0) + s.nights);
    expect(byPlace.get("bangkok")).toBe(6);
    expect(byPlace.get("pattaya")).toBe(3);
    expect(summary(q)).toBe("bangkok:3 > pattaya:3 > bangkok:3");
  });

  it("a destination slid to 0 nights leaves a plain one-place trip", () => {
    const q = quote(["bangkok", "pattaya"], 5, { nightOverrides: { pattaya: 0, bangkok: 5 } });
    expect(summary(q)).toBe("bangkok:5");
  });

  it("pins the way back separately from the way out", () => {
    const q = quote(["bangkok", "pattaya"], 7, { legModes: { "pattaya": "private_vehicle", "bangkok#1": "train" } });
    const legs = q.days.filter((d) => d.isTransferDay).map((d) => d.transfer!);
    expect(legs.map((l) => l.legKey)).toEqual(["pattaya", "bangkok#1"]);
    expect(legs[0].mode).toBe("private_vehicle");
    // The way back is only pinned when that mode exists on the route, and never changes the way out.
    expect(legs[0].userChosen).toBe(true);
  });

  it("a switched-off outing in Bangkok stays on its day on either visit", () => {
    const base = quote(["bangkok", "pattaya"], 7);
    const second = base.days.find((d) => d.dayNumber === 7)!;
    const pick = second.activities[0];
    expect(pick?.clusterId).toBeTruthy();
    const off = quote(["bangkok", "pattaya"], 7, { excludedClusterIds: [pick.clusterId!] });
    const same = off.days.find((d) => d.dayNumber === 7)!;
    expect(same.excludedActivities.map((a) => a.clusterId)).toContain(pick.clusterId);
  });
});

describe("a satellite on its own, or a trip with no airport city", () => {
  it("drives Pattaya from the airport and back, and says how long it takes", () => {
    const q = quote(["pattaya"], 4);
    expect(summary(q)).toBe("pattaya:4");
    expect(q.days[0].transfer?.from).toBe("Suvarnabhumi Airport (BKK)");
    expect(q.days[0].transfer?.durationMinutes).toBeGreaterThan(90);
    expect(q.days[0].notes.join(" ")).toMatch(/about 2h/);
    expect(q.gateways?.arrival.distanceKm).toBeGreaterThan(75);
  });

  it("does not add a stop for a trip that already ends at an airport city", () => {
    const q = quote(["bangkok", "phuket"], 6);
    expect(q.stays).toHaveLength(2);
    expect(q.gateways).toMatchObject({ arrival: { iata: "BKK" }, departure: { iata: "HKT" } });
    const flight = q.lineItems.find((i) => i.component === "flight" && i.totalInr > 0)!;
    expect(flight.detail).toMatch(/to Suvarnabhumi Airport \(BKK\), back from Phuket International Airport \(HKT\)/);
  });

  it("leaves a trip inside India alone, with no airport and no flight in", () => {
    const q = quote(["agra", "jaipur"], 4, { departureCity: "DEL", includeFlight: false });
    expect(q.stays.every((s) => !s.visit)).toBe(true);
    expect(q.gateways).toBeUndefined();
    expect(q.days.every((d) => !d.airport)).toBe(true);
  });
});

describe("the airport comes from the cheapest live fare", () => {
  const live = (airportIata: string, inr = 26650): Map<string, LiveRate> =>
    new Map([
      [
        "flight:CCU:south-east-asia-thailand:FSC",
        { component: "flight", key: "CCU:south-east-asia-thailand:FSC", inr, fetchedAt: new Date().toISOString(), provider: "google-flights", lowCost: true, airportIata },
      ],
    ]);

  it("lands at Don Mueang, and flies home from it, when that is where the cheapest fare lands", () => {
    const q = quote(["bangkok", "pattaya"], 7, {}, live("DMK", 18000));
    expect(q.gateways).toMatchObject({
      arrival: { iata: "DMK", basis: "cheapest-fare" },
      departure: { iata: "DMK", basis: "cheapest-fare" },
    });
    expect(q.days[0].airport).toMatchObject({ iata: "DMK", name: "Don Mueang International Airport" });
    expect(q.days[q.days.length - 1].airport).toMatchObject({ iata: "DMK" });
    expect(q.lineItems.find((i) => i.label.startsWith("Airport to hotel"))!.detail).toMatch(/Don Mueang/);
    const fare = q.lineItems.find((i) => i.component === "flight" && i.totalInr > 0)!;
    expect(fare.unitPriceInr).toBe(18000);
  });

  it("keeps the popular airport when the fare lands there", () => {
    const q = quote(["bangkok", "pattaya"], 7, {}, live("BKK"));
    expect(q.gateways?.arrival).toMatchObject({ iata: "BKK", basis: "cheapest-fare" });
  });

  it("flies a Pattaya-only trip into Bangkok's main airport even if Don Mueang is cheaper", () => {
    const q = quote(["pattaya"], 4, {}, live("DMK"));
    expect(q.gateways?.arrival.iata).toBe("BKK");
  });

  it("does not move the price: the airport is a label, the fare is the fare", () => {
    const a = quote(["bangkok", "pattaya"], 7, {}, live("BKK"));
    const b = quote(["bangkok", "pattaya"], 7, {}, live("DMK"));
    expect(b.totals.total).toBe(a.totals.total);
  });
});

describe("the live-fare search covers every airport of the metro", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for BKK and DMK together when the trip lands in Bangkok", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ rates: [] }));
    }));
    const q = quote(["bangkok", "pattaya"], 7);
    await loadFlightLiveRates(core, q);
    expect(urls).toHaveLength(1);
    const p = new URL(urls[0], "https://x").searchParams;
    expect(p.get("destinationIata")).toBe("BKK,DMK");
    expect(p.get("fareKey")).toBe("south-east-asia-thailand");
  });

  it("asks for one airport only when the trip lands at a satellite on its own", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ rates: [] }));
    }));
    await loadFlightLiveRates(core, quote(["pattaya"], 4));
    expect(new URL(urls[0], "https://x").searchParams.get("destinationIata")).toBe("BKK");
  });
});

describe("every airport in the catalogue that has both an airport city and a satellite", () => {
  // Group the places by serving airport, then pair each airport city with a satellite.
  const iso3 = new Map(core.countries.map((c) => [c.id, c.iso3]));
  const byAirport = new Map<string, string[]>();
  for (const p of core.places) {
    // A trip inside the traveller's own country is not an international arrival.
    if (iso3.get(p.countryId) === "IND") continue;
    const iata = core.placeAirports[p.id]?.iata;
    if (iata) byAirport.set(iata, [...(byAirport.get(iata) ?? []), p.id]);
  }
  // "Switzerland" or "Iceland" as a place is a whole country at a centroid; the selection filter
  // already drops it next to a real town, which is not what is under test here.
  const countryName = new Map(core.countries.map((c) => [c.id, c.name.trim().toLowerCase()]));
  const wholeCountry = (id: string) => {
    const p = core.places.find((x) => x.id === id)!;
    return countryName.get(p.countryId) === p.name.trim().toLowerCase() || /^(france|germany|spain|poland|norway|sweden|denmark|finland|iceland)$/.test(id);
  };
  const pairs: [string, string, string][] = [];
  for (const [iata, ids] of byAirport) {
    const city = ids.find((id) => !isSatellite(core, id) && !wholeCountry(id));
    // A place and the region that contains it are the same trip, which the selection filter already merges.
    const nested = (a: string, b: string) =>
      core.places.find((p) => p.id === a)?.parentPlaceId === b || core.places.find((p) => p.id === b)?.parentPlaceId === a;
    const satellite = ids.find(
      (id) =>
        isSatellite(core, id) && !wholeCountry(id) && !nested(id, city!) &&
        core.places.find((p) => p.id === id)!.countryId === core.places.find((p) => p.id === city)?.countryId,
    );
    if (city && satellite) pairs.push([iata, city, satellite]);
  }

  it("finds a meaningful number of them", () => {
    expect(pairs.length).toBeGreaterThan(30);
  });

  it("plans each so the trip starts and ends at the airport city, with every night kept", () => {
    const failures: string[] = [];
    for (const [iata, city, satellite] of pairs) {
      for (const nights of [4, 7]) {
        let q;
        try {
          q = quote([satellite, city], nights, { departureCity: "DEL" });
        } catch (error) {
          failures.push(`${iata} ${city}+${satellite} ${nights}n threw ${(error as Error).message}`);
          continue;
        }
        const first = q.stays[0];
        const last = q.stays[q.stays.length - 1];
        const cityNights = q.stays.filter((s) => s.placeId === city).reduce((a, s) => a + s.nights, 0);
        // With a single airport-city night it moves to the end only.
        const startsAtCity = first.placeId === city;
        const endsAtCity = last.placeId === city;
        if (!endsAtCity) failures.push(`${iata} ${city}+${satellite} ${nights}n does not end at ${city}: ${summary(q)}`);
        if (cityNights >= 2 && !startsAtCity) failures.push(`${iata} ${city}+${satellite} ${nights}n does not start at ${city}: ${summary(q)}`);
        if (nightsTotal(q) !== nights) failures.push(`${iata} ${nights}n quote has ${nightsTotal(q)} nights: ${summary(q)}`);
        if (q.stays.some((s, i) => i > 0 && s.placeId === q.stays[i - 1].placeId)) failures.push(`${iata} repeats a stop back to back: ${summary(q)}`);
        if (q.stays.some((s) => s.nights <= 0)) failures.push(`${iata} has a zero-night stop: ${summary(q)}`);
        if (!q.days[0].airport || !q.days[q.days.length - 1].airport) failures.push(`${iata} first or last day is missing its airport`);
        const ids = q.days.flatMap((d) => d.activities.map((a) => a.clusterId)).filter(Boolean);
        if (new Set(ids).size !== ids.length) failures.push(`${iata} plans an outing twice`);
        if (q.lineItems.filter((i) => i.component === "airport-transfer").length > 2) failures.push(`${iata} bills more than two airport transfers`);
        const flightDetail = q.lineItems.find((i) => i.component === "flight" && i.totalInr > 0)?.detail ?? "";
        if (!flightDetail.includes(`(${core.placeAirports[city].iata})`)) failures.push(`${iata} flight line does not name ${core.placeAirports[city].iata}: ${flightDetail}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

describe("any combination of foreign places keeps the airport city at both ends of the route", () => {
  const iso3 = new Map(core.countries.map((c) => [c.id, c.iso3]));
  const countryName = new Map(core.countries.map((c) => [c.id, c.name.trim().toLowerCase()]));
  const placeOf = (id: string) => core.places.find((p) => p.id === id)!;
  const wholeCountry = (id: string) =>
    countryName.get(placeOf(id).countryId) === placeOf(id).name.trim().toLowerCase() ||
    /^(france|germany|spain|poland|norway|sweden|denmark|finland|iceland)$/.test(id);
  const nested = (a: string, b: string) => placeOf(a).parentPlaceId === b || placeOf(b).parentPlaceId === a;

  // Places that have an airport, are abroad, and are real towns rather than whole countries.
  const pool = core.places.filter(
    (p) => iso3.get(p.countryId) !== "IND" && core.placeAirports[p.id] && !wholeCountry(p.id),
  );
  const compatible = (ids: string[]) =>
    ids.every((a, i) => ids.every((b, j) => i === j || (placeOf(a).countryId === placeOf(b).countryId && !nested(a, b))));

  // Mulberry32: a fixed seed, so a failure is reproducible.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function check(ids: string[], nights: number, label: string): string[] {
    const out: string[] = [];
    let q;
    try {
      q = quote(ids, nights, { departureCity: "DEL" });
    } catch (error) {
      return [`${label} threw ${(error as Error).message}`];
    }
    if (q.stays.length === 0) return out; // the request itself was refused, which is not under test
    const tag = `${label} ${nights}n [${summary(q)}]`;
    const first = q.stays[0];
    const last = q.stays[q.stays.length - 1];
    const onTrip = new Set(q.stays.map((s) => s.placeId));
    const cityFor = (satellite: string) =>
      [...onTrip].some((id) => id !== satellite && !isSatellite(core, id) && core.placeAirports[id]?.iata === core.placeAirports[satellite]?.iata);

    // The traveller never ends the trip at a satellite when its airport city is also on the trip.
    if (isSatellite(core, last.placeId) && cityFor(last.placeId)) out.push(`${tag} ends at satellite ${last.placeId}`);
    // ...and starts at one only when the airport city it would be reached through had a single night to give.
    // That city is the nearest non-satellite stop sharing the airport, as in bookendGateways.
    const gatewayCity = (satellite: string) =>
      [...onTrip]
        .filter((id) => id !== satellite && !isSatellite(core, id) && core.placeAirports[id]?.iata === core.placeAirports[satellite]?.iata)
        .sort((a, b) => (airportDistanceKm(core, a) ?? 0) - (airportDistanceKm(core, b) ?? 0))[0];
    const entryCity = isSatellite(core, first.placeId) ? gatewayCity(first.placeId) : undefined;
    const entryCityNights = entryCity ? q.stays.filter((s) => s.placeId === entryCity).reduce((a, s) => a + s.nights, 0) : 0;
    if (entryCity && entryCityNights >= 2 && q.stays.length > 1) {
      out.push(`${tag} starts at satellite ${first.placeId} though ${entryCity} has ${entryCityNights} nights`);
    }
    // The engine may lengthen a trip (each place needs a night) or drop a place it cannot fit, so the
    // trip's real length is the number of days less one, not what was asked for. Whatever it settled on,
    // splitting a stop across two visits must not change how many nights any place gets: the baseline is
    // the allocation itself, which already applies each place's own minimum and maximum nights.
    const tripNights = q.days.length - 1;
    if (nightsTotal(q) !== tripNights) out.push(`${tag} stays total ${nightsTotal(q)} nights over a ${tripNights}-night trip`);
    const summaries = new Map(core.placeSummaries.map((x) => [x.placeId, x]));
    const baseline = allocateNights(ids, tripNights, summaries, STYLE_FOR_TRAVELLER.couple, {});
    for (const [id, expected] of baseline) {
      if (expected === 0 && !onTrip.has(id)) continue;
      const got = q.stays.filter((s) => s.placeId === id).reduce((a, s) => a + s.nights, 0);
      if (got !== expected) out.push(`${tag} ${id} has ${got} nights, the allocation gave ${expected}`);
    }
    for (const id of onTrip) {
      if (!ids.includes(id)) out.push(`${tag} added ${id}, which was not asked for`);
    }
    if (q.stays.some((s, i) => i > 0 && s.placeId === q.stays[i - 1].placeId)) out.push(`${tag} repeats a stop back to back`);
    if (q.stays.some((s) => s.nights <= 0)) out.push(`${tag} has a zero-night stop`);
    if (!q.days[0].airport || !q.days[q.days.length - 1].airport) out.push(`${tag} first or last day has no airport`);
    const clusters = q.days.flatMap((d) => d.activities.map((a) => a.clusterId)).filter(Boolean);
    if (new Set(clusters).size !== clusters.length) out.push(`${tag} plans an outing twice`);
    const hotelLines = q.lineItems.filter((i) => i.component === "hotel");
    const labels = hotelLines.map((i) => i.label);
    if (new Set(labels).size !== labels.length) out.push(`${tag} has two hotel lines with the same label`);
    const flight = q.lineItems.find((i) => i.component === "flight" && i.totalInr > 0);
    if (flight && !/\([A-Z]{3}\)/.test(flight.detail ?? "")) out.push(`${tag} flight line names no airport: ${flight.detail}`);
    if (!q.gateways) out.push(`${tag} has no gateways`);
    return out;
  }

  it("holds for every airport city with one to three of its satellites, in any order, at 2 to 14 nights", () => {
    const byAirport = new Map<string, string[]>();
    for (const p of pool) byAirport.set(core.placeAirports[p.id].iata, [...(byAirport.get(core.placeAirports[p.id].iata) ?? []), p.id]);
    const failures: string[] = [];
    let cases = 0;
    for (const [iata, ids] of byAirport) {
      const cities = ids.filter((id) => !isSatellite(core, id));
      const sats = ids.filter((id) => isSatellite(core, id));
      if (!cities.length || !sats.length) continue;
      const city = cities[0];
      const sets: string[][] = [];
      for (const s of sats.slice(0, 3)) {
        if (compatible([city, s])) sets.push([city, s], [s, city]);
      }
      const two = sats.filter((s) => compatible([city, s])).slice(0, 2);
      if (two.length === 2 && compatible([city, ...two])) sets.push([city, ...two], [two[0], city, two[1]], [...two, city]);
      for (const set of sets) {
        for (const nights of [2, 3, 4, 5, 7, 9, 14]) {
          cases++;
          failures.push(...check(set, nights, `${iata} ${set.join("+")}`));
        }
      }
    }
    expect(cases).toBeGreaterThan(400);
    expect(failures).toEqual([]);
  }, 120_000);

  it("holds for seeded random 2 to 4 place trips in one country anywhere in the catalogue", () => {
    const rand = rng(20261109);
    const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
    const failures: string[] = [];
    let cases = 0;
    for (let i = 0; i < 400; i++) {
      const anchor = pick(pool);
      const sameCountry = pool.filter((p) => p.countryId === anchor.countryId);
      const size = 2 + Math.floor(rand() * 3);
      const ids = [anchor.id];
      for (let guard = 0; guard < 30 && ids.length < size; guard++) {
        const next = pick(sameCountry).id;
        if (!ids.includes(next) && compatible([...ids, next])) ids.push(next);
      }
      if (ids.length < 2) continue;
      const nights = Math.max(ids.length, 3 + Math.floor(rand() * 12));
      cases++;
      failures.push(...check(ids, nights, `random#${i} ${ids.join("+")}`));
    }
    expect(cases).toBeGreaterThan(300);
    expect(failures).toEqual([]);
  }, 120_000);

  it("holds for Bangkok and Pattaya at every length from 2 to 21 nights, in both input orders", () => {
    const failures: string[] = [];
    for (let nights = 2; nights <= 21; nights++) {
      for (const ids of [["bangkok", "pattaya"], ["pattaya", "bangkok"]]) failures.push(...check(ids, nights, ids.join("+")));
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
