/**
 * Prices every published package through the quotation engine and reports how
 * far the generated number lands from the agency's own "from" price.
 *
 * The published price is a *minimum*: per person, twin share, cheapest hotel,
 * cheapest carrier — and it covers the **land package only**, with airfare
 * quoted on top. So the harness builds exactly that configuration with the
 * flight excluded, searches every departure city and the cheapest month, and
 * takes the lowest result — anything else would not be a like-for-like
 * comparison. (Departure city still matters with no airfare: it drives the
 * visa and some transfer rates.)
 *
 * The package price floor is switched off, otherwise every package would
 * trivially reproduce its own published price and the test would prove nothing.
 *
 *   npm run calibrate              # report only
 *   npm run calibrate -- --write   # also fit and write correction factors
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CoreBundle,
  type DestinationBundle,
  type Package,
  type Route,
  type TripStyle,
  type VisaRule,
} from "@retro/core/atlas/schema";
import { generateQuotation } from "@retro/core/atlas/engine";
import { QuoteRequest, type CostComponent, type Quotation } from "@retro/core/atlas/engine/types";
import { writeWorkbook, type SheetSpec } from "./xlsx-write";
import { Workbook, cell, num } from "./xlsx-read";
import quotePolicy from "../../content/quote-policy.json";

const DATA = "public/atlas";
const CALIBRATION_FILE = path.join("content", "pricing-calibration.json");
const REPORT = path.join("data", "atlas", "Atlas_Pricing_Calibration.xlsx");
const write = process.argv.includes("--write");
const apply = process.argv.includes("--apply");

/**
 * How far above the published price is acceptable. Slightly higher is expected
 * — the published figure is a loss-leading "from" price — but a large overshoot
 * means the traveller sees a number that does not match the advertised one.
 */
const TOLERANCE = { underPct: 0, warnOverPct: 25, failOverPct: 60 };

const core = CoreBundle.parse(JSON.parse(readFileSync(path.join(DATA, "core.json"), "utf8")));
const routes = (JSON.parse(readFileSync(path.join(DATA, "routes.json"), "utf8")) as { routes: Route[] }).routes;
const visaRules = (JSON.parse(readFileSync(path.join(DATA, "visa.json"), "utf8")) as { rules: VisaRule[] }).rules;

/**
 * "From" prices are quoted per person on a shared basis. In India the biggest
 * cost is a chauffeured vehicle charged per day, so what one person pays falls
 * as the party fills the vehicle (Sedan to 3, SUV to 6). The brochure number is
 * the cheapest legitimate setup, so the harness tries each party size.
 */
const PARTY_SIZES = (process.env.INDIA_PAX ?? "2").split(",").map(Number); // India only: "from" prices fit a couple in a Sedan best (median -6% vs -26% at 4, -41% at 10); group prices are lower per head, e.g. Gujarat 13 nights is 40,000 at 10 people. Elsewhere a person's share does not depend on party size

const DEPARTURE_CITIES = ["DEL", "BOM", "MAA", "BLR", "HYD", "CCU", "COK", "AMD", "PNQ", "GOI"];

const bundleCache = new Map<string, DestinationBundle | null>();
function loadBundles(placeIds: string[]): Map<string, DestinationBundle> {
  const map = new Map<string, DestinationBundle>();
  for (const id of placeIds) {
    const place = core.places.find((p) => p.id === id);
    if (!place) continue;
    if (!bundleCache.has(id)) {
      try {
        bundleCache.set(id, JSON.parse(readFileSync(path.join(DATA, "destinations", `${place.slug}.json`), "utf8")));
      } catch {
        bundleCache.set(id, null);
      }
    }
    const bundle = bundleCache.get(id);
    if (bundle) map.set(id, bundle);
  }
  return map;
}

/** The month a destination is cheapest, from its own monthly price index. */
function cheapestMonth(placeId: string): number {
  const summary = core.placeSummaries.find((s) => s.placeId === placeId);
  const months = Object.entries(summary?.monthPrice ?? {});
  if (!months.length) return 6;
  return Number(months.sort((a, b) => a[1] - b[1])[0][0]);
}

/** The published price is a minimum, so quote the cheapest legitimate setup. */
type Basis = { pax: [number, number]; mealPlan?: "breakfast" | "half-board" | "full-board" };
const BASIS = ((quotePolicy as unknown as { packageBasis?: Record<string, Basis> }).packageBasis ?? {});

