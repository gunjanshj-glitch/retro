/**
 * Commercial layer on top of the quotation engine.
 *
 * The engine prices a trip from a `QuoteRequest`. A person at the agency then
 * finalises it: they may change the trip itself (which re-runs the engine),
 * and they may also adjust the *commercials* — pin a negotiated package price,
 * add charges or discounts, and offer optional extras. That second layer is
 * what lives here, as plain data, so the same arithmetic runs in the admin
 * editor (live preview), the Worker (what is stored, accepted and charged)
 * and the traveller's page.
 *
 * The Worker never trusts a total sent by a browser: it recomputes from the
 * stored revision with `priceQuote`.
 *
 * Imports are type-only so this bundles into the Worker.
 */
import type { Quotation } from "./atlas/engine/types";

export const COMPONENT_LABEL: Record<string, string> = {
  hotel: "Accommodation",
  flight: "Flights",
  "airport-transfer": "Airport transfers",
  "local-transport": "Sightseeing transport",
  "ground-transport": "Transport (vehicle with driver)",
  "intercity-transport": "Intercity transport",
  sightseeing: "Sightseeing & entrances",
  meals: "Meals",
  visa: "Visa support",
  insurance: "Travel insurance",
  "city-tax": "City & tourism tax",
};

/**
 * Shares out the hidden contingency + agent margin across categories in
 * proportion to each category's own cost, so no single row carries a
 * disproportionate loading (a fixed split once piled ~55% of it onto
 * Sightseeing transport, making that row look twice its real cost).
 */
export function allocateMarkup(base: ReadonlyMap<string, number>, hidden: number): Map<string, number> {
  const total = [...base.values()].reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const [component, amount] of base) {
    if (amount > 0) out.set(component, hidden * (amount / total));
  }
  return out;
}

/**
 * Contingency + margin per category: what the traveller's price carries on top
 * of each category's cost. With a hand-set margin it is each category's own
 * contingency plus its own margin; otherwise it is shared pro rata to cost.
 */
export function hiddenByComponent(quotation: Quotation): Map<string, number> {
  const t = quotation.totals;
  const base = new Map<string, number>();
  for (const item of quotation.lineItems) base.set(item.component, (base.get(item.component) ?? 0) + item.totalInr);
  if (!t.marginByComponent) return allocateMarkup(base, t.contingency + t.agentMarkup);
  const contRate = t.directCost > 0 ? t.contingency / t.directCost : 0;
  const out = new Map<string, number>();
  for (const [component, amount] of base) {
    if (amount > 0) out.set(component, amount * contRate + (t.marginByComponent[component] ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export type CustomLine = {
  id: string;
  label: string;
  /** Rupees. Positive is a charge, negative a discount. */
  amountInr: number;
  /** An extra the traveller may tick when accepting; never negative. */
  optional: boolean;
};

export type QuoteAdjustments = {
  /** Replaces the engine's total as the package price (a negotiated figure). */
  fixedPackageInr: number | null;
  lines: CustomLine[];
  /**
   * Amount due now to confirm the booking, when the agency takes a deposit.
   * Null means the full amount is payable up front.
   */
  depositInr: number | null;
};

export function emptyAdjustments(): QuoteAdjustments {
  return { fixedPackageInr: null, lines: [], depositInr: null };
}

const MAX_LINES = 25;
const MAX_AMOUNT = 50_000_000;
const ID_RE = /^[A-Za-z0-9-]{1,40}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parses untrusted adjustments (from a request body or stored JSON). */
export function parseAdjustments(input: unknown): Validated<QuoteAdjustments> {
  if (input == null) return { ok: true, value: emptyAdjustments() };
  if (!isRecord(input)) return { ok: false, error: "Pricing adjustments are malformed." };

  let fixed: number | null = null;
  if (input.fixedPackageInr != null) {
    const n = input.fixedPackageInr;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 1_000_000_000) {
      return { ok: false, error: "The package price must be a positive amount in rupees." };
    }
    fixed = Math.round(n);
  }

  let deposit: number | null = null;
  if (input.depositInr != null) {
    const n = input.depositInr;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 1_000_000_000) {
      return { ok: false, error: "The deposit must be a positive amount in rupees." };
    }
    deposit = Math.round(n);
  }

  const rawLines = input.lines ?? [];
  if (!Array.isArray(rawLines) || rawLines.length > MAX_LINES) {
    return { ok: false, error: `Use at most ${MAX_LINES} extra price lines.` };
  }
  const seen = new Set<string>();
  const lines: CustomLine[] = [];
  for (const raw of rawLines) {
    if (!isRecord(raw)) return { ok: false, error: "A price line is malformed." };
    const id = typeof raw.id === "string" ? raw.id : "";
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 120) : "";
    const amount = raw.amountInr;
    const optional = raw.optional === true;
    if (!ID_RE.test(id) || seen.has(id)) return { ok: false, error: "A price line has an invalid id." };
    if (!label) return { ok: false, error: "Every extra price line needs a description." };
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_AMOUNT) {
      return { ok: false, error: `Enter a non-zero rupee amount for “${label}”.` };
    }
    if (optional && amount < 0) return { ok: false, error: `“${label}” is an optional extra, so it cannot be a discount.` };
    seen.add(id);
    lines.push({ id, label, amountInr: Math.round(amount), optional });
  }

  return { ok: true, value: { fixedPackageInr: fixed, lines, depositInr: deposit } };
}

