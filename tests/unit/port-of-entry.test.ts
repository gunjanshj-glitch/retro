import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation, STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { arrivalDay } from "@retro/core/atlas/engine/entry";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function quote(placeIds: string[], nights: number, extra: Partial<QuoteRequest> = {}) {
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
  return generateQuotation(request, { core, routes, visaRules, bundles, ignorePackageFloor: true });
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
