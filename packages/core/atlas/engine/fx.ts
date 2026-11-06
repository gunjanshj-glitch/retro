/**
 * Live exchange rates for the compiled rate card.
 *
 * Most workbook rates are quoted in USD or EUR and were converted to rupees
 * once, when the card was built. The rupee moves, so a card built months ago
 * quietly drifts from what the agency pays today. This rescales those rows by
 * how far the live rate has moved since the card was built.
 *
 * Only rows that carry their original currency are touched; rates estimated in
 * rupees have no currency to follow. A live figure is used only when it is
 * fresh and plausible, the same rule the hotel and flight feeds follow, and
 * small movements are ignored so a quote does not shift by a rupee-level
 * wobble between two page loads.
 */
import type { ActivityRate, CoreBundle, DestinationBundle, HotelRate, MealRate, TransferRate } from "../schema";

export type FxRates = {
  /** Rupees per one unit of each currency, e.g. `{ USD: 94.48 }`. */
  rates: Record<string, number>;
  fetchedAt: string;
};

export type FxAdjustment = {
  currency: string;
  /** Rupees per unit today. */
  liveInrPerUnit: number;
  /** Rupees per unit the rate card was built at. */
  cardInrPerUnit: number;
  /** Multiplier applied to every rate quoted in this currency. */
  factor: number;
  rowsAffected: number;
};

/** Below this the move is noise and the card is left alone. */
const MIN_MOVE = 0.005;
/** Beyond this the feed is more likely wrong than the rupee, so it is ignored. */
const MAX_MOVE = 0.2;
const MAX_AGE_HOURS = 72;

type Rated = { inr: number; baseline: number | null; baselineCurrency: string | null };

/**
 * The rate the card was built at for a currency: the median conversion across
 * its rows. Rupee values in the workbook are rounded, so single rows wobble
 * around the true rate; the median is not thrown by them or by the odd row
 * that was converted at some other rate.
 */
function cardRate(rows: Rated[], currency: string): number | null {
  const ratios: number[] = [];
  for (const r of rows) {
    if (r.baselineCurrency !== currency || !r.baseline || r.baseline <= 0 || r.inr <= 0) continue;
    ratios.push(r.inr / r.baseline);
  }
  if (!ratios.length) return null;
  ratios.sort((x, y) => x - y);
  return ratios[ratios.length >> 1];
}

/** Which currencies move, and by how much. Pure, so the result can be shown to the admin. */
export function fxAdjustments(core: CoreBundle, fx: FxRates | undefined, now = Date.now()): FxAdjustment[] {
  if (!fx) return [];
  const age = (now - Date.parse(fx.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(age) || age > MAX_AGE_HOURS) return [];

  const rows: Rated[] = [...core.hotelRates, ...core.transferRates, ...core.mealRates];
  const out: FxAdjustment[] = [];
  for (const [currency, live] of Object.entries(fx.rates)) {
    if (!Number.isFinite(live) || live <= 0) continue;
    const card = cardRate(rows, currency);
    if (!card) continue;
    const factor = live / card;
    if (Math.abs(factor - 1) < MIN_MOVE || Math.abs(factor - 1) > MAX_MOVE) continue;
    const rowsAffected = rows.filter((r) => r.baselineCurrency === currency && r.baseline && r.baseline > 0).length;
    out.push({ currency, liveInrPerUnit: live, cardInrPerUnit: card, factor, rowsAffected });
  }
  return out;
}

const cache = new WeakMap<CoreBundle, Map<string, { core: CoreBundle; applied: FxAdjustment[] }>>();
const bundleCache = new WeakMap<DestinationBundle, Map<string, DestinationBundle>>();

function scale<T extends Rated>(rows: T[], factors: Map<string, number>): T[] {
  return rows.map((r) => {
    const f = r.baselineCurrency ? factors.get(r.baselineCurrency) : undefined;
    return f && r.baseline && r.baseline > 0 ? { ...r, inr: r.inr * f } : r;
  });
}

/**
 * The card and destination bundles repriced at today's exchange rates. With no
 * usable feed, or no currency having moved, the originals come back untouched
 * (same object), so callers can compare by identity.
 */
export function applyLiveFx(
  core: CoreBundle,
  bundles: Map<string, DestinationBundle>,
  fx: FxRates | undefined,
): { core: CoreBundle; bundles: Map<string, DestinationBundle>; applied: FxAdjustment[] } {
  const applied = fxAdjustments(core, fx);
  if (!applied.length) return { core, bundles, applied };

  const signature = applied.map((a) => `${a.currency}:${a.factor.toFixed(5)}`).join("|");
  const factors = new Map(applied.map((a) => [a.currency, a.factor]));

  let perCore = cache.get(core);
  if (!perCore) cache.set(core, (perCore = new Map()));
  let scaledCore = perCore.get(signature)?.core;
  if (!scaledCore) {
    scaledCore = {
      ...core,
      hotelRates: scale<HotelRate>(core.hotelRates, factors),
      transferRates: scale<TransferRate>(core.transferRates, factors),
      mealRates: scale<MealRate>(core.mealRates, factors),
    };
    perCore.set(signature, { core: scaledCore, applied });
  }

  const scaledBundles = new Map<string, DestinationBundle>();
  for (const [id, bundle] of bundles) {
    let perBundle = bundleCache.get(bundle);
    if (!perBundle) bundleCache.set(bundle, (perBundle = new Map()));
    let scaled = perBundle.get(signature);
    if (!scaled) {
      scaled = { ...bundle, activityRates: scale<ActivityRate>(bundle.activityRates, factors) };
      perBundle.set(signature, scaled);
    }
    scaledBundles.set(id, scaled);
  }
  return { core: scaledCore, bundles: scaledBundles, applied };
}
