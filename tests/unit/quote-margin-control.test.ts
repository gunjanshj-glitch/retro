/**
 * The admin sets the agency's margin by hand (overall, or per category) and the
 * traveller's quote moves with it. Cost never changes, the parts always add up,
 * and the margin itself is never shown to the traveller.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation } from "@retro/core/atlas/engine";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { buildPublicQuote, componentBreakdown, emptyAdjustments, summariseMargin } from "@retro/core/quote-pricing";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function quote(over: Record<string, unknown> = {}) {
  const req = QuoteRequest.parse({
    placeIds: ["paris", "rome"], nights: 6,
    startDate: "2026-12-20", adults: 2, childAges: [], travellerType: "couple", tripStyle: "culture",
    nationality: "IND", departureCity: "DEL", hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC",
    cabin: "Economy", mealPlan: "breakfast", food: "no-preference", pace: "balanced",
    includeVisa: false, includeInsurance: false, includeFlight: false, ...over,
  });
  const bundles = new Map<string, DestinationBundle>();
  for (const id of req.placeIds) {
    const place = core.places.find((p) => p.id === id)!;
    try { bundles.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8"))); } catch { /* none */ }
  }
  return generateQuotation(req, { core, routes, visaRules, bundles });
}

const meta = { validUntil: "2099-01-01", note: null };

describe("hand-set margin", () => {
  const auto = quote();

  it("leaves the policy margin alone when nothing is set", () => {
    expect(auto.totals.marginByComponent).toBeUndefined();
  });

  it("an overall margin replaces the policy rate: margin = cost x pct, cost unchanged", () => {
    const q = quote({ marginPct: 0.25 });
    expect(q.totals.directCost).toBe(auto.totals.directCost);
    expect(q.totals.agentMarkup).toBeCloseTo(q.totals.directCost * 0.25, -1);
    const m = summariseMargin(q, emptyAdjustments());
    expect(m.marginInr / m.costInr).toBeCloseTo(0.25, 2);
  });

  it("more margin raises the traveller's price, less lowers it", () => {
    const hi = quote({ marginPct: 0.3 }).totals.total;
    const lo = quote({ marginPct: 0.05 }).totals.total;
    expect(hi).toBeGreaterThan(auto.totals.total);
    expect(lo).toBeLessThan(auto.totals.total);
  });

  it("cost + contingency + margin + GST + fees still add up to the total", () => {
    for (const marginPct of [0, 0.05, 0.4]) {
      const t = quote({ marginPct }).totals;
      expect(Math.abs(t.directCost + t.contingency + t.agentMarkup + t.salesVat + t.paymentAndFx - t.total)).toBeLessThanOrEqual(5);
    }
  });

  it("a per-category margin applies to that category only", () => {
    const base = quote({ marginPct: 0.1 });
    const q = quote({ marginPct: 0.1, componentMarginPct: { hotel: 0.4 } });
    const hotel = (t: typeof q) => t.totals.marginByComponent!.hotel;
    expect(hotel(q)).toBeGreaterThan(hotel(base));
    for (const [k, v] of Object.entries(base.totals.marginByComponent!)) {
      if (k !== "hotel") expect(q.totals.marginByComponent![k]).toBe(v);
    }
    const m = summariseMargin(q, emptyAdjustments());
    expect(m.categories.find((c) => c.key === "hotel")!.marginPct!).toBeCloseTo(0.4, 2);
  });

  it("the traveller's category rows carry each category's own margin and sum to the package price", () => {
    const q = quote({ marginPct: 0.1, componentMarginPct: { hotel: 0.4 } });
    const rows = componentBreakdown(q, q.totals.total);
    expect(rows.reduce((s, r) => s + r.amountInr, 0)).toBe(q.totals.total);
    const m = summariseMargin(q, emptyAdjustments());
    for (const c of m.categories) expect(c.costInr + c.cutInr).toBe(c.sellInr);
  });

  it("a hand-set margin is not undone by the published-package floor", () => {
    const pkg = core.packages.find((p) => p.id === "africa-kenya-safari")!;
    const over = { placeIds: pkg.placeIds, nights: pkg.nights, adults: 3, childAges: [6, 2], hotelStar: "3 Star", includeFlight: true };
    expect(quote(over).totals.flooredToPackage).toBe(pkg.name);
    const q = quote({ ...over, marginPct: 0.02 });
    expect(q.totals.flooredToPackage).toBeNull();
    expect(q.totals.total).toBeLessThan(quote(over).totals.total);
  });

  it("the public quote moves with the margin and never exposes it", () => {
    const hi = buildPublicQuote(quote({ marginPct: 0.3 }), emptyAdjustments(), meta);
    const lo = buildPublicQuote(quote({ marginPct: 0.05 }), emptyAdjustments(), meta);
    expect(hi.packageInr).toBeGreaterThan(lo.packageInr);
    const text = JSON.stringify(hi);
    expect(text).not.toMatch(/margin|agentMarkup|contingency/i);
  });

  it("rejects a nonsense margin", () => {
    expect(() => QuoteRequest.parse({ ...quote().request, marginPct: 1.5 })).toThrow();
    expect(() => QuoteRequest.parse({ ...quote().request, marginPct: -0.1 })).toThrow();
  });
});
