/**
 * The phone prices trips from exactly the files listed in `manifest.json` and from nothing else. This test
 * does the same: it reads ONLY manifest-listed files, prices a real trip, then applies a backend-delivered
 * policy change and checks the price moves, which is what lets prices change with no app release.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseManifest } from "@retro/core/catalogue";
import { generateQuotation } from "@retro/core/atlas/engine";
import { applyRuntimePolicy } from "@retro/core/atlas/engine/runtime-policy";
import { CoreBundle, type DestinationBundle, type Route, type VisaRule } from "@retro/core/atlas/schema";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import policy from "@/content/quote-policy.json";

const PUBLIC = "public";
const have = existsSync(path.join(PUBLIC, "atlas", "manifest.json"));

describe.skipIf(!have)("app catalogue", () => {
  const manifest = parseManifest(JSON.parse(readFileSync(path.join(PUBLIC, "atlas", "manifest.json"), "utf8")))!;
  const listed = new Set(manifest.files.map((f) => f.path));
  const read = <T,>(p: string): T => {
    expect(listed.has(p), `${p} must be in the manifest or the app will not have it`).toBe(true);
    return JSON.parse(readFileSync(path.join(PUBLIC, p), "utf8")) as T;
  };

  it("has a revision and ships the engine's commercial files", () => {
    expect(manifest.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(listed.has("atlas/engine/quote-policy.json")).toBe(true);
    expect(listed.has("atlas/engine/pricing-calibration.json")).toBe(true);
    expect(manifest.files.every((f) => !f.path.includes("guidance"))).toBe(true);
  });

  it("prices a Rajasthan trip from manifest-listed files only, then follows a backend policy change", () => {
    const core = CoreBundle.parse(read("atlas/core.json"));
    const routes = read<{ routes: Route[] }>("atlas/routes.json").routes;
    const visaRules = read<{ rules: VisaRule[] }>("atlas/visa.json").rules;
    const ids = core.places.filter((p) => ["Jaipur", "Jodhpur"].includes(p.name) && p.hasContent).map((p) => p.id);
    expect(ids.length).toBe(2);
    const bundles = new Map<string, DestinationBundle>();
    for (const id of ids) bundles.set(id, read(`atlas/destinations/${core.places.find((p) => p.id === id)!.slug}.json`));

    const req = QuoteRequest.parse({
      placeIds: ids, nights: 6, startDate: "2026-12-10", adults: 2, childAges: [], travellerType: "couple", tripStyle: "romantic",
      nationality: "IND", departureCity: "DEL", hotelStar: "4 Star", hotelZone: "Central", carrier: "FSC", cabin: "Economy",
      mealPlan: "breakfast", food: "no-preference", pace: "balanced", includeVisa: false, includeInsurance: false, includeFlight: false,
    });
    const before = generateQuotation(req, { core, routes, visaRules, bundles }).totals.total;
    expect(before).toBeGreaterThan(0);

    const original = structuredClone(policy) as unknown as Record<string, unknown>;
    const changed = structuredClone(original) as { markup: { salesVat: number } };
    changed.markup.salesVat += 0.1;
    try {
      applyRuntimePolicy({ policy: changed });
      const after = generateQuotation(req, { core, routes, visaRules, bundles }).totals.total;
      expect(after).toBeGreaterThan(before);
    } finally {
      applyRuntimePolicy({ policy: original });
    }
    expect(generateQuotation(req, { core, routes, visaRules, bundles }).totals.total).toBe(before);
  });
});