function minimumRequest(pkg: Package, departureCity: string, adults: number): QuoteRequest {
  const month = cheapestMonth(pkg.placeIds[0]);
  const year = new Date().getUTCFullYear() + 1;
  const style: TripStyle = /pilgrim|kailash|amarnath|char dham/i.test(pkg.name) ? "pilgrimage" : "culture";

  return QuoteRequest.parse({
    placeIds: pkg.placeIds,
    nights: pkg.nights || Math.max(1, pkg.placeIds.length),
    startDate: `${year}-${String(month).padStart(2, "0")}-15`,
    adults,
    childAges: [],
    travellerType: adults === 2 ? "couple" : "friends",
    tripStyle: style,
    nationality: "IND",
    departureCity,
    hotelStar: "3 Star",
    hotelZone: "Outskirts",
    carrier: "LCC",
    cabin: "Economy",
    mealPlan: BASIS[pkg.id]?.mealPlan ?? "breakfast",
    food: "no-preference",
    pace: "balanced",
    includeVisa: true,
    includeInsurance: false,
    // The published "from" price is land-only, so the quote it is measured
    // against must be too — see `pkg.priceIncludesFlight`.
    includeFlight: pkg.priceIncludesFlight,
  });
}

type Row = {
  pkg: Package;
  quote: Quotation;
  departureCity: string;
  adults: number;
  published: number;
  generated: number;
  deltaPct: number;
  verdict: "UNDER" | "OK" | "HIGH" | "TOO HIGH";
  componentPerPerson: Partial<Record<CostComponent, number>>;
};

function evaluate(pkg: Package): Row | null {
  let best: { quote: Quotation; city: string; adults: number } | null = null;

  // A package whose price basis the agency has stated is compared at that group
  // size (any size in a stated range), otherwise India is tried as a couple and
  // every other region as 2, since a person's share there does not depend on it.
  const basis = BASIS[pkg.id];
  const sizes = basis
    ? Array.from({ length: basis.pax[1] - basis.pax[0] + 1 }, (_, i) => basis.pax[0] + i)
    : pkg.regionId === "india" ? PARTY_SIZES : [2];
  const miss = (q: Quotation) => Math.abs(q.totals.perPerson - pkg.priceFromInr);

  for (const city of DEPARTURE_CITIES) {
   for (const adults of sizes) {
    const request = minimumRequest(pkg, city, adults);
    let quote: Quotation;
    try {
      quote = generateQuotation(request, {
        core, routes, visaRules,
        bundles: loadBundles(request.placeIds),
        ignorePackageFloor: true,
      });
    } catch {
      continue;
    }
    // Stated basis: the size that best reproduces the price. Otherwise the
    // brochure number is a minimum, so keep the cheapest legitimate setup.
    const better = !best || (basis ? miss(quote) < miss(best.quote) : quote.totals.perPerson < best.quote.totals.perPerson);
    if (better) best = { quote, city, adults };
   }
  }
  if (!best) return null;

  const published = pkg.priceFromInr;
  const generated = best.quote.totals.perPerson;
  const deltaPct = published > 0 ? ((generated - published) / published) * 100 : 0;

  const componentPerPerson: Partial<Record<CostComponent, number>> = {};
  for (const item of best.quote.lineItems) {
    componentPerPerson[item.component] =
      (componentPerPerson[item.component] ?? 0) + item.totalInr / best.quote.pax.total;
  }

  const verdict: Row["verdict"] =
    deltaPct < TOLERANCE.underPct
      ? "UNDER"
      : deltaPct > TOLERANCE.failOverPct
        ? "TOO HIGH"
        : deltaPct > TOLERANCE.warnOverPct
          ? "HIGH"
          : "OK";

  return {
    pkg, quote: best.quote, departureCity: best.city, adults: best.adults,
    published, generated, deltaPct, verdict, componentPerPerson,
  };
}

// ---------------------------------------------------------------------------
// Feedback loop
// ---------------------------------------------------------------------------

/**
 * Fits a per-region correction factor from the observed deltas.
 *
 * Only the components the agency can plausibly have mispriced are scaled —
 * visa, insurance and city tax are pass-through costs, so distorting them to
 * hit a headline number would just hide the error somewhere worse.
 */
type FactorTable = Record<string, Partial<Record<CostComponent, number>>>;

const SCALABLE: CostComponent[] = [
  "hotel", "flight", "local-transport", "intercity-transport", "sightseeing", "meals",
];