export type PricedQuote = {
  /** The package price before extra lines (engine total, or the pinned figure). */
  packageInr: number;
  /** Sum of the non-optional extra lines (charges minus discounts). */
  adjustmentsInr: number;
  /** Sum of the optional extras that were selected. */
  optionalsInr: number;
  /** Everything the traveller owes for the chosen options. */
  totalInr: number;
  /** What is due now: the deposit when one is set and smaller than the total, otherwise the total. */
  dueNowInr: number;
};

/**
 * Prices a quote for a given selection of optional extras. Unknown ids in
 * `selectedOptionalIds` are ignored, so a stale selection can never add
 * money that is not on the quote.
 */
export function priceQuote(engineTotalInr: number, adj: QuoteAdjustments, selectedOptionalIds: readonly string[] = []): PricedQuote {
  const selected = new Set(selectedOptionalIds);
  const packageInr = Math.round(adj.fixedPackageInr ?? engineTotalInr);
  let adjustmentsInr = 0;
  let optionalsInr = 0;
  for (const line of adj.lines) {
    if (!line.optional) adjustmentsInr += line.amountInr;
    else if (selected.has(line.id)) optionalsInr += line.amountInr;
  }
  const totalInr = Math.max(0, packageInr + adjustmentsInr + optionalsInr);
  const dueNowInr = adj.depositInr != null && adj.depositInr < totalInr ? adj.depositInr : totalInr;
  return { packageInr, adjustmentsInr, optionalsInr, totalInr, dueNowInr };
}

/**
 * What the next payment should be: the deposit on the first payment when one
 * is set, otherwise everything still owing. Zero once fully paid.
 */
export function nextPaymentInr(totalInr: number, paidInr: number, depositInr: number | null): number {
  const due = Math.max(0, Math.round(totalInr - paidInr));
  if (due <= 0) return 0;
  if (paidInr <= 0 && depositInr != null && depositInr < due) return depositInr;
  return due;
}

// ---------------------------------------------------------------------------
// Traveller-facing view
// ---------------------------------------------------------------------------

export type BreakdownRow = { key: string; label: string; amountInr: number };

/**
 * The category breakdown a traveller sees. Contingency and agency margin are
 * folded into the categories pro rata to their cost and never shown on
 * their own; the remainder (GST and fees) is its own row. Rows always sum to
 * `packageInr`, scaled proportionally when the package price has been pinned.
 */
