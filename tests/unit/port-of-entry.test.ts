import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { arrivalDay, type LiveOffer } from "@retro/core/atlas/engine/entry";
import type { LiveRate } from "@retro/core/atlas/engine/pricing";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function quote(placeIds: string[], nights: number, extra: Partial<QuoteRequest> = {}, liveRates?: Map<string, LiveRate>) {
  const bundles = new Map<string, DestinationBundle>();
  for (const id of placeIds) {
    try { bundles.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${id}.json`), "utf8"))); } catch { /* none */ }
  }
  const request = QuoteRequest.parse({
    startDate: "2026-12-05", adults: 2, childAges: [], travellerType: "couple", tripStyle: STYLE_FOR_TRAVELLER.couple,
    nationality: "IND", departureCity: "DEL", hotelStar: "3 Star", hotelZone: "Outskirts", carrier: "FSC", cabin: "Economy",
    mealPlan: "breakfast", food: "no-preference", pace: "balanced", includeVisa: false, includeInsurance: false, includeFlight: true,
    placeIds, nights, ...extra,
  });
  return generateQuotation(request, { core, routes, visaRules, bundles, ignorePackageFloor: true, ...(liveRates ? { liveRates } : {}) });
}

describe("port of entry on a domestic trip", () => {
  it("builds an Arunachal trip around Guwahati, working outward and back, not starting at Tawang", () => {
    const q = quote(["tawang", "guwahati", "dirang"], 7);
    expect(q.portOfEntry?.code).toBe("GAU");
    expect(q.stays[0].placeId).toBe("guwahati");
    expect(q.stays[q.stays.length - 1].placeId).toBe("guwahati");
    expect(q.stays.map((s) => s.placeId)).toEqual(["guwahati", "dirang", "tawang", "guwahati"]);
  });

  it("prices the flight to the port, not to the last destination, and offers a train as a choice", () => {
    const q = quote(["tawang", "dirang"], 6);
    expect(q.portOfEntry?.entry?.options.map((o) => o.mode)).toEqual(["flight", "train"]);
    const fare = q.lineItems.find((i) => i.label.startsWith("Return airfare"));
    expect(fare?.label).toMatch(/Delhi to .*Guwahati/);
    const train = quote(["tawang", "dirang"], 6, { entryMode: "train" });
    expect(train.portOfEntry?.entry?.mode).toBe("train");
    expect(train.lineItems.some((i) => i.label.startsWith("Return train fare"))).toBe(true);
    expect(train.lineItems.some((i) => i.label.startsWith("Return airfare"))).toBe(false);
  });

  it("treats an evening arrival as a rest day and an afternoon one as a light day", () => {
    expect(arrivalDay(20 * 60, 60).restDay).toBe(true);
    expect(arrivalDay(10 * 60, 45).restDay).toBe(false);
    expect(arrivalDay(13 * 60 + 30, 60).restDay).toBe(true);
    const q = quote(["tawang", "dirang"], 6, { entryMode: "train" });
    expect(q.days[0].arrival?.restDay).toBe(true);
    expect(q.days[0].activities).toHaveLength(0);
  });

  it("lists Gangtok's railhead (NJP) among its arrival points via the transport patch", () => {
    const q = quote(["gangtok"], 3, { entryMode: "train", departureCity: "CCU" });
    expect(q.portOfEntry?.entry?.options.some((o) => o.mode === "train" && /Jalpaiguri/.test(o.hub))).toBe(true);
  });

  it("offers a coach only where the road journey is regional, and prices it as a coach", () => {
    const near = quote(["gangtok"], 3, { departureCity: "CCU" });
    const modes = near.portOfEntry?.entry?.options.map((o) => o.mode) ?? [];
    expect(modes).toContain("bus");
    const bus = quote(["gangtok"], 3, { departureCity: "CCU", entryMode: "bus" });
    expect(bus.portOfEntry?.entry?.mode).toBe("bus");
    expect(bus.lineItems.some((i) => i.label.startsWith("Return coach fare"))).toBe(true);
    const far = quote(["tawang", "dirang"], 6);
    expect(far.portOfEntry?.entry?.options.some((o) => o.mode === "bus")).toBe(false);
  });

  it("has railheads for Himalayan states beyond Sikkim and Arunachal", () => {
    const q = quote(["nainital", "almora"], 4);
    expect(q.portOfEntry?.entry?.options.some((o) => o.mode === "train" && /Kathgodam/.test(o.hub))).toBe(true);
  });
});

describe("short legs prefer land, then water, air last", () => {
  it("never defaults to a flight for a leg of 200 km or less", () => {
    const q = quote(["gangtok", "pelling"], 5, { transportPreference: "fastest" });
    for (const d of q.days) if (d.transfer && d.isTransferDay) expect(d.transfer.mode).not.toBe("flight");
  });
});

describe("outings placed on a chosen day", () => {
  it("puts a cluster on the day asked for, and reports one asked for on the wrong destination", () => {
    const base = quote(["tawang", "dirang"], 6);
    const dirangDay = base.days.find((d) => d.placeId === "dirang" && d.activities.length === 0 && !d.transfer)
      ?? base.days.find((d) => d.placeId === "dirang")!;
    const tawangCluster = base.sightseeingOptions!.find((o) => o.placeId === "tawang" && o.clusterId)!;
    const wrong = quote(["tawang", "dirang"], 6, { clusterDays: { [tawangCluster.clusterId!]: dirangDay.dayNumber } });
    expect(wrong.warnings.some((w) => /cannot go on day/.test(w.message))).toBe(true);
  });

  it("moves a planned outing to the day the traveller picked", () => {
    const base = quote(["tawang"], 5);
    const days = base.days.filter((d) => d.activities.some((a) => a.clusterId));
    const first = days[0];
    const lastDay = days[days.length - 1];
    const moved = lastDay.activities.find((a) => a.clusterId)!;
    const q = quote(["tawang"], 5, { clusterDays: { [moved.clusterId!]: first.dayNumber } });
    expect(q.days.find((d) => d.dayNumber === first.dayNumber)!.activities.some((a) => a.clusterId === moved.clusterId)).toBe(true);
    expect(q.days.find((d) => d.dayNumber === lastDay.dayNumber)!.activities.some((a) => a.clusterId === moved.clusterId)).toBe(false);
  });
});

describe("flights chosen so the traveller can reach the hotel", () => {
  const offer = (inr: number, h: number, m = 0): LiveOffer => ({ inr, departsMin: 6 * 60, arrivesMin: h * 60 + m, arrivesDayOffset: 0, stops: 0, airline: "Test Air" });
  const live = (offers: LiveOffer[], port = "gau") =>
    new Map<string, LiveRate>([[
      `flight:DEL:port-${port}:FSC`,
      { component: "flight", key: `DEL:port-${port}:FSC`, inr: Math.min(...offers.map((o) => o.inr)), fetchedAt: "2026-11-12T00:00:00Z", provider: "google-flights", offers },
    ]]);

  it("takes a dearer flight that lands in time over a cheaper one that does not", () => {
    const q = quote(["gangtok"], 4, {}, live([offer(7000, 22, 30), offer(12000, 9, 15)], "ixb"));
    expect(q.portOfEntry?.entry?.mode).toBe("flight");
    expect(q.portOfEntry?.entry?.live).toBe(true);
    expect(q.portOfEntry?.entry?.fareInr).toBe(12000);
    expect(q.portOfEntry?.portNight).toBeUndefined();
    expect(q.portOfEntry?.entry?.arrivesAt).toBe("09:15");
  });

  it("puts a night near the airport when every listed flight lands too late for the drive", () => {
    const q = quote(["tawang", "dirang"], 6, {}, live([offer(7000, 22, 30), offer(9000, 21, 0)]));
    expect(q.portOfEntry?.portNight?.place).toBe("Guwahati");
    expect(q.stays[0].placeId).toBe("guwahati");
    expect(q.stays.reduce((n, s) => n + s.nights, 0)).toBe(7);
  });

  it("does not add a night for the modelled schedule when it reaches the hotel in time", () => {
    const q = quote(["gangtok"], 4);
    expect(q.portOfEntry?.portNight).toBeUndefined();
    expect(q.portOfEntry?.entry?.live).toBeUndefined();
  });
});