/**
 * Land components the brochure price covers and the rate card can misstate.
 * Visa, insurance and city tax are pass-through; flights are not in a land
 * "from" price; the India vehicle is the agency's own flat day rate.
 */
const FIT_COMPONENTS: CostComponent[] = [
  "hotel", "airport-transfer", "local-transport", "intercity-transport", "sightseeing", "meals",
];

/** Scopes the agency has checked line by line; the published-price fit must not move them. */
const VALIDATED_COUNTRIES = new Set(["south-east-asia-vietnam"]);
const VALIDATED_REGIONS = new Set(["india"]);

/**
 * A rate card is not wrong by more than this. A factor outside the band means
 * the brochure sells something the engine does not model (a better hotel class,
 * guides, permits), and stretching every rate to reach it would misprice the
 * trips travellers build themselves. The package floor still covers the package.
 */
const FACTOR_BAND = { min: 0.4, max: 2.5 };
const bounded = (n: number) => Number(Math.max(FACTOR_BAND.min, Math.min(FACTOR_BAND.max, n)).toFixed(3));

/** A published price this far from the bottom-up quote is a data error, not a signal. */
const OUTLIER_RATIO = { low: 0.25, high: 4 };

type Fit = { country: Record<string, number>; region: Record<string, number>; outliers: string[] };

/**
 * Fits one correction per country from the agency's own published prices.
 *
 * For each package the factor f that lands its 3 Star couple quote on 1.05x the
 * brochure price is solved exactly (the non-scalable part is held fixed), then
 * each country takes the median over the packages that touch it, and each region
 * the median over its countries for places no package covers. Multiplying onto
 * the factor already in force keeps hand-set figures (the Southeast Asia hotel
 * level) instead of overwriting them.
 */
function fitFactors(rows: Row[]): Fit {
  const outliers: string[] = [];
  const byCountry = new Map<string, number[]>();
  const byRegion = new Map<string, number[]>();

  for (const row of rows) {
    if (VALIDATED_REGIONS.has(row.pkg.regionId)) continue;
    if (row.pkg.countryIds.every((c) => VALIDATED_COUNTRIES.has(c))) continue;
    const ratio = row.generated / row.published;
    if (!(row.published > 0) || ratio < OUTLIER_RATIO.low || ratio > OUTLIER_RATIO.high) {
      outliers.push(`${row.pkg.name}: published ${inr(row.published)} vs quote ${inr(row.generated)}`);
      continue;
    }
    const scalable = FIT_COMPONENTS.reduce((a, c) => a + (row.componentPerPerson[c] ?? 0), 0);
    if (scalable <= 0) continue;
    const fixed = row.generated - scalable;
    const f = Math.max(0.3, Math.min(2.5, (1.05 * row.published - fixed) / scalable));

    for (const country of row.pkg.countryIds) {
      if (VALIDATED_COUNTRIES.has(country)) continue;
      // A circuit that crosses borders (Kailash: Nepal then Tibet) says little
      // about any one country; the country's own package outranks it.
      const own = core.packages.some((p) => p.id !== row.pkg.id && p.countryIds.length === 1 && p.countryIds[0] === country);
      if (own && row.pkg.countryIds.length > 1) continue;
      byCountry.set(country, [...(byCountry.get(country) ?? []), f]);
    }
    byRegion.set(row.pkg.regionId, [...(byRegion.get(row.pkg.regionId) ?? []), f]);
  }

  const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const country: Record<string, number> = {};
  const region: Record<string, number> = {};
  for (const [id, v] of byCountry) country[id] = Number(median(v).toFixed(3));
  for (const [id, v] of byRegion) region[id] = Number(median(v).toFixed(3));
  return { country, region, outliers };
}

// ---------------------------------------------------------------------------
// Applying the agency's own corrections
// ---------------------------------------------------------------------------

/**
 * Reads the "Your Corrections" sheet back out of the workbook and turns each
 * filled-in row into a calibration factor.
 *
 * The agency states the price a package *should* be; the factor needed to reach
 * it is derived from what the engine currently produces, and applied to the
 * scalable components only. Stating a target price is far easier than guessing
 * a multiplier, which is why the sheet asks for the former.
 */
