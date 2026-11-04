/**
 * The agency's own figures for two real test trips (a 4-adult + 1-child Rajasthan loop and a 3-adult
 * Vietnam circuit), written down as assertions so the engine cannot drift away from them again.
 *
 * The same engine and the same content files price the website and the phone app, so this is the one
 * place those figures are checked for both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { indiaGroundApplies, indiaVehicle, longLegMultiple } from "@retro/core/atlas/engine/pricing";
import { componentBreakdown } from "@retro/core/quote-pricing";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function quote(over: Partial<QuoteRequest> & Pick<QuoteRequest, "placeIds" | "nights">) {
  const req = QuoteRequest.parse({
    startDate: "2026-12-20", adults: 2, childAges: [], travellerType: "family", tripStyle: "family",
    nationality: "IND", departureCity: "CCU", hotelStar: "3 Star", hotelZone: "Central", carrier: "LCC",
    cabin: "Economy", mealPlan: "breakfast", food: "no-preference", pace: "balanced",
    includeVisa: false, includeInsurance: false, includeFlight: false, ...over,
  });
  const bundles = new Map<string, DestinationBundle>();
  for (const id of req.placeIds) {
    const place = core.places.find((p) => p.id === id)!;
    try { bundles.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8"))); } catch { /* no content file */ }
  }
  return generateQuotation(req, { core, routes, visaRules, bundles });
}
const sum = (q: ReturnType<typeof quote>, component: string) =>
  q.lineItems.filter((l) => l.component === component).reduce((a, l) => a + l.totalInr, 0);

const RAJASTHAN = { placeIds: ["jaipur", "bikaner", "jaisalmer", "jodhpur"], nights: 7, adults: 4, childAges: [8] };

describe("India: one all-in vehicle per day", () => {
  it("picks the class by party size at the agency's day rates", () => {
    expect(indiaVehicle(2)).toMatchObject({ label: "Sedan", dayRateInr: 4500, count: 1 });
    expect(indiaVehicle(5)).toMatchObject({ label: expect.stringContaining("SUV"), dayRateInr: 5500, count: 1 });
    expect(indiaVehicle(10)).toMatchObject({ label: expect.stringContaining("Tempo"), dayRateInr: 7500, count: 1 });
    expect(indiaVehicle(30)).toMatchObject({ label: expect.stringContaining("Bus"), dayRateInr: 9000, count: 1 });
    expect(indiaVehicle(50)).toMatchObject({ dayRateInr: 9000, count: 2 });
  });

  it("charges 5 travellers an SUV for each of the 8 days, and nothing else for road transport", () => {
    const q = quote({ ...RAJASTHAN, mealPlan: "half-board" });
    const vehicle = q.lineItems.filter((l) => l.component === "ground-transport");
    expect(vehicle).toHaveLength(1);
    expect(vehicle[0]).toMatchObject({ quantity: 8, unitPriceInr: 5500, totalInr: 44000 });
    // Airport runs, sightseeing and the drives between cities are all inside that one line.
    for (const c of ["airport-transfer", "local-transport", "intercity-transport"]) expect(sum(q, c)).toBe(0);
  });

  it("makes the road the default between Indian cities and shows it as included", () => {
    const q = quote(RAJASTHAN);
    const legs = q.days.filter((d) => d.isTransferDay && d.transfer && d.transfer.mode !== "transfer").map((d) => d.transfer!);
    expect(legs.length).toBe(3);
    for (const leg of legs) {
      expect(leg.mode).toBe("private_vehicle");
      expect(leg.includedInVehicle).toBe(true);
      expect(leg.priceInr).toBe(0);
    }
  });

  it("still bills a leg the traveller moves to a train, on top of the vehicle", () => {
    const base = quote(RAJASTHAN);
    const second = base.days.find((d) => d.isTransferDay && d.transfer?.alternatives.some((a) => a.mode === "train"))!;
    const q = quote({ ...RAJASTHAN, legModes: { [second.placeId]: "train" } });
    expect(sum(q, "intercity-transport")).toBeGreaterThan(0);
    expect(sum(q, "ground-transport")).toBe(44000);
  });

  it("doubles and triples the day for a drive that swallows the day", () => {
    expect(longLegMultiple(5 * 60)).toBe(1);
    expect(longLegMultiple(8 * 60)).toBe(1);
    expect(longLegMultiple(9 * 60)).toBe(2);
    expect(longLegMultiple(15 * 60)).toBe(3);
    expect(longLegMultiple(null)).toBe(1);
  });

  it("applies only when every stop is in India", () => {
    expect(indiaGroundApplies(core, ["jaipur", "jodhpur"])).toBe(true);
    expect(indiaGroundApplies(core, ["jaipur", "kathmandu"])).toBe(false);
    expect(indiaGroundApplies(core, ["ha-noi"])).toBe(false);
    expect(indiaGroundApplies(core, [])).toBe(false);
    const abroad = quote({ placeIds: ["ha-noi", "danang"], nights: 5 });
    expect(sum(abroad, "ground-transport")).toBe(0);
    expect(sum(abroad, "airport-transfer")).toBeGreaterThan(0);
  });
});

