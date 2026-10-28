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
 * Imports are type-only (plus the policy JSON) so this bundles into the Worker.
 */
import policy from "../content/quote-policy.json";
import type { Quotation } from "./atlas/engine/types";

export const COMPONENT_LABEL: Record<string, string> = {
  hotel: "Accommodation",
  flight: "Flights",
  "airport-transfer": "Airport transfers",
  "local-transport": "Sightseeing transport",
  "intercity-transport": "Intercity transport",
  sightseeing: "Sightseeing & entrances",
  meals: "Meals",
  visa: "Visa support",
  insurance: "Travel insurance",
  "city-tax": "City & tourism tax",
};

/** Same fixed shares the planner uses to fold contingency + margin into categories. */
const MARKUP_ALLOCATION = policy.markup.contingencyMarginAllocation as Record<string, number>;

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
 * folded into the categories at the policy's fixed shares and never shown on
 * their own; the remainder (GST and fees) is its own row. Rows always sum to
 * `packageInr`, scaled proportionally when the package price has been pinned.
 */
export function componentBreakdown(quotation: Quotation, packageInr: number): BreakdownRow[] {
  const engineTotal = quotation.totals.total;
  const hidden = quotation.totals.contingency + quotation.totals.agentMarkup;

  const base = new Map<string, number>();
  for (const item of quotation.lineItems) {
    base.set(item.component, (base.get(item.component) ?? 0) + item.totalInr);
  }

  const share = new Map<string, number>();
  const weightSum = Object.entries(MARKUP_ALLOCATION).reduce((s, [c, w]) => s + (base.get(c) ? w : 0), 0);
  const baseSum = [...base.values()].reduce((a, b) => a + b, 0);
  for (const component of base.keys()) {
    const weight = weightSum > 0 ? (base.get(component) ? (MARKUP_ALLOCATION[component] ?? 0) / weightSum : 0) : base.get(component)! / (baseSum || 1);
    share.set(component, hidden * weight);
  }

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
