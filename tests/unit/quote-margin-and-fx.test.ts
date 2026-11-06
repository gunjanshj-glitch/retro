/* eslint-disable @typescript-eslint/no-explicit-any -- worker responses are untyped JSON in these tests */
/**
 * The agency's view of a quote (cost vs cut), the published-package floor
 * keeping the books straight, live exchange rates on the compiled card, and
 * the live-rate feed's keys lining up with the keys the engine reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { generateQuotation } from "@retro/core/atlas/engine";
import { applyLiveFx, fxAdjustments, type FxRates } from "@retro/core/atlas/engine/fx";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import { componentBreakdown, emptyAdjustments, priceQuote, summariseMargin } from "@retro/core/quote-pricing";
import { handleLiveRates } from "@/workers/api/src/live-rates";
import { totalsMismatch } from "@/workers/api/src/request-admin";
import type { Env } from "@/workers/api/src/http";

const DIR = path.join("public", "atlas");
const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DIR, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DIR, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DIR, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

function quote(over: Record<string, unknown>, extra: Partial<Parameters<typeof generateQuotation>[1]> = {}) {
  const req = QuoteRequest.parse({
    startDate: "2026-12-20", adults: 2, childAges: [], travellerType: "couple", tripStyle: "culture",
    nationality: "IND", departureCity: "DEL", hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC",
    cabin: "Economy", mealPlan: "breakfast", food: "no-preference", pace: "balanced",
    includeVisa: false, includeInsurance: false, includeFlight: false, ...over,
  });
  const bundles = new Map<string, DestinationBundle>();
  for (const id of req.placeIds) {
    const place = core.places.find((p) => p.id === id)!;
    try { bundles.set(id, JSON.parse(readFileSync(path.join(DIR, "destinations", `${place.slug}.json`), "utf8"))); } catch { /* no content file */ }
  }
  return generateQuotation(req, { core, routes, visaRules, bundles, ...extra });
}

const PARIS_ROME = { placeIds: ["paris", "rome"], nights: 6 };
const adjust = (over: Partial<ReturnType<typeof emptyAdjustments>>) => ({ ...emptyAdjustments(), ...over });

describe("agency view: cost versus cut", () => {
  const q = quote(PARIS_ROME);

  it("cost, contingency, margin and GST add up to the package price", () => {
    const m = summariseMargin(q, emptyAdjustments());
    expect(m.costInr).toBe(q.totals.directCost);
    expect(m.costInr + m.contingencyInr + m.marginInr + m.taxInr).toBe(m.packageInr);
    expect(m.totalInr).toBe(q.totals.total);
    expect(m.cutInr).toBe(m.contingencyInr + m.marginInr);
    expect(m.cutPct).toBeCloseTo(m.cutInr / m.costInr, 6);
  });

  it("per category: cost + cut = what the traveller sees, and the rows match the traveller's own breakdown", () => {
    const m = summariseMargin(q, emptyAdjustments());
    const seen = new Map(componentBreakdown(q, q.totals.total).map((r) => [r.key, r.amountInr]));
    for (const c of m.categories) {
      expect(c.sellInr).toBe(seen.get(c.key));
      expect(c.costInr + c.cutInr).toBe(c.sellInr);
    }
    // Each category is rounded to the rupee on its own, so the sum may be a rupee or two per row away.
    expect(Math.abs(m.categories.reduce((s, c) => s + c.cutInr, 0) - m.cutInr)).toBeLessThanOrEqual(m.categories.length);
    expect(m.categories.reduce((s, c) => s + c.costInr, 0)).toBeCloseTo(m.costInr, -1);
  });

  it("a pinned price moves only the margin, never the cost", () => {
    const pinned = q.totals.total + 20_000;
    const m = summariseMargin(q, adjust({ fixedPackageInr: pinned }));
    expect(m.costInr).toBe(q.totals.directCost);
    expect(m.pinnedByInr).toBe(20_000);
    expect(m.costInr + m.contingencyInr + m.marginInr + m.taxInr).toBe(pinned);
    expect(m.cutInr).toBeGreaterThan(summariseMargin(q, emptyAdjustments()).cutInr);
  });

  it("discounts come off the cut, optional extras are not counted until chosen", () => {
    const base = summariseMargin(q, emptyAdjustments());
    const m = summariseMargin(q, adjust({ lines: [{ id: "d", label: "Loyalty", amountInr: -5_000, optional: false }, { id: "o", label: "Spa", amountInr: 9_000, optional: true }] }));
    expect(m.extrasInr).toBe(-5_000);
    expect(m.cutInr).toBe(base.cutInr - 5_000);
    expect(m.totalInr).toBe(priceQuote(q.totals.total, adjust({ lines: [{ id: "d", label: "x", amountInr: -5_000, optional: false }] })).totalInr);
  });

  it("goes negative, not silently zero, when the price is below cost plus tax", () => {
    const m = summariseMargin(q, adjust({ fixedPackageInr: Math.round(q.totals.directCost * 0.9) }));
    expect(m.cutInr).toBeLessThan(0);
    expect(m.categories.some((c) => c.cutInr < 0)).toBe(true);
  });
});