describe("India: meals at the agency's per-meal price", () => {
  it("prices 7 dinners for 4 adults and a child inside the agency's 17,500-28,000", () => {
    const q = quote({ ...RAJASTHAN, mealPlan: "half-board" });
    const meals = sum(q, "meals");
    expect(meals).toBeGreaterThanOrEqual(17500);
    expect(meals).toBeLessThanOrEqual(28000);
    // Not the 1,09,344 the workbook template produced.
    expect(meals).toBeLessThan(40000);
  });

  it("uses INR 650 a head at 3 Star and scales up with the hotel class", () => {
    const at = (hotelStar: "3 Star" | "4 Star" | "5 Star") =>
      quote({ ...RAJASTHAN, hotelStar, mealPlan: "half-board" }).lineItems.find((l) => l.component === "meals")!.unitPriceInr;
    expect(at("3 Star")).toBe(650);
    expect(at("4 Star")).toBeGreaterThan(650);
    expect(at("5 Star")).toBeGreaterThan(at("4 Star"));
  });

  it("charges nothing for meals on a breakfast-only plan", () => {
    expect(sum(quote(RAJASTHAN), "meals")).toBe(0);
  });
});

describe("Vietnam: Ha Noi, Danang, Hochiminh, Phu Quoc", () => {
  const VIETNAM = {
    placeIds: ["ha-noi", "danang", "hochiminh", "phu-quoc"], nights: 10, startDate: "2027-04-17", adults: 3,
    hotelStar: "4 Star" as const, includeFlight: true, includeVisa: true,
  };

  it("serves Danang from its own airport, so no 628 km link to Hanoi is billed", () => {
    expect(core.placeAirports["danang"].iata).toBe("DAD");
    expect(core.placeAirports["phuket"].iata).toBe("HKT");
    const q = quote(VIETNAM);
    expect(q.lineItems.some((l) => /Noi Bai/.test(l.label) && /Danang/.test(l.label))).toBe(false);
    const links = q.days.flatMap((d) => d.transfer?.airportLinks ?? []);
    for (const link of links) expect(link.distanceKm).toBeLessThan(100);
  });

  it("keeps airports that really are far from the town they serve", () => {
    expect(core.placeAirports["interlaken"]?.iata).toBe("ZRH");
  });

  it("offers no train or road across the sea to Phu Quoc", () => {
    const q = quote(VIETNAM);
    const leg = q.days.find((d) => d.isTransferDay && d.transfer?.to === "Phu Quoc")!.transfer!;
    expect(leg.alternatives.map((a) => a.mode)).toEqual(["flight"]);
  });

  it("prices 4 Star rooms for the whole trip at about 1.5 lakh or less", () => {
    const q = quote(VIETNAM);
    const accommodation = componentBreakdown(q, q.totals.total).find((r) => r.key === "hotel")!.amountInr;
    expect(accommodation).toBeLessThanOrEqual(150000);
    expect(accommodation).toBeGreaterThan(100000);
  });

  it("charges the Vietnam visa at INR 3,360 a head", () => {
    const visa = quote(VIETNAM).lineItems.find((l) => l.component === "visa")!;
    expect(visa.unitPriceInr).toBe(3360);
    expect(visa.totalInr).toBe(10080);
  });

  it("charges for Phu Quoc's paid attractions instead of quoting the whole island at zero", () => {
    const q = quote(VIETNAM);
    const north = q.lineItems.find((l) => l.component === "sightseeing" && l.label.startsWith("NORTH ISLAND"))!;
    expect(north.unitPriceInr).toBeGreaterThan(5000);
    expect(sum(q, "sightseeing")).toBeGreaterThan(25000);
  });

  it("brings the air total to the agency's retrieved figure, within about 10%", () => {
    const q = quote(VIETNAM);
    const air = sum(q, "flight") + q.lineItems
      .filter((l) => l.component === "intercity-transport" && /flight/.test(l.detail))
      .reduce((a, l) => a + l.totalInr, 0);
    // 59,000 a head for CCU-HAN-DAD-PQC-SGN-BKK-CCU, three travellers, before margin.
    expect(air / 3).toBeGreaterThan(59000 / 1.13 * 0.9);
    expect(air / 3).toBeLessThan(59000 / 1.13 * 1.1);
  });
});
