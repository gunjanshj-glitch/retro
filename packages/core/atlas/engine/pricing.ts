/**
 * Stage 4: price the itinerary.
 *
 * Follows the workbook's own `Quotation_Calculation` structure: build the direct
 * cost from components, add contingency, apply agent markup, then tax and
 * payment fees. Every line records where its rate came from so a quote can be
 * audited back to the workbook, an estimate, or a live lookup.
 */
import policy from "../../../../content/quote-policy.json";
import calibration from "../../../../content/pricing-calibration.json";
import type {
  CityTax,
  CoreBundle,
  FlightBand,
  HotelRate,
  InsuranceRate,
  MealRate,
  PlaceSummary,
  RateSource,
  TransferRate,
  VisaRule,
} from "../schema";
import type {
  CostComponent,
  LineItem,
  PlaceStay,
  PlannedDay,
  QuoteRequest,
  QuoteTotals,
} from "./types";
import { formatDuration } from "./text";
import type { GatewayInfo } from "./gateway";

const OCC = policy.occupancy;
const VEH = policy.vehicles;
const SEASON = policy.seasonality;
const MARKUP = policy.markup;

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

type FactorTable = Record<string, Partial<Record<CostComponent, number>>>;

const CALIBRATION = calibration as unknown as {
  global: Partial<Record<CostComponent, number>>;
  region: FactorTable;
  country: FactorTable;
  package: FactorTable;
  place?: FactorTable;
};

export type CalibrationScope = {
  /** The one place a line belongs to; beats package, country and region. */
  placeId?: string | null;
  packageId?: string | null;
  countryId?: string | null;
  regionId?: string | null;
};

/**
 * Correction factor for a component.
 *
 * Lets the agency reconcile generated quotes with their published prices
 * without editing the rate card. A place beats a package, then country, region, global. The most specific scope wins outright — the
 * levels deliberately do not compound, so a package factor is the whole story
 * for that package and stays easy to reason about.
 */