export function componentBreakdown(quotation: Quotation, packageInr: number): BreakdownRow[] {
  const engineTotal = quotation.totals.total;

  const base = new Map<string, number>();
  for (const item of quotation.lineItems) {
    base.set(item.component, (base.get(item.component) ?? 0) + item.totalInr);
  }

  const share = hiddenByComponent(quotation);

  const raw = [...base.entries()]
    .map(([component, amount]) => ({ component, amount: amount + (share.get(component) ?? 0) }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const factor = engineTotal > 0 ? packageInr / engineTotal : 1;
  const rows: BreakdownRow[] = raw.map((r) => ({
    key: r.component,
    label: COMPONENT_LABEL[r.component] ?? r.component,
    amountInr: Math.round(r.amount * factor),
  }));

  let remainder = packageInr - rows.reduce((s, r) => s + r.amountInr, 0);
  if (remainder < 0 && rows.length) {
    // Rounding or an unusually low pinned price: take it off the largest row
    // rather than show a negative tax line.
    rows[0] = { ...rows[0], amountInr: rows[0].amountInr + remainder };
    remainder = 0;
  }
  if (remainder > 0) rows.push({ key: "taxes", label: "Taxes & fees", amountInr: remainder });
  return rows;
}

// ---------------------------------------------------------------------------
// Agency view: what it costs, what the agency keeps
// ---------------------------------------------------------------------------

export type CategoryMargin = {
  key: string;
  label: string;
  /** What suppliers charge for this category (every ticked line). */
  costInr: number;
  /** The agency's share folded into this category's price (contingency + margin). */
  cutInr: number;
  /** The margin part of the cut, as a share of this category's cost. Null with no cost. */
  marginPct: number | null;
  /** What the traveller's page shows for this category. */
  sellInr: number;
};

export type MarginSummary = {
  /** Actual cost: every ticked line at its (possibly hand-edited) rate. */
  costInr: number;
  /** The 3% buffer for cost movement before booking. Part of the agency's cut. */
  contingencyInr: number;
  /** The agency's margin. Absorbs a pinned price, so the parts always add up. */
  marginInr: number;
  /** GST and fees: collected for the taxman, not the agency's. */
  taxInr: number;
  /** Engine price, or the pinned figure, before extra lines. */
  packageInr: number;
  /** Extra charges less discounts the admin added in Pricing & terms. */
  extrasInr: number;
  /** What the traveller pays (without optional extras they may tick). */
  totalInr: number;
  /** Total less cost less tax: contingency + margin + extras. Negative means a loss. */
  cutInr: number;
  /** The cut as a share of cost, or null when there is no cost. */
  cutPct: number | null;
  /** How far a pinned package price moves the total from the engine's own. */
  pinnedByInr: number;
  /** Name of the published package the price was raised to, if it was. */
  flooredTo: string | null;
  /** Per category, in the same order the traveller sees them. */
  categories: CategoryMargin[];
};

/**
 * Splits a quote into what it costs and what the agency keeps. The traveller's
 * page folds the cut into each category's price; this is the same arithmetic
 * laid out openly, so the agency can see its real margin on every category.
 * Cost, contingency, margin and tax always add up to the package price.
 */
export function summariseMargin(quotation: Quotation, adj: QuoteAdjustments): MarginSummary {
  const t = quotation.totals;
  const priced = priceQuote(t.total, adj);
  const factor = t.total > 0 ? priced.packageInr / t.total : 1;

  const taxInr = Math.round((t.salesVat + t.paymentAndFx) * factor);
  const costInr = t.directCost;
  const contingencyInr = t.contingency;
  const marginInr = priced.packageInr - costInr - taxInr - contingencyInr;

  const cost = new Map<string, number>();
  for (const item of quotation.lineItems) cost.set(item.component, (cost.get(item.component) ?? 0) + item.totalInr);

  const contingencyRate = t.directCost > 0 ? t.contingency / t.directCost : 0;
  const categories: CategoryMargin[] = componentBreakdown(quotation, priced.packageInr)
    .filter((r) => r.key !== "taxes")
    .map((r) => {
      const costOfCategory = Math.round(cost.get(r.key) ?? 0);
      const cutOfCategory = r.amountInr - costOfCategory;
      return {
        key: r.key,
        label: r.label,
        costInr: costOfCategory,
        cutInr: cutOfCategory,
        marginPct: costOfCategory > 0 ? (cutOfCategory - costOfCategory * contingencyRate) / costOfCategory : null,
        sellInr: r.amountInr,
      };
    });

  const cutInr = priced.totalInr - costInr - taxInr;
  return {
    costInr,
    contingencyInr,
    marginInr,
    taxInr,
    packageInr: priced.packageInr,
    extrasInr: priced.adjustmentsInr,
    totalInr: priced.totalInr,
    cutInr,
    cutPct: costInr > 0 ? cutInr / costInr : null,
    pinnedByInr: priced.packageInr - t.total,
    flooredTo: t.flooredToPackage,
    categories,
  };
}

export type PublicDay = {
  dayNumber: number;
  date: string;
  placeName: string;
  isTransferDay: boolean;
  transfer: { from: string; to: string; mode: string; durationMinutes: number | null } | null;
  activities: { title: string; hours: number }[];
};

/**
 * What the traveller sees of a sent quote: itinerary and prices, with every
 * engine internal (margins, rate sources, rules, warnings) left out.
 */
export type PublicQuote = {
  title: string;
  startDate: string;
  nights: number;
  pax: { adults: number; children: number; infants: number; rooms: number };
  stays: { placeName: string; nights: number }[];
  days: PublicDay[];
  includes: {
    hotelStar: string;
    mealPlan: string;
    flights: boolean;
    visa: boolean;
    insurance: boolean;
    departureCity: string;
  };
  breakdown: BreakdownRow[];
  packageInr: number;
  lines: CustomLine[];
  depositInr: number | null;
  validUntil: string;
  note: string | null;
};

export function buildPublicQuote(
  quotation: Quotation,
  adj: QuoteAdjustments,
  meta: { validUntil: string; note: string | null },
): PublicQuote {
  const priced = priceQuote(quotation.totals.total, adj);
  const r = quotation.request;
  return {
    title: quotation.stays.map((s) => s.placeName).join(" · "),
    startDate: r.startDate,
    nights: quotation.stays.reduce((a, s) => a + s.nights, 0),
    pax: {
      adults: quotation.pax.adults,
      children: quotation.pax.children,
      infants: quotation.pax.infants,
      rooms: quotation.pax.rooms,
    },
    stays: quotation.stays.map((s) => ({ placeName: s.placeName, nights: s.nights })),
    days: quotation.days.map((d) => ({
      dayNumber: d.dayNumber,
      date: d.date,
      placeName: d.placeName,
      isTransferDay: d.isTransferDay,
      transfer: d.transfer
        ? { from: d.transfer.from, to: d.transfer.to, mode: String(d.transfer.mode), durationMinutes: d.transfer.durationMinutes }
        : null,
      activities: d.activities.map((a) => ({ title: a.title, hours: a.hours })),
    })),
    includes: {
      hotelStar: r.hotelStar,
      mealPlan: r.mealPlan,
      flights: r.includeFlight,
      visa: r.includeVisa,
      insurance: r.includeInsurance,
      departureCity: r.departureCity,
    },
    breakdown: componentBreakdown(quotation, priced.packageInr),
    packageInr: priced.packageInr,
    lines: adj.lines,
    depositInr: adj.depositInr,
    validUntil: meta.validUntil,
    note: meta.note,
  };
}