function applyCorrections(rows: Row[]): {
  packageFactors: Record<string, Partial<Record<CostComponent, number>>>;
  applied: { name: string; target: number; factor: number }[];
  skipped: string[];
} {
  const packageFactors: Record<string, Partial<Record<CostComponent, number>>> = {};
  const applied: { name: string; target: number; factor: number }[] = [];
  const skipped: string[] = [];

  let sheet;
  try {
    sheet = Workbook.open(REPORT).sheet("Your Corrections");
  } catch {
    return { packageFactors, applied, skipped: ["No calibration workbook found — run `npm run calibrate` first."] };
  }

  // Whatever factor is already in force for a region, so a package correction
  // can carry it forward rather than replacing it.
  const current = JSON.parse(readFileSync(CALIBRATION_FILE, "utf8")) as {
    region?: FactorTable;
    global?: Partial<Record<CostComponent, number>>;
  };
  const currentFactor = (regionId: string, component: CostComponent) =>
    current.region?.[regionId]?.[component] ?? current.global?.[component] ?? 1;

  const byId = new Map(rows.map((r) => [r.pkg.id, r]));

  for (const row of sheet.slice(1)) {
    const packageId = cell(row, 1);
    if (!packageId) continue;

    const target = num(row, 4); // "Correct price pp (fill in)"
    const explicitFactor = num(row, 6); // "Your factor"
    const component = cell(row, 5).trim() as CostComponent | "";

    const current = byId.get(packageId);
    if (!current) {
      skipped.push(`${packageId} — no longer in the catalogue`);
      continue;
    }

    let factor: number | null = null;
    if (explicitFactor && explicitFactor > 0) {
      factor = explicitFactor;
    } else if (target && target > 0 && current.generated > 0) {
      // Only the scalable components can move, so they must absorb the whole
      // correction and therefore shift by more than the headline difference.
      const totalPp = Object.values(current.componentPerPerson).reduce((a, b) => a + b, 0);
      const scalablePp = SCALABLE.reduce((a, c) => a + (current.componentPerPerson[c] ?? 0), 0);
      if (scalablePp <= 0) {
        skipped.push(`${current.pkg.name} — nothing scalable to adjust`);
        continue;
      }
      const ratio = target / current.generated;
      const share = scalablePp / Math.max(1, totalPp);
      const correction = 1 + (ratio - 1) / share;

      // The observed price already includes whatever region factor is in force.
      // Because scopes do not compound, a package factor replaces it outright —
      // so it has to carry that region factor forward, or the correction would
      // silently undo it.
      const inForce = currentFactor(current.pkg.regionId, component || "hotel");
      factor = inForce * correction;
    }

    if (factor == null) continue;
    const clamped = Number(Math.max(0.2, Math.min(4, factor)).toFixed(4));

    packageFactors[packageId] = component
      ? { [component]: clamped }
      : (Object.fromEntries(SCALABLE.map((c) => [c, clamped])) as Partial<Record<CostComponent, number>>);

    applied.push({ name: current.pkg.name, target: target ?? 0, factor: clamped });
  }

  return { packageFactors, applied, skipped };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// A package with no fixed length ("Flexible", 0 nights: Great Uttarakhand
// Outdoors) has a price that covers no defined number of nights, so there is
// nothing to compare a quote against. Say so rather than guess a length.
const noFixedLength = core.packages.filter((p) => !p.nights);
const rows = core.packages
  .filter((p) => p.nights)
  .map(evaluate)
  .filter((r): r is Row => r !== null)
  .sort((a, b) => a.deltaPct - b.deltaPct);

const counts = { UNDER: 0, OK: 0, HIGH: 0, "TOO HIGH": 0 };
for (const r of rows) counts[r.verdict]++;

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

console.log(`\nPricing calibration — ${rows.length} of ${core.packages.length} packages priced\n`);
if (noFixedLength.length) console.log(`  not benchmarked (no fixed length): ${noFixedLength.map((p) => p.name).join(", ")}\n`);
console.log(`  UNDER published : ${String(counts.UNDER).padStart(3)}   (a real problem — we would undercut the brochure)`);
console.log(`  OK (0 to +${TOLERANCE.warnOverPct}%) : ${String(counts.OK).padStart(3)}`);
console.log(`  HIGH (to +${TOLERANCE.failOverPct}%)  : ${String(counts.HIGH).padStart(3)}`);
console.log(`  TOO HIGH        : ${String(counts["TOO HIGH"]).padStart(3)}   (traveller sees far more than advertised)`);

const deltas = rows.map((r) => r.deltaPct).sort((a, b) => a - b);
console.log(
  `\n  delta  min ${pct(deltas[0])}   median ${pct(deltas[deltas.length >> 1])}   max ${pct(deltas[deltas.length - 1])}`,
);

const detail = process.argv.find((a) => a.startsWith("--detail="))?.slice(9).toLowerCase();
if (detail) {
  for (const r of rows.filter((x) => x.pkg.name.toLowerCase().includes(detail))) {
    console.log(`\n  ${r.pkg.name}: ${r.pkg.nights}N, ${r.adults} adults, from ${r.departureCity}, per person`);
    for (const [c, v] of Object.entries(r.componentPerPerson).sort((a, b) => b[1] - a[1])) console.log(`    ${c.padEnd(20)} ${inr(v)}`);
  }
}

console.log("\n  " + "Package".padEnd(40) + "Published".padStart(11) + "Generated".padStart(11) + "Delta".padStart(9) + "  Verdict");
console.log("  " + "-".repeat(88));
for (const r of rows) {
  console.log(
    "  " + r.pkg.name.slice(0, 39).padEnd(40) +
      inr(r.published).padStart(11) +
      inr(r.generated).padStart(11) +
      pct(r.deltaPct).padStart(9) +
      "  " + r.verdict,
  );
}

// --- workbook -------------------------------------------------------------
const allComponents: CostComponent[] = [
  "hotel", "flight", "airport-transfer", "local-transport", "ground-transport", "intercity-transport",
  "sightseeing", "meals", "visa", "insurance", "city-tax",
];

const regionName = new Map(core.regions.map((r) => [r.id, r.name]));

const sheets: SheetSpec[] = [
  {
    name: "Summary",
    header: ["Metric", "Value", "Meaning"],
    rows: [
      ["Packages priced", rows.length, `of ${core.packages.length} in the catalogue`],
      ["UNDER published", counts.UNDER, "Generated below the brochure price — we would undercut ourselves"],
      ["OK", counts.OK, `Within 0 to +${TOLERANCE.warnOverPct}% of published — the intended outcome`],
      ["HIGH", counts.HIGH, `+${TOLERANCE.warnOverPct}% to +${TOLERANCE.failOverPct}%`],
      ["TOO HIGH", counts["TOO HIGH"], `Above +${TOLERANCE.failOverPct}% — traveller sees far more than advertised`],
      ["Median delta", `${deltas[deltas.length >> 1].toFixed(1)}%`, "Half the packages are closer than this"],
      ["Test configuration", "3 Star / Outskirts / LCC / Economy / breakfast / twin share", "The cheapest legitimate setup, matching a 'from' price"],
      ["Departure city", "cheapest of 10 Indian metros", "Published price says 'from any city in India'"],
      ["Month", "each destination's cheapest, by its own price index", "A 'from' price implies low season"],
      ["Package floor", "DISABLED", "Otherwise every package would trivially match itself"],
    ],
    widths: [24, 56, 72],
  },
  {
    name: "Per Package",
    header: [
      "Package", "Region", "Nights", "Places", "Published pp", "Generated pp", "Delta INR", "Delta %", "Verdict",
      "Cheapest from", ...allComponents.map((c) => `${c} pp`),
    ],
    rows: rows.map((r) => [
      r.pkg.name,
      regionName.get(r.pkg.regionId) ?? r.pkg.regionId,
      r.pkg.nights,
      r.pkg.placeIds.length,
      Math.round(r.published),
      Math.round(r.generated),
      Math.round(r.generated - r.published),
      Number(r.deltaPct.toFixed(1)),
      r.verdict,
      r.departureCity,
      ...allComponents.map((c) => Math.round(r.componentPerPerson[c] ?? 0)),
    ]),
    widths: [40, 20, 8, 8, 14, 14, 12, 10, 12, 14, ...allComponents.map(() => 14)],
  },
  {
    name: "By Region",
    header: ["Region", "Packages", "Median delta %", "Min %", "Max %", "Under", "Too high"],
    rows: [...new Set(rows.map((r) => r.pkg.regionId))].map((regionId) => {
      const group = rows.filter((r) => r.pkg.regionId === regionId);
      const d = group.map((r) => r.deltaPct).sort((a, b) => a - b);
      return [
        regionName.get(regionId) ?? regionId,
        group.length,
        Number(d[d.length >> 1].toFixed(1)),
        Number(d[0].toFixed(1)),
        Number(d[d.length - 1].toFixed(1)),
        group.filter((r) => r.verdict === "UNDER").length,
        group.filter((r) => r.verdict === "TOO HIGH").length,
      ];
    }),
    widths: [22, 12, 16, 12, 12, 10, 12],
  },
  {
    name: "Your Corrections",
    header: [
      "Scope", "Id", "Name", "What is wrong", "Correct price pp (fill in)", "Or component to fix", "Your factor",
    ],
    rows: rows
      .filter((r) => r.verdict !== "OK")
      .map((r) => [
        "package", r.pkg.id, r.pkg.name,
        r.verdict === "UNDER" ? "Generated below the published price" : `Generated ${pct(r.deltaPct)} above published`,
        null, "", null,
      ]),
    widths: [12, 34, 40, 40, 26, 26, 14],
  },
];

// Regenerating the workbook would wipe any corrections the agency has typed
// into it, so in --apply mode the existing file is read, never rewritten.
if (!apply) {
  writeWorkbook(REPORT, sheets);
  console.log(`\n  report  ${REPORT}`);
} else {
  console.log(`\n  reading corrections from ${REPORT}`);
}

// --- feedback loop --------------------------------------------------------
if (apply) {
  const { packageFactors, applied, skipped } = applyCorrections(rows);
  if (applied.length) {
    const existing = JSON.parse(readFileSync(CALIBRATION_FILE, "utf8"));
    existing.package = { ...existing.package, ...packageFactors };
    existing._appliedAt = new Date().toISOString();
    writeFileSync(CALIBRATION_FILE, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`\n  Applied ${applied.length} correction(s) from the workbook:`);
    for (const a of applied) {
      console.log(
        `    ${a.name.slice(0, 40).padEnd(42)} target ${a.target ? inr(a.target) + " pp" : "(factor given)"}  ->  x${a.factor}`,
      );
    }
    console.log(`\n  Written to ${CALIBRATION_FILE}. Re-run \`npm run calibrate\` to verify.`);
  } else {
    console.log("\n  No corrections found in the workbook's 'Your Corrections' sheet.");
    console.log("  Fill in either 'Correct price pp' or 'Your factor', save, then re-run with --apply.");
  }
  for (const s of skipped) console.log(`    skipped: ${s}`);
} else if (write) {
  const fit = fitFactors(rows);
  const existing = JSON.parse(readFileSync(CALIBRATION_FILE, "utf8"));
  const regionOf = (countryId: string) => core.regions.find((r) => countryId.startsWith(`${r.id}-`))?.id ?? "";
  const inForce = (component: CostComponent, countryId: string) =>
    existing.country?.[countryId]?.[component] ?? existing.region?.[regionOf(countryId)]?.[component] ?? existing.global?.[component] ?? 1;

  for (const [countryId, rel] of Object.entries(fit.country)) {
    if (Math.abs(rel - 1) < 0.05) continue;
    const next: Record<string, number> = { ...(existing.country?.[countryId] ?? {}) };
    for (const c of FIT_COMPONENTS) next[c] = bounded(inForce(c, countryId) * rel);
    existing.country = { ...existing.country, [countryId]: next };
  }
  // Countries with no package of their own inherit the region's typical correction.
  for (const [regionId, rel] of Object.entries(fit.region)) {
    if (Math.abs(rel - 1) < 0.05) continue;
    const next: Record<string, number> = { ...(existing.region?.[regionId] ?? {}) };
    for (const c of FIT_COMPONENTS) next[c] = bounded((existing.region?.[regionId]?.[c] ?? existing.global?.[c] ?? 1) * rel);
    existing.region = { ...existing.region, [regionId]: next };
  }
  existing._fittedAt = new Date().toISOString();
  writeFileSync(CALIBRATION_FILE, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`  fitted  ${Object.keys(fit.country).length} country and ${Object.keys(fit.region).length} region factor(s) -> ${CALIBRATION_FILE}`);
  for (const o of fit.outliers) console.log(`  ignored as a data error: ${o}`);
  console.log("          re-run `npm run calibrate` to see the effect.");
} else if (counts.UNDER || counts["TOO HIGH"]) {
  console.log("\n  Next steps:");
  console.log("    npm run calibrate -- --write   fit region factors automatically");
  console.log("    npm run calibrate -- --apply   apply your own numbers from the 'Your Corrections' sheet");
}