describe("a quote raised to the published package price", () => {
  // Kenya Safari for a family on a budget hotel lands under its published "from" price.
  const pkg = core.packages.find((p) => p.id === "africa-kenya-safari")!;
  const q = quote({ placeIds: pkg.placeIds, nights: pkg.nights, adults: 3, childAges: [6, 2], hotelStar: "3 Star", includeFlight: true });

  it("is actually raised (the premise of these tests)", () => {
    expect(q.totals.flooredToPackage).toBe(pkg.name);
  });

  it("books the uplift as margin so the totals still add up", () => {
    const t = q.totals;
    expect(t.directCost + t.contingency + t.agentMarkup + t.salesVat + t.paymentAndFx).toBe(t.total);
    expect(t.paymentAndFx).toBeGreaterThanOrEqual(0);
  });

  it("does not show the uplift to the traveller as Taxes & fees", () => {
    const taxes = componentBreakdown(q, q.totals.total).find((r) => r.key === "taxes")?.amountInr ?? 0;
    expect(taxes).toBe(q.totals.salesVat + q.totals.paymentAndFx);
    expect(taxes).toBeLessThan(q.totals.total * 0.1);
  });

  it("is reported to the agency as extra cut", () => {
    const m = summariseMargin(q, emptyAdjustments());
    expect(m.flooredTo).toBe(pkg.name);
    expect(m.costInr + m.contingencyInr + m.marginInr + m.taxInr).toBe(m.packageInr);
  });
});

describe("live exchange rates on the compiled card", () => {
  const fresh = (rates: Record<string, number>): FxRates => ({ rates, fetchedAt: new Date().toISOString() });

  it("reads the rate the card was built at from its own rows", () => {
    const adj = fxAdjustments(core, fresh({ USD: 94.5 * 1.05 }));
    expect(adj).toHaveLength(1);
    expect(adj[0].currency).toBe("USD");
    expect(adj[0].cardInrPerUnit).toBeCloseTo(94.5, 1);
    expect(adj[0].factor).toBeCloseTo(1.05, 2);
    expect(adj[0].rowsAffected).toBeGreaterThan(1000);
  });

  it("ignores noise, an implausible jump, a stale feed and a missing one", () => {
    expect(fxAdjustments(core, fresh({ USD: 94.5 * 1.002 }))).toEqual([]);
    expect(fxAdjustments(core, fresh({ USD: 94.5 * 1.5 }))).toEqual([]);
    expect(fxAdjustments(core, fresh({ USD: -1, EUR: Number.NaN }))).toEqual([]);
    expect(fxAdjustments(core, { rates: { USD: 100 }, fetchedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() })).toEqual([]);
    expect(fxAdjustments(core, undefined)).toEqual([]);
  });

  it("hands back the same objects when nothing moved", () => {
    const bundles = new Map<string, DestinationBundle>();
    const out = applyLiveFx(core, bundles, fresh({ USD: 94.5 }));
    expect(out.core).toBe(core);
    expect(out.bundles).toBe(bundles);
  });

  it("rescales only rows quoted in the moved currency", () => {
    const out = applyLiveFx(core, new Map(), fresh({ USD: 94.5 * 1.1 }));
    const usd = core.hotelRates.findIndex((r) => r.baselineCurrency === "USD" && r.baseline);
    const est = core.hotelRates.findIndex((r) => r.baselineCurrency == null);
    expect(out.applied[0].factor).toBeCloseTo(1.1, 2);
    expect(out.core.hotelRates[usd].inr).toBeCloseTo(core.hotelRates[usd].inr * out.applied[0].factor, 6);
    expect(out.core.hotelRates[est].inr).toBe(core.hotelRates[est].inr);
    expect(out.core.flightBands).toBe(core.flightBands);
  });

  it("reprices a quote and says so", () => {
    const base = quote(PARIS_ROME);
    const moved = quote(PARIS_ROME, { fxRates: fresh({ USD: 94.5 * 1.1, EUR: 109.7 * 1.1 }) });
    expect(moved.totals.directCost).toBeGreaterThan(base.totals.directCost);
    expect(moved.totals.directCost).toBeLessThan(base.totals.directCost * 1.11);
    expect(moved.fx?.map((f) => f.currency).sort()).toEqual(["EUR", "USD"]);
    expect(base.fx).toBeUndefined();
  });
});