export function calibrationFactor(component: CostComponent, scope: CalibrationScope): number {
  const tiers: (number | undefined)[] = [
    scope.placeId ? CALIBRATION.place?.[scope.placeId]?.[component] : undefined,
    scope.packageId ? CALIBRATION.package?.[scope.packageId]?.[component] : undefined,
    scope.countryId ? CALIBRATION.country?.[scope.countryId]?.[component] : undefined,
    scope.regionId ? CALIBRATION.region?.[scope.regionId]?.[component] : undefined,
    CALIBRATION.global?.[component],
  ];
  for (const value of tiers) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Head counts
// ---------------------------------------------------------------------------

export type PaxBreakdown = {
  adults: number;
  children: number;
  infants: number;
  total: number;
  rooms: number;
  extraBeds: number;
  /** Sum of per-head activity factors — children pay a reduced rate. */
  activityHeads: number;
  mealHeads: number;
};

function bandFor(age: number) {
  return OCC.childBands.find((b) => age <= b.maxAge) ?? OCC.childBands[OCC.childBands.length - 1];
}

/**
 * `requestedRooms` is the traveller's own choice (3 adults in one triple, a
 * family in a suite). It is honoured wherever it is physically possible and
 * otherwise adapted without complaint: never more rooms than there are adults
 * to occupy them, never fewer than the largest room on offer can sleep.
 */
export function resolvePax(adults: number, childAges: number[], requestedRooms?: number): PaxBreakdown {
  let infants = 0;
  let children = 0;
  let extraBeds = 0;
  let adultEquivalents = adults;
  let bedHeads = adults;
  let activityHeads = adults;
  let mealHeads = adults;

  for (const age of childAges) {
    const band = bandFor(age);
    activityHeads += band.activityFactor;
    mealHeads += band.mealFactor;
    if (band.roomPolicy === "sharing") infants++;
    else if (band.roomPolicy === "extraBed") {
      children++;
      extraBeds++;
      bedHeads++;
    } else {
      children++;
      adultEquivalents++;
      bedHeads++;
    }
  }

  const defaultRooms = Math.max(1, Math.ceil(adultEquivalents / OCC.adultsPerRoom));
  const minRooms = Math.max(1, Math.ceil(bedHeads / OCC.maxPerRoom));
  const maxRooms = Math.max(minRooms, adultEquivalents);
  const rooms =
    requestedRooms && Number.isFinite(requestedRooms)
      ? Math.min(maxRooms, Math.max(minRooms, Math.floor(requestedRooms)))
      : defaultRooms;

  return {
    adults,
    children,
    infants,
    total: adults + childAges.length,
    rooms,
    extraBeds,
    activityHeads,
    mealHeads,
  };
}

/** Transfers are billed per vehicle, so group size changes the unit cost. */
export function vehiclePlan(pax: number): { count: number; factor: number; label: string } {
  const cls = VEH.classes.find((c) => pax <= c.maxPax) ?? VEH.classes[VEH.classes.length - 1];
  const count = Math.max(1, Math.ceil(pax / cls.maxPax));
  return { count, factor: cls.rateFactor, label: cls.label };
}

/**
 * The agency's all-in daily vehicle, for trips that stay entirely in India.
 * Returns null for any other trip, which is priced leg by leg as before.
 */
const INDIA_GROUND = (policy as { groundTransport?: { india?: IndiaGround } }).groundTransport?.india;
type IndiaGround = {
  enabled: boolean;
  regionId: string;
  classes: { maxPax: number; label: string; dayRateInr: number }[];
  longLegs: { overDriveHours: number; dayMultiple: number }[];
  roadFirstMaxHours: number;
};

/**
 * True when every selected place is in the traveller's own country (an Indian
 * passport on an India trip). No visa applies there, so visa support is moot.
 */
export function isDomesticTrip(core: CoreBundle, placeIds: string[], nationality: string): boolean {
  if (!placeIds.length) return false;
  const countryOf = new Map(core.places.map((p) => [p.id, p.countryId]));
  const iso3Of = new Map(core.countries.map((c) => [c.id, c.iso3]));
  return placeIds.every((id) => iso3Of.get(countryOf.get(id) ?? "") === nationality);
}

export function indiaGroundApplies(core: CoreBundle, placeIds: string[]): boolean {
  if (!INDIA_GROUND?.enabled || !placeIds.length) return false;
  const countryOf = new Map(core.places.map((p) => [p.id, p.countryId]));
  const regionOf = new Map(core.countries.map((c) => [c.id, c.regionId]));
  return placeIds.every((id) => regionOf.get(countryOf.get(id) ?? "") === INDIA_GROUND.regionId);
}

/** Road drive time (hours) is the only thing that decides the default for a leg. */
export function indiaRoadFirst(): { maxMinutes: number } | null {
  return INDIA_GROUND?.enabled ? { maxMinutes: INDIA_GROUND.roadFirstMaxHours * 60 } : null;
}

export function indiaVehicle(pax: number): { count: number; label: string; dayRateInr: number } | null {
  if (!INDIA_GROUND?.enabled) return null;
  const classes = INDIA_GROUND.classes;
  const cls = classes.find((c) => pax <= c.maxPax) ?? classes[classes.length - 1];
  return { count: Math.max(1, Math.ceil(pax / cls.maxPax)), label: cls.label, dayRateInr: cls.dayRateInr };
}

/** Day-rate multiple for a drive: 1 for an ordinary day, 2 or 3 for a very long one. */
export function longLegMultiple(driveMinutes: number | null | undefined): number {
  if (!INDIA_GROUND?.enabled || !driveMinutes) return 1;
  const hours = driveMinutes / 60;
  return INDIA_GROUND.longLegs.reduce((m, r) => (hours > r.overDriveHours ? Math.max(m, r.dayMultiple) : m), 1);
}

// ---------------------------------------------------------------------------
// Seasonality
// ---------------------------------------------------------------------------

/**
 * Maps a destination's monthly price index (0-100) onto a rate multiplier.
 * An index of 50 is neutral; peak months cost more, troughs less.
 */
export function seasonMultiplier(summary: PlaceSummary | undefined, month: number): number {
  const index = summary?.monthPrice?.[String(month)];
  if (index == null) return 1;
  const raw = 1 + (index - SEASON.neutralIndex) * SEASON.sensitivity;
  return Math.min(SEASON.maxMultiplier, Math.max(SEASON.minMultiplier, raw));
}

// ---------------------------------------------------------------------------
// Live-rate override
// ---------------------------------------------------------------------------

/** A live hotel rate outside this band of the card is treated as a bad response, not a price. */
const HOTEL_LIVE_FLOOR = 0.2;
const HOTEL_LIVE_CEILING = 5;

export type LiveRate = {
  component: "flight" | "hotel" | "activity";
  key: string;
  inr: number;
  fetchedAt: string;
  /**
   * Where a flight fare came from. `google-flights` is the fare for the
   * traveller's own route, dates and cabin, so it is what they would see on the
   * internet today; `travelpayouts` is a cached monthly minimum, only an
   * approximation. Absent (hotels) behaves like the approximate kind.
   */
  provider?: "google-flights" | "travelpayouts";
  /** Google Flights only: the cheapest fare is on low-cost airlines. */
  lowCost?: boolean;
  /** Google Flights only: the airport the cheapest fare lands at (BKK or DMK when both were searched). */
  airportIata?: string;
};

/**
 * Second-level check: a live figure replaces the compiled baseline, but only
 * when it is fresh and within a plausible distance of it, and always with a
 * volatility margin so the quote survives movement before booking.
 */
export function resolveRate(
  baseline: number,
  baselineSource: RateSource,
  live: LiveRate | undefined,
  component: keyof typeof policy.liveRates.volatilityMargin,
): { inr: number; source: RateSource; live?: LiveRate } {
  const cfg = policy.liveRates;
  if (!cfg.enabled || !live || !Number.isFinite(live.inr) || live.inr <= 0) {
    return { inr: baseline, source: baselineSource };
  }

  const ageHours = (Date.now() - Date.parse(live.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > cfg.maxAgeHours) {
    return { inr: baseline, source: baselineSource };
  }

  // A fare read for this exact route, date and cabin is the real price, not an
  // estimate of it. Clamping it to the rate card would put back the very
  // error it exists to correct (a baseline that is too high could never be
  // undercut), so it is trusted as is and carries only the small allowance for
  // airlines repricing before ticketing.
  if (live.provider === "google-flights") {
    const variance = (cfg as { bookingVariance?: Partial<Record<string, number>> }).bookingVariance?.[component] ?? 0;
    return { inr: live.inr * (1 + variance), source: "live", live };
  }

  // A live hotel rate is the price the supplier is quoting for these dates, so
  // like a flight it is used as is. Clamping it to the card would stop a card
  // that is too high from ever being undercut. Only a figure so far from the
  // card that it is plainly a bad response (a total mistaken for a nightly
  // rate, say) is dropped in favour of the card.
  if (component === "hotel") {
    if (baseline > 0 && (live.inr < baseline * HOTEL_LIVE_FLOOR || live.inr > baseline * HOTEL_LIVE_CEILING)) {
      return { inr: baseline, source: baselineSource };
    }
    const variance = (cfg as { bookingVariance?: Partial<Record<string, number>> }).bookingVariance?.hotel ?? 0;
    return { inr: live.inr * (1 + variance), source: "live", live };
  }

  // A wildly different live figure is more likely a bad response than a real
  // price, so clamp it rather than trusting it outright.
  const lower = baseline * (1 - cfg.clampDeviation);
  const upper = baseline * (1 + cfg.clampDeviation);
  const clamped = baseline > 0 ? Math.min(upper, Math.max(lower, live.inr)) : live.inr;

  return { inr: clamped * (1 + cfg.volatilityMargin[component]), source: "live", live };
}

/**
 * Share of the adult airfare each age pays. Infants on a lap and children are
 * sold at a fraction of the adult fare, and only inside the traveller's own
 * country does a child pay in full.
 */
export function fareFactorForAge(age: number, domestic: boolean): number {
  const cf = (policy as { airfare?: { childFare?: {
    infantMaxAge: number; infantFactor: number; childMaxAge: number;
    internationalChildFactor: number; domesticChildFactor: number;
  } } }).airfare?.childFare;
  if (!cf) return 1;
  if (age <= cf.infantMaxAge) return cf.infantFactor;
  if (age <= cf.childMaxAge) return domestic ? cf.domesticChildFactor : cf.internationalChildFactor;
  return 1;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export type PricingInput = {
  request: QuoteRequest;
  pax: PaxBreakdown;
  stays: PlaceStay[];
  days: PlannedDay[];
  core: CoreBundle;
  summaries: Map<string, PlaceSummary>;
  visaRules: VisaRule[];
  /** Live overrides keyed `${component}:${key}`. */
  liveRates: Map<string, LiveRate>;
  /** Per-person activity price by cluster id, from the day planner. */
  activityPrices: Map<string, { code: string | null; price: number; source: RateSource }>;
  /** Scopes the calibration factors to the matched package. */
  referencePackageId?: string | null;
  /** The airports the trip lands at and leaves from, named on the airfare and airport transfer lines. */
  gateways?: { arrival: GatewayInfo; departure: GatewayInfo } | null;
};

function index<T extends { placeId: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.placeId);
    if (list) list.push(r);
    else m.set(r.placeId, [r]);
  }
  return m;
}

/**
 * A place with no authored Airport-Hotel/Sightseeing rate at all (its
 * destination is real but the rate card was never filled in for it) still
 * needs one — every "land package" transfer is structurally always charged,
 * per policy. Rather than leave it uncosted, this reuses the median rate for
 * that same service among every OTHER place in the same region that does
 * have one, which is a defensible "typical vehicle transfer here" figure.
 */
function buildRegionalTransferFallback(
  transferRates: TransferRate[],
  places: { id: string; countryId: string }[],
  countries: { id: string; regionId: string }[],
): Map<string, number> {
  const regionOfPlace = new Map<string, string>();
  const regionOfCountry = new Map(countries.map((c) => [c.id, c.regionId]));
  for (const p of places) {
    const regionId = regionOfCountry.get(p.countryId);
    if (regionId) regionOfPlace.set(p.id, regionId);
  }

  const samples = new Map<string, number[]>(); // `${regionId}|${service}` -> rates
  for (const rate of transferRates) {
    const regionId = regionOfPlace.get(rate.placeId);
    if (!regionId || rate.inr <= 0) continue;
    const key = `${regionId}|${rate.service}`;
    const list = samples.get(key);
    if (list) list.push(rate.inr);
    else samples.set(key, [rate.inr]);
  }

  const median = new Map<string, number>();
  for (const [key, values] of samples) {
    const sorted = [...values].sort((a, b) => a - b);
    median.set(key, sorted[Math.floor(sorted.length / 2)]);
  }
  return median;
}

export function priceQuotation(input: PricingInput): {
  lineItems: LineItem[];
  excludedLineItems: LineItem[];
  totals: QuoteTotals;
} {
  const { request, pax, stays, days, core, summaries, visaRules, liveRates, activityPrices } = input;
  const items: LineItem[] = [];
  // Lines an admin switched off: priced as usual but kept out of every total.
  const skipped: LineItem[] = [];
  const keyCount = new Map<string, number>();
  const switchedOff = new Set(request.excludedLineKeys);

  const hotels = index<HotelRate>(core.hotelRates);
  const transfers = index<TransferRate>(core.transferRates);
  const meals = index<MealRate>(core.mealRates);
  const cityTax = new Map<string, CityTax>(core.cityTaxes.map((c) => [c.placeId, c]));
  const placeName = new Map(core.places.map((p) => [p.id, p.name]));
  const countryOf = new Map(core.places.map((p) => [p.id, p.countryId]));
  const regionOf = new Map(core.countries.map((c) => [c.id, c.regionId]));
  const transferFallback = buildRegionalTransferFallback(core.transferRates, core.places, core.countries);

  const startMonth = new Date(`${request.startDate}T00:00:00Z`).getUTCMonth() + 1;

  /**
   * The months each stay's nights actually fall in, and how many land in each.
   *
   * Seasonality used to be read once, from the departure date, and applied to
   * every hotel in the trip. On a three-week itinerary starting in late March
   * that prices the last fortnight at March rates, and a single stay that
   * straddles a month boundary was billed entirely at the cheaper month. The
   * day plan already knows the real date of every night, so each stay's rate
   * is the nights-weighted blend of the months it actually spans.
   */
  const monthsOfStay = new Map<string, Map<number, number>>();
  for (const day of days) {
    // The final day is a departure, not a night, so it must not pull the
    // stay's rate into the following month.
    if (day.hotelPlaceId == null) continue;
    const parsed = new Date(`${day.date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const month = parsed.getUTCMonth() + 1;
    const counts = monthsOfStay.get(day.hotelPlaceId) ?? new Map<number, number>();
    counts.set(month, (counts.get(month) ?? 0) + 1);
    monthsOfStay.set(day.hotelPlaceId, counts);
  }

  /** Nights-weighted seasonal multiplier for a stay. */
  const staySeason = (placeId: string): number => {
    const summary = summaries.get(placeId);
    const counts = monthsOfStay.get(placeId);
    if (!counts?.size) return seasonMultiplier(summary, startMonth);

    let weighted = 0;
    let nights = 0;
    for (const [month, count] of counts) {
      weighted += seasonMultiplier(summary, month) * count;
      nights += count;
    }
    return nights ? weighted / nights : seasonMultiplier(summary, startMonth);
  };

  const vehicle = vehiclePlan(pax.total);
  const dietFactor = policy.meals.dietFactor[request.food] ?? 1;

  // Calibration is scoped to the trip's first destination, which is what the
  // reference package and the airfare are anchored on.
  const firstCountryId = stays.length ? (countryOf.get(stays[0].placeId) ?? null) : null;
  const scope: CalibrationScope = {
    packageId: input.referencePackageId ?? null,
    countryId: firstCountryId,
    regionId: core.countries.find((c) => c.id === firstCountryId)?.regionId ?? null,
  };

  const push = (
    component: CostComponent,
    label: string,
    detail: string,
    quantity: number,
    unit: string,
    unitPriceInr: number,
    locked: boolean,
    source: RateSource,
    placeId: string | null,
    calibrate = true,
  ) => {
    // Calibration is applied here so every component is corrected the same way,
    // whatever priced it. An agency's own flat rate is already the real figure,
    // so it opts out rather than being scaled a second time.
    const calibrated = unitPriceInr * (calibrate ? calibrationFactor(component, placeId ? { ...scope, placeId } : scope) : 1);
    if (quantity <= 0 || calibrated <= 0) return;
    // Same label twice (rare) gets a counter so each line has its own switch.
    const base = `${component}|${label}`;
    const seen = (keyCount.get(base) ?? 0) + 1;
    keyCount.set(base, seen);
    const key = seen === 1 ? base : `${base}#${seen}`;
    const line: LineItem = {
      key, component, label, detail, quantity, unit,
      unitPriceInr: Math.round(calibrated),
      totalInr: Math.round(quantity * calibrated),
      locked, source, placeId,
    };

    // An admin's own rate or quantity replaces the engine's. The line is priced
    // first so what the engine had said is kept next to it, and it is billed as
    // typed (rounded rupees x quantity), not through the calibration above.
    const ov = request.lineOverrides[key];
    if (ov && (ov.unitPriceInr !== undefined || ov.quantity !== undefined)) {
      const qty = ov.quantity ?? quantity;
      const rate = ov.unitPriceInr ?? calibrated;
      line.override = { unitPriceInr: line.unitPriceInr, quantity: line.quantity };
      line.quantity = qty;
      line.unitPriceInr = Math.round(rate);
      line.totalInr = Math.round(qty * rate);
      line.source = "manual";
    }
    (switchedOff.has(key) ? skipped : items).push(line);
  };

  // --- hotel ---------------------------------------------------------------
  // A place visited twice (Bangkok, Pattaya, Bangkok) is one hotel line with its
  // nights added up: the rate, the season and the city tax are the place's.
  const hotelStays: { placeId: string; placeName: string; nights: number; visits: number[] }[] = [];
  for (const s of stays) {
    const seen = hotelStays.find((h) => h.placeId === s.placeId);
    if (seen) {
      seen.nights += s.nights;
      seen.visits.push(s.nights);
    } else {
      hotelStays.push({ placeId: s.placeId, placeName: s.placeName, nights: s.nights, visits: [s.nights] });
    }
  }
  for (const stay of hotelStays) {
    if (!stay.nights) continue;
    const rate =
      hotels.get(stay.placeId)?.find((h) => h.star === request.hotelStar && h.zone === request.hotelZone) ??
      hotels.get(stay.placeId)?.find((h) => h.star === request.hotelStar);
    if (!rate) continue;

    const season = staySeason(stay.placeId);
    const live = liveRates.get(`hotel:${stay.placeId}:${request.hotelStar}`);
    const resolved = resolveRate(rate.inr * season, rate.source, live, "hotel");

    // The calibration factors were fitted to the rate card, so a live rate skips them.
    const calibrateHotel = resolved.source !== "live";
    push("hotel", `${stay.placeName} — ${request.hotelStar}`,
      `${stay.nights} night(s)${stay.visits.length > 1 ? ` (${stay.visits.join(" + ")}, either side of the other stops)` : ""} x ${pax.rooms} room(s), ${request.hotelZone}, room with breakfast`,
      stay.nights * pax.rooms, "room-night", resolved.inr, true, resolved.source, stay.placeId, calibrateHotel);

    if (pax.extraBeds) {
      const band = OCC.childBands.find((b) => b.roomPolicy === "extraBed");
      push("hotel", `${stay.placeName} — extra bed`,
        `${pax.extraBeds} child bed(s) x ${stay.nights} night(s)`,
        stay.nights * pax.extraBeds, "bed-night",
        resolved.inr * (band?.extraBedFactor ?? 0.35), true, resolved.source, stay.placeId, calibrateHotel);
    }

    const tax = cityTax.get(stay.placeId);
    if (tax?.perPersonPerNightInr) {
      push("city-tax", `${stay.placeName} — city / tourism tax`,
        `${pax.total} traveller(s) x ${stay.nights} night(s)`,
        stay.nights * pax.total, "person-night", tax.perPersonPerNightInr, true, tax.source, stay.placeId);
    }
  }

  // --- flight --------------------------------------------------------------
  // The bands are return fares to a single country. That is exactly right for
  // a one-country trip, and quietly wrong for every other kind: pricing only a
  // round trip to the *first* destination assumes the traveller doubles back
  // to fly home from where they started, when a Cairo → Nairobi → Cape Town
  // itinerary plainly flies home from South Africa. Where the trip starts and
  // ends in different countries it is priced as an open jaw — the outbound
  // half of the fare to the first country, plus the inbound half of the fare
  // from the last — which is both how such a ticket is actually sold and far
  // closer to the truth than ignoring the return country altogether.
  if (request.includeFlight && stays.length) {
    const selectBand = (destCountryId: string | undefined) => {
      const forCountry = core.flightBands.filter((b: FlightBand) => b.destCountryId === destCountryId);
      // Prefer the requested carrier and cabin, but never return no airfare at
      // all: low-cost carriers do not fly ultra-long-haul, so a traveller who
      // asked for one still has to be quoted the full-service fare.
      const byPreference = forCountry.filter(
        (b) => b.carrier === request.carrier && b.cabin === request.cabin,
      );
      const fallbackCarrier = forCountry.filter((b) => b.cabin === request.cabin);
      const fallbackCabin = forCountry.filter((b) => b.cabin === "Economy");
      const pool = byPreference.length
        ? byPreference
        : fallbackCarrier.length
          ? fallbackCarrier
          : fallbackCabin;

      // Bands are keyed by departure metro, so match the traveller's own city.
      return (
        pool.find((b) => b.originCity === request.departureCity) ??
        pool.find((b) => b.originCity === "*") ??
        pool[0]
      );
    };

    const fareOf = (band: FlightBand, destCountryId: string | undefined) => {
      let baseline = (band.priceLow + band.priceHigh) / 2;
      // Where the agency has told us a typical ticket from Kolkata, that figure
      // anchors the CCU full-service economy band and every other band keeps its
      // rate-card ratio to it (see `airfare` in content/quote-policy.json).
      const anchors = (policy as { airfare?: { ccuEconomyFullServiceInr?: Record<string, number> } }).airfare
        ?.ccuEconomyFullServiceInr;
      const anchor = destCountryId ? anchors?.[destCountryId] : undefined;
      if (anchor) {
        const ref = core.flightBands.find(
          (b: FlightBand) =>
            b.destCountryId === destCountryId && b.originCity === "CCU" && b.carrier === "FSC" && b.cabin === "Economy",
        );
        const refMid = ref ? (ref.priceLow + ref.priceHigh) / 2 : 0;
        if (refMid > 0) baseline = anchor * (baseline / refMid);
      }
      const live = liveRates.get(`flight:${request.departureCity}:${destCountryId}:${request.carrier}`);
      return resolveRate(baseline, band.source, live, "flight");
    };

    const carrierNote = (band: FlightBand, live?: LiveRate) => {
      // A fare read from Google Flights is the cheapest on sale whoever flies it, so name the airline type it
      // is actually on rather than the band the traveller asked for.
      if (live?.provider === "google-flights" && typeof live.lowCost === "boolean") {
        return live.lowCost ? "Low-cost carrier (cheapest fare on sale)" : "Full-service carrier (cheapest fare on sale)";
      }
      const carrierLabel = band.carrier === "LCC" ? "Low-cost carrier" : "Full-service carrier";
      return band.carrier !== request.carrier
        ? `${carrierLabel} (no low-cost service on this route)`
        : carrierLabel;
    };

    // A fare read from Google Flights was searched in the cabin the traveller chose, so say that cabin, not
    // the cabin of whichever rate-card band stood in as the baseline (an Economy band when no Business one exists).
    const cabinOf = (band: FlightBand, live?: LiveRate) =>
      live?.provider === "google-flights" ? request.cabin : band.cabin;

    const firstPlace = stays[0];
    const lastPlace = stays[stays.length - 1];

    // Which airports the ticket joins, in words, so the line says where the
    // flight goes from and to rather than only the city the traveller picked.
    const homeCity = (core.departureCities ?? []).find((c) => c.code === request.departureCity)?.label;
    const home = homeCity ? `${homeCity} (${request.departureCity})` : request.departureCity;
    const at = (g: GatewayInfo) => `${g.name} (${g.iata})`;
    const routeNote = (kind: "round-trip" | "out" | "home"): string => {
      const g = input.gateways;
      if (!g) return "";
      if (kind === "out") return `${home} to ${at(g.arrival)}; `;
      if (kind === "home") return `${at(g.departure)} to ${home}; `;
      return g.arrival.iata === g.departure.iata
        ? `${home} to ${at(g.arrival)} and back from the same airport; `
        : `${home} to ${at(g.arrival)}, back from ${at(g.departure)}; `;
    };
    const inboundCountry = countryOf.get(firstPlace.placeId);
    const outboundCountry = countryOf.get(lastPlace.placeId);

    // Adults, children and infants are separate lines at their own share of the
    // fare. A live fare is already the real price, so it is not run through the
    // calibration factors that were fitted to the rate card.
    const iso3Of = new Map(core.countries.map((c: { id: string; iso3: string | null }) => [c.id, c.iso3]));
    const faresFor = (destCountryId: string | undefined) => {
      const domestic = !!destCountryId && iso3Of.get(destCountryId) === request.nationality;
      let children = 0;
      let infants = 0;
      let childShare = 0;
      let infantShare = 0;
      for (const age of request.childAges) {
        const f = fareFactorForAge(age, domestic);
        if (f < 0.5) { infants++; infantShare += f; } else { children++; childShare += f; }
      }
      return {
        adults: request.adults,
        children, infants,
        childFactor: children ? childShare / children : 1,
        infantFactor: infants ? infantShare / infants : 1,
      };
    };

    const pushFare = (
      label: string,
      detail: string,
      perAdultInr: number,
      resolved: { source: RateSource; live?: LiveRate },
      destCountryId: string | undefined,
    ) => {
      const heads = faresFor(destCountryId);
      const checked = resolved.source === "live" && resolved.live?.provider === "google-flights"
        ? `; live Google Flights fare checked ${resolved.live.fetchedAt.slice(11, 16)} UTC, actual price is confirmed on the final quotation`
        : "";
      const calibrate = resolved.source !== "live";
      push("flight", label, `${detail}${checked}`, heads.adults, "person", perAdultInr, false, resolved.source, null, calibrate);
      push("flight", `${label} — children`, `${detail}, child fare`, heads.children, "person",
        perAdultInr * heads.childFactor, false, resolved.source, null, calibrate);
      push("flight", `${label} — infants`, `${detail}, infant on lap`, heads.infants, "person",
        perAdultInr * heads.infantFactor, false, resolved.source, null, calibrate);
    };

    const inboundBand = selectBand(inboundCountry);

    if (inboundBand && inboundCountry === outboundCountry) {
      const resolved = fareOf(inboundBand, inboundCountry);
      pushFare(`Return airfare — ${request.departureCity} to ${placeName.get(firstPlace.placeId)}`,
        `${routeNote("round-trip")}${carrierNote(inboundBand, resolved.live)}, ${cabinOf(inboundBand, resolved.live)}, round trip`,
        resolved.inr, resolved, inboundCountry);
    } else if (inboundBand) {
      const outboundBand = selectBand(outboundCountry) ?? inboundBand;
      const inboundResolved = fareOf(inboundBand, inboundCountry);
      const outboundResolved = fareOf(outboundBand, outboundCountry);

      pushFare(`Airfare out — ${request.departureCity} to ${placeName.get(firstPlace.placeId)}`,
        `${routeNote("out")}${carrierNote(inboundBand, inboundResolved.live)}, ${cabinOf(inboundBand, inboundResolved.live)}, one way of an open-jaw ticket`,
        inboundResolved.inr / 2, inboundResolved, inboundCountry);

      pushFare(`Airfare home — ${placeName.get(lastPlace.placeId)} to ${request.departureCity}`,
        `${routeNote("home")}${carrierNote(outboundBand, outboundResolved.live)}, ${cabinOf(outboundBand, outboundResolved.live)}, one way of an open-jaw ticket`,
        outboundResolved.inr / 2, outboundResolved, outboundCountry);
    }
  }

  // --- airport transfers (structural, always included) ---------------------
  // The agency's calculation sheet counts two airport transfers per trip: one
  // pickup where the traveller lands and one drop-off where they leave. Stays
  // in between are reached overland (priced as intercity transport) or by a
  // flight whose airport links are priced on the leg, so charging an airport
  // transfer at every stay would bill the same journey twice.
  const indiaDaily = indiaGroundApplies(core, stays.map((s) => s.placeId));
  const dayVehicle = indiaDaily ? indiaVehicle(pax.total) : null;

  if (dayVehicle) {
    // One chauffeur-driven vehicle for the whole trip, billed per day: airport
    // pick-up and drop, every intercity drive and all the sightseeing together.
    const tripDays = days.length;
    push("ground-transport", `Vehicle with driver — ${dayVehicle.label}`,
      `${tripDays} day(s) x ${dayVehicle.count} x ${dayVehicle.label}: airport transfers, intercity drives and sightseeing, fuel, driver and tolls included`,
      tripDays * dayVehicle.count, "vehicle-day", dayVehicle.dayRateInr, true, "estimated", null, false);
  }

  if (stays.length && !dayVehicle) {
    // Cruise destinations name their transfers Airport→Cruise rather than
    // Airport→Hotel, so accept either.
    const pick = (placeId: string, services: TransferRate["service"][]) => {
      const rows = transfers.get(placeId) ?? [];
      for (const service of services) {
        const hit = rows.find((t) => t.service === service);
        if (hit) return hit;
      }
      return undefined;
    };
    // When a place has no authored rate at all, fall back to the regional
    // median for that exact service rather than leaving the transfer
    // uncosted — it is always structurally included, per policy.
    const fallbackFor = (placeId: string, service: TransferRate["service"]): number | undefined => {
      const regionId = regionOf.get(countryOf.get(placeId) ?? "");
      return regionId ? transferFallback.get(`${regionId}|${service}`) : undefined;
    };
    for (const [index, stay] of stays.entries()) {
      const arrive = pick(stay.placeId, ["Airport→Hotel", "Airport→Cruise"]);
      const depart = pick(stay.placeId, ["Hotel→Airport", "Cruise→Airport"]);
      const arriveInr = arrive?.inr ?? fallbackFor(stay.placeId, "Airport→Hotel");
      const departInr = depart?.inr ?? fallbackFor(stay.placeId, "Hotel→Airport");
      if (arriveInr && index === 0) {
        push("airport-transfer", `Airport to hotel — ${placeName.get(stay.placeId)}`,
          `${input.gateways ? `From ${input.gateways.arrival.name} (${input.gateways.arrival.iata}), ` : ""}${vehicle.count} x ${vehicle.label}`, vehicle.count, "vehicle",
          arriveInr * vehicle.factor, true, arrive?.source ?? "estimated", stay.placeId);
      }
      if (departInr && index === stays.length - 1) {
        push("airport-transfer", `Hotel to airport — ${placeName.get(stay.placeId)}`,
          `${input.gateways ? `To ${input.gateways.departure.name} (${input.gateways.departure.iata}), ` : ""}${vehicle.count} x ${vehicle.label}`, vehicle.count, "vehicle",
          departInr * vehicle.factor, true, depart?.source ?? "estimated", stay.placeId);
      }
    }
  }

  // --- local transport: one sightseeing vehicle per active day -------------
  const activeDaysByPlace = new Map<string, number>();
  for (const day of days) {
    if (!day.activities.length) continue;
    activeDaysByPlace.set(day.placeId, (activeDaysByPlace.get(day.placeId) ?? 0) + 1);
  }
  for (const [placeId, count] of dayVehicle ? [] : activeDaysByPlace) {
    const rate =
      transfers.get(placeId)?.find((t) => t.service === "Hotel→Sightseeing") ??
      transfers.get(placeId)?.find((t) => t.service === "Cruise→Sightseeing");
    const regionId = regionOf.get(countryOf.get(placeId) ?? "");
    const fallbackInr = regionId ? transferFallback.get(`${regionId}|Hotel→Sightseeing`) : undefined;
    const inr = rate?.inr ?? fallbackInr;
    if (!inr) continue;
    push("local-transport", `Sightseeing transport — ${placeName.get(placeId)}`,
      `${count} day(s) x ${vehicle.count} x ${vehicle.label}`,
      count * vehicle.count, "vehicle-day", inr * vehicle.factor, true, rate?.source ?? "estimated", placeId);
  }

  // --- intercity transport --------------------------------------------------
  for (const day of days) {
    if (!day.isTransferDay || !day.transfer || day.transfer.priceInr <= 0) continue;
    const leg = day.transfer;
    const mode = leg.mode.replace(/_/g, " ");
    const onsite = leg.onsiteMode ? ` (${leg.onsiteMode.replace(/_/g, " ")})` : "";
    const time = leg.durationMinutes != null ? ` · ${formatDuration(leg.durationMinutes)}` : "";
    const distance = leg.distanceKm ? ` · ${leg.distanceKm} km` : "";
    if (dayVehicle && leg.includedInVehicle) {
      // The road is already paid for by the daily vehicle. Only a drive that
      // swallows most of a day costs more than an ordinary day.
      const multiple = longLegMultiple(leg.durationMinutes);
      if (multiple > 1) {
        push("intercity-transport", `${leg.from} to ${leg.to}`,
          `long drive${time}${distance} — ${multiple}x the day rate, so ${multiple - 1} extra vehicle day(s)`,
          (multiple - 1) * dayVehicle.count, "vehicle-day", dayVehicle.dayRateInr, true, "estimated", day.placeId, false);
      }
      continue;
    }
    if (leg.car) {
      // A car is billed per vehicle, not per head.
      const car = leg.car;
      push("intercity-transport", `${leg.from} to ${leg.to}`,
        `private car — ${car.className}${time}${distance} · fuel, driver, tolls included`,
        car.vehicles, "vehicle", car.perVehicleInr, true, "estimated", day.placeId);
      continue;
    }
    push("intercity-transport", `${leg.from} to ${leg.to}`,
      `${mode}${onsite}${time}${distance}`,
      pax.total, "person", leg.priceInr, true, leg.estimated ? "estimated" : "workbook", day.placeId);

    // The ground link at each end of a flight (e.g. Zurich Airport -> Interlaken).
    // On a day-rate trip the vehicle that drives the sightseeing does these too.
    for (const link of dayVehicle ? [] : (leg.airportLinks ?? [])) {
      const linkMode = link.mode.replace(/_/g, " ");
      const detail = `${link.car ? `private car — ${link.car.className}` : linkMode} · ${formatDuration(link.minutes)} · ${link.distanceKm} km`;
      if (link.car) {
        push("intercity-transport", `${link.from} to ${link.to}`, detail,
          link.car.vehicles, "vehicle", link.car.perVehicleInr, true, "estimated", day.placeId);
      } else {
        push("intercity-transport", `${link.from} to ${link.to}`, detail,
          pax.total, "person", link.priceInr, true, "estimated", day.placeId);
      }
    }
  }

  // --- sightseeing ----------------------------------------------------------
  for (const day of days) {
    for (const activity of day.activities) {
      if (!activity.clusterId) continue;
      const priced = activityPrices.get(activity.clusterId);
      if (!priced || priced.price <= 0) continue;
      push("sightseeing", `${activity.title} — ${day.placeName}`,
        `Day ${day.dayNumber}, ${activity.hours}h`,
        pax.activityHeads, "person", priced.price, false, priced.source, day.placeId);
    }
  }

  // --- meals ---------------------------------------------------------------
  const lunchDays = new Map<string, number>();
  const dinnerDays = new Map<string, number>();
  for (const day of days) {
    if (day.meals.lunch) lunchDays.set(day.placeId, (lunchDays.get(day.placeId) ?? 0) + 1);
    if (day.meals.dinner) dinnerDays.set(day.placeId, (dinnerDays.get(day.placeId) ?? 0) + 1);
  }
  // Some regions are priced from the agency's own per-meal figure instead of the
  // workbook template (India: INR 500-800 a head at a 3 Star hotel).
  const perMealPolicy = (policy.meals as { regionPerMeal?: Record<string, { regionId: string; byStar: Record<string, number> }> })
    .regionPerMeal ?? {};
  const agencyMeal = (placeId: string): number | undefined => {
    const regionId = regionOf.get(countryOf.get(placeId) ?? "");
    for (const rule of Object.values(perMealPolicy)) {
      if (rule.regionId === regionId && rule.byStar[request.hotelStar]) return rule.byStar[request.hotelStar];
    }
    return undefined;
  };
  const mealLine = (map: Map<string, number>, meal: "Lunch" | "Dinner") => {
    for (const [placeId, count] of map) {
      const rate = meals.get(placeId)?.find((m) => m.meal === meal);
      const agency = agencyMeal(placeId);
      if (!rate && agency == null) continue;
      push("meals", `${meal} — ${placeName.get(placeId)}`,
        `${count} day(s) x ${pax.mealHeads.toFixed(1)} head(s), ${request.food}`,
        count * pax.mealHeads, "person-meal", (agency ?? rate!.inr) * dietFactor, false,
        agency != null ? "estimated" : rate!.source, placeId,
        // The agency's figure is already the real price; the region's meal
        // calibration (if any) was fitted to the workbook template instead.
        agency == null);
    }
  };
  mealLine(lunchDays, "Lunch");
  mealLine(dinnerDays, "Dinner");

  // --- visa ----------------------------------------------------------------
  if (request.includeVisa) {
    const seen = new Set<string>();
    for (const stay of stays) {
      const countryId = countryOf.get(stay.placeId);
      if (!countryId || seen.has(countryId)) continue;
      seen.add(countryId);
      // Home country: a citizen needs no visa to travel inside it.
      if (core.countries.find((c) => c.id === countryId)?.iso3 === request.nationality) continue;
      const rule = visaRules.find(
        (v) => v.nationality === request.nationality && v.destCountryId === countryId,
      );
      if (!rule || rule.feeInr <= 0) continue;
      push("visa", `Visa support — ${core.countries.find((c) => c.id === countryId)?.name ?? countryId}`,
        `${request.nationality} passport, ${rule.requirement.replace(/_/g, " ")}`,
        pax.total, "person", rule.feeInr, false, rule.source, null);
    }
  }

  // --- permits and other place-specific fixed charges -----------------------
  // Charges no rate card carries (Tibet permits and guide for Kailash). They
  // are the agency's own figures, so they are not calibrated.
  const permitPolicy = (policy as { permits?: { items: { id: string; label: string; perPersonInr: number; appliesWhenAnyPlace: string[] }[] } }).permits;
  for (const permit of permitPolicy?.items ?? []) {
    if (!stays.some((s) => permit.appliesWhenAnyPlace.includes(s.placeId))) continue;
    push("visa", permit.label, `${pax.total} traveller(s), agency fixed charge`,
      pax.total, "person", permit.perPersonInr, true, "manual", null, false);
  }

  // --- insurance -----------------------------------------------------------
  if (request.includeInsurance && stays.length) {
    const regionId = core.countries.find((c) => c.id === countryOf.get(stays[0].placeId))?.regionId;
    const rate = core.insuranceRates.find((i: InsuranceRate) => i.zone === regionId);
    if (rate) {
      const tripDays = days.length;
      push("insurance", "Travel insurance",
        `${tripDays} day(s) x ${pax.total} traveller(s)`,
        tripDays * pax.total, "person-day", rate.perPersonPerDayInr, false, rate.source, null);
    }
  }

  // --- charges the admin added by hand ---------------------------------------
  // For a rate the engine has no card for. Billed as typed and loaded with
  // contingency, margin and tax like every other line, and switchable off the
  // same way.
  for (const c of request.customLines) {
    if (c.quantity <= 0 || c.unitPriceInr <= 0) continue;
    const key = `custom|${c.id}`;
    const line: LineItem = {
      key,
      component: c.component,
      label: c.label,
      detail: "Added by the agency",
      quantity: c.quantity,
      unit: "unit",
      unitPriceInr: Math.round(c.unitPriceInr),
      totalInr: Math.round(c.quantity * c.unitPriceInr),
      locked: false,
      source: "manual",
      placeId: null,
      custom: true,
    };
    (switchedOff.has(key) ? skipped : items).push(line);
  }

  // --- totals --------------------------------------------------------------
  const directCost = items.reduce((a, i) => a + i.totalInr, 0);
  const contingency = directCost * MARKUP.contingency;
  const costBeforeMarkup = directCost + contingency;
  // Margin is a share of each category's own cost: the policy sets it per
  // category (content/quote-policy.json markup.componentMargin), and an admin
  // can override any category, or the whole quote, per quote. It is not pulled
  // back into any band, because the rates are the commercial rule.
  const cost = new Map<string, number>();
  for (const i of items) cost.set(i.component, (cost.get(i.component) ?? 0) + i.totalInr);
  const marginByComponent: Record<string, number> = {};
  let agentMarkup = 0;
  for (const [component, amount] of cost) {
    const policyRate =
      (MARKUP.componentMargin as Record<string, number>)[component] ?? MARKUP.defaultMargin;
    const rate = request.componentMarginPct[component] ?? request.marginPct ?? policyRate;
    const m = amount * rate;
    marginByComponent[component] = Math.round(m);
    agentMarkup += m;
  }
  const afterMarkup = costBeforeMarkup + agentMarkup;
  const salesVat = afterMarkup * MARKUP.salesVat;
  const paymentAndFx = (afterMarkup + salesVat) * (MARKUP.paymentGatewayFee + MARKUP.fxBuffer);
  const total = Math.round(afterMarkup + salesVat + paymentAndFx);

  return {
    lineItems: items,
    excludedLineItems: skipped,
    totals: {
      directCost: Math.round(directCost),
      contingency: Math.round(contingency),
      costBeforeMarkup: Math.round(costBeforeMarkup),
      agentMarkup: Math.round(agentMarkup),
      salesVat: Math.round(salesVat),
      paymentAndFx: Math.round(paymentAndFx),
      total,
      // Derived from the rounded total so the two always reconcile.
      perPerson: Math.round(total / Math.max(1, pax.total)),
      flooredToPackage: null,
      marginByComponent,
    },
  };
}