describe("live-rate feed", () => {
  const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
  afterEach(() => vi.unstubAllGlobals());

  it("keys a flight by the engine's destination-country id, not the airport", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ price: 41_000, airline: "AI" }] }))));
    const env = { TRAVELPAYOUTS_TOKEN: "t" } as Env;
    const res = await handleLiveRates(new Request("https://x/api/live-rates?origin=DEL&destinationIata=CDG&month=2030-01&carrier=FSC&fareKey=europe-france"), env, ctx);
    const body = (await res.json()) as any;
    expect(body.rates).toHaveLength(1);
    expect(`${body.rates[0].component}:${body.rates[0].key}`).toBe("flight:DEL:europe-france:FSC");
  });

  it("refuses a fare key that is not a country id", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleLiveRates(new Request("https://x/api/live-rates?origin=DEL&destinationIata=CDG&month=2030-01&fareKey=../x"), { TRAVELPAYOUTS_TOKEN: "t" } as Env, ctx);
    expect(((await res.json()) as any).rates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves rupee exchange rates for the card's currencies, falling back to a second provider", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("frankfurter")) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ rates: { INR: 94.4, EUR: 0.89 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleLiveRates(new Request("https://x/api/live-rates?fx=1"), {} as Env, ctx);
    const body = (await res.json()) as any;
    expect(body.fx.rates.USD).toBeCloseTo(94.4, 6);
    expect(body.fx.rates.EUR).toBeCloseTo(94.4 / 0.89, 6);
    expect(Date.parse(body.fx.fetchedAt)).toBeGreaterThan(Date.now() - 5000);
  });

  it("answers with no rate rather than a made-up one when both providers fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const body = (await (await handleLiveRates(new Request("https://x/api/live-rates?fx=1"), {} as Env, ctx)).json()) as any;
    expect(body.fx).toBeNull();
  });
});

describe("a quote whose parts disagree is refused on send", () => {
  const good = { directCost: 1000, contingency: 30, agentMarkup: 100, salesVat: 56, paymentAndFx: 0, total: 1186 };
  const lines = [{ totalInr: 600 }, { totalInr: 400 }];

  it("accepts consistent totals, and older payloads without the parts", () => {
    expect(totalsMismatch(good, lines)).toBeNull();
    expect(totalsMismatch({ total: 500 }, lines)).toBeNull();
  });

  it("rejects lines that do not add to the direct cost, a broken chain, or an unusable amount", () => {
    expect(totalsMismatch(good, [{ totalInr: 600 }])).toMatch(/lines/);
    expect(totalsMismatch({ ...good, total: 1500 }, lines)).toMatch(/total/);
    expect(totalsMismatch({ ...good, total: -5 }, lines)).toMatch(/valid amount/);
    expect(totalsMismatch(good, [{ totalInr: Number.NaN }, { totalInr: 400 }])).toMatch(/valid amount/);
  });

  it("lets a floored quote through on its chain but still checks its lines", () => {
    expect(totalsMismatch({ ...good, total: 2000, flooredToPackage: "Kenya Safari" }, lines)).toBeNull();
    expect(totalsMismatch({ ...good, flooredToPackage: "Kenya Safari" }, [{ totalInr: 1 }])).toMatch(/lines/);
  });

  it("holds for a real engine quote, floored or not", () => {
    const real = quote(PARIS_ROME);
    expect(totalsMismatch(real.totals as any, real.lineItems)).toBeNull();
    const pkg = core.packages.find((p) => p.id === "africa-kenya-safari")!;
    const floored = quote({ placeIds: pkg.placeIds, nights: pkg.nights, adults: 3, childAges: [6, 2], hotelStar: "3 Star", includeFlight: true });
    expect(totalsMismatch(floored.totals as any, floored.lineItems)).toBeNull();
  });
});
