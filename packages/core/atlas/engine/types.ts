import { z } from "zod";
import policy from "../../../../content/quote-policy.json";
import {
  CarrierType,
  FoodPreference,
  HotelStar,
  HotelZone,
  TransportMode,
  TravellerType,
  TripStyle,
} from "../schema";
import type { PlanningNote } from "./advisories";
import type { CarEstimate } from "./roadcar";

/**
 * Engine inputs and outputs.
 *
 * Every input is a bounded choice — there is no free-text field anywhere in the
 * request, which is what lets the planner UI be entirely select-driven.
 */

export const Cabin = z.enum(["Economy", "Premium Economy", "Business"]);
export type Cabin = z.infer<typeof Cabin>;

export const MealPlan = z.enum(["breakfast", "half-board", "full-board"]);
export type MealPlan = z.infer<typeof MealPlan>;

export const Pace = z.enum(["relaxed", "balanced", "packed"]);
export type Pace = z.infer<typeof Pace>;

/** How hard the router trades fare against journey time on intercity legs. */
export const TransportPreference = z.enum(["fastest", "balanced", "cheapest"]);
export type TransportPreference = z.infer<typeof TransportPreference>;

/** Mirrors the Quotation_Calculation sheet's cost components. */
export const CostComponent = z.enum([
  "hotel",
  "flight",
  "airport-transfer",
  "local-transport",
  /** All-in daily vehicle on an all-India trip: airport, intercity and sightseeing together. */
  "ground-transport",
  "intercity-transport",
  "sightseeing",
  "meals",
  "visa",
  "insurance",
  "city-tax",
]);
export type CostComponent = z.infer<typeof CostComponent>;

/**
 * An admin's replacement for what the engine priced a line at. Either field may
 * be left out to keep the engine's figure. Rupees are the agency's own cost —
 * contingency, margin and tax are still applied on top, exactly as for any line.
 */
export const LineOverride = z.object({
  unitPriceInr: z.number().min(0).max(100_000_000).optional(),
  quantity: z.number().min(0).max(100_000).optional(),
});
export type LineOverride = z.infer<typeof LineOverride>;

/**
 * A charge the admin adds to a category by hand (a rate the engine has no card
 * for). Priced like any other line, so it carries margin and tax.
 */
export const CustomCostLine = z.object({
  /** Stable id; the line's `LineItem.key` is `custom|<id>`. */
  id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
  component: CostComponent,
  label: z.string().trim().min(1).max(120),
  quantity: z.number().min(0).max(100_000),
  unitPriceInr: z.number().min(0).max(100_000_000),
});
export type CustomCostLine = z.infer<typeof CustomCostLine>;

export const QuoteRequest = z.object({
  /** Places chosen on the map, or resolved from the "explore" questionnaire. */
  placeIds: z.array(z.string()).min(1),
  /** Total nights for the whole trip. */
  nights: z.number().int().min(1).max(policy.guardrails.maxNights),
  /** ISO date of departure; drives the seasonality multiplier. */
  startDate: z.string(),

  adults: z.number().int().min(1).max(40),
  /** Ages drive room allocation, activity pricing and day-plan intensity. */
  childAges: z.array(z.number().int().min(0).max(17)),
  /**
   * Rooms the traveller wants. Absent means "work it out from the party".
   * An impossible number is quietly adapted when pricing — see `resolvePax`.
   */
  rooms: z.number().int().min(1).max(40).optional(),

  travellerType: TravellerType,
  tripStyle: TripStyle,
  /** Passport country (ISO-3166-1 alpha-3) — visa is a function of this. */
  nationality: z.string().length(3),
  departureCity: z.string(),

  hotelStar: HotelStar,
  hotelZone: HotelZone,
  carrier: CarrierType,
  cabin: Cabin,
  mealPlan: MealPlan,
  food: FoodPreference,
  pace: Pace,

  includeVisa: z.boolean(),
  includeInsurance: z.boolean(),
  includeFlight: z.boolean(),

  /**
   * What the traveller actually wants out of the trip — `PHOTOGRAPHY`,
   * `FOOD`, `NATURE`, `NIGHTLIFE`, and so on.
   *
   * The destination files' decision rules are written against this vocabulary
   * (509 distinct interests across 1,241 conditions), and without it roughly
   * half of every destination's rules are unanswerable. Empty is a valid and
   * honest answer: a rule resting on an interest the traveller never stated
   * is reported as undecided rather than guessed at.
   */
  interests: z.array(z.string()).default([]),
  /**
   * Whether this is the traveller's first visit to these destinations.
   *
   * Defaults to true because that is what an agency assumes when quoting cold,
   * and because the rules it unlocks are the "see the landmarks properly"
   * ones — the right default for a first quote. Set false for a repeat
   * traveller and those rules stop firing.
   */
  firstTimeVisitor: z.boolean().default(true),

  /**
   * How hard to trade fare against journey time on intercity legs.
   * "cheapest" will happily put the traveller on an overnight bus;
   * "fastest" buys the flight. Overridable per leg below.
   */
  transportPreference: TransportPreference.default("balanced"),
  /**
   * Per-leg mode override, keyed by the arriving place's id (each leg is
   * identified by where it lands, which is unique within one itinerary).
   */
  legModes: z.record(z.string(), TransportMode).default({}),

  /** Traveller adjustments made on the quotation page. */
  excludedActivityCodes: z.array(z.string()).default([]),
  excludedClusterIds: z.array(z.string()).default([]),
  /**
   * Individual price lines an admin has switched off in the quote editor (see
   * `LineItem.key`). The trip itself is unchanged; the charge is just not billed.
   */
  excludedLineKeys: z.array(z.string()).default([]),
  /**
   * Admin rate/quantity replacements, keyed by `LineItem.key`. The engine still
   * prices the line first (so the original is kept for reference) and then
   * substitutes these. A key that no longer matches a line is ignored.
   */
  lineOverrides: z.record(z.string(), LineOverride).default({}),
  /**
   * The agency's margin, as a share of actual cost, set by hand in the quote
   * editor. Null leaves it to the policy (regressive bands, luxury rate and the
   * contingency + margin clamp). Any value here replaces the policy rate and
   * the clamp for every category that has no override of its own.
   */
  marginPct: z.number().min(0).max(1).nullable().default(null),
  /** Per-category margin (share of that category's cost), keyed by component. Beats `marginPct`. */
  componentMarginPct: z.record(z.string(), z.number().min(0).max(1)).default({}),
  /** Charges an admin added by hand, on top of what the engine priced. */
  customLines: z.array(CustomCostLine).max(50).default([]),
  /**
   * "auto" lets the planner fill each day from its own ranking, so removing a
   * place pulls in the next one. "manual" plans exactly the places in
   * `pinnedClusterIds` and nothing else: the admin's list is the itinerary.
   */
  sightseeingMode: z.enum(["auto", "manual"]).default("auto"),
  addedActivityCodes: z.array(z.string()).default([]),
  /**
   * Clusters the traveller explicitly asked to include from the "you could
   * also add" list. These jump the ranking queue so they are packed before
   * anything the ranker merely preferred — but they are still packed against
   * the same daily sightseeing budget as everything else, so pinning one can
   * never push a day past `maxSightseeingHoursPerDay`. A pin that cannot fit
   * is reported back rather than silently honoured or silently dropped.
   */
  pinnedClusterIds: z.array(z.string()).default([]),
  /** Manual override of the automatic night split, keyed by place id. */
  nightOverrides: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

// ---------------------------------------------------------------------------
// Itinerary
// ---------------------------------------------------------------------------

export type PlannedActivity = {
  clusterId: string | null;
  /** Activity rate code, when this maps to a priced item. */
  code: string | null;
  title: string;
  hours: number;
  attractions: string[];
  walkingIntensity: string | null;
  /** Locked items are structural (transfers) and cannot be deselected. */
  locked: boolean;
  pricePerPersonInr: number;
  /** Position within its day, so a switched-off outing can be shown in place. */
  slot?: number;
};

/** One selectable way of making a leg, as offered to the traveller. */
export type TransferAlternative = {
  mode: TransportMode;
  minutes: number;
  /** Per person, before calibration and markup. */
  priceInr: number;
  estimated: boolean;
  /** Per-vehicle pricing detail, for private car options. */
  car?: CarEstimate;
  /**
   * The trip bills one all-in vehicle per day (see `groundTransport` in the quote
   * policy), and this road option runs in it, so choosing it adds nothing.
   */
  includedInVehicle?: boolean;
};

/**
 * The ground link at either end of a flight: Interlaken has no airport, so
 * flying there means landing at Zurich and travelling on. Not part of the
 * trip's itinerary, but part of the journey — and priced, with its own mode
 * choice (train, bus, private car…).
 */
export type AirportLink = {
  /** Stable key, also the `legModes` key used to pin this link's mode. */
  key: string;
  direction: "to-airport" | "from-airport";
  from: string;
  to: string;
  airportIata: string;
  airportName: string;
  distanceKm: number;
  mode: TransportMode;
  minutes: number;
  /** Per person, before calibration and markup. */
  priceInr: number;
  estimated: boolean;
  alternatives: TransferAlternative[];
  userChosen: boolean;
  car?: CarEstimate;
  includedInVehicle?: boolean;
};

export type TransferLeg = {
  from: string;
  to: string;
  mode: TransportMode | "transfer";
  durationMinutes: number | null;
  /** Whether the journey itself is the experience (cruise, safari drive). */
  onsiteMode: string | null;
  priceInr: number;
  /** True when no real route rate was found and this used a coarser
   *  country-level or regional-median fallback (see `RouteLookup.best`). */
  estimated: boolean;
  /** Straight-line distance between the two ends, when known. */
  distanceKm: number | null;
  /**
   * Intermediate places, when no direct service exists and the leg had to be
   * composed from several real hops. Empty on a direct leg.
   */
  via: string[];
  /**
   * Every mode available for this leg, best-first for the trip's transport
   * preference — what the traveller picks between to trade price for time.
   */
  alternatives: TransferAlternative[];
  /** True when the traveller pinned this leg's mode themselves. */
  userChosen: boolean;
  /** Set when this leg is a chauffeur-driven private car (priced per vehicle). */
  car?: CarEstimate;
  /** This road leg runs in the trip's daily vehicle and adds no fare of its own. */
  includedInVehicle?: boolean;
  /** Ground links to and from the airports, when this leg is a flight. */
  airportLinks?: AirportLink[];
};

export type PlannedDay = {
  dayNumber: number;
  date: string;
  placeId: string;
  placeName: string;
  /** True on the day the traveller changes city. */
  isTransferDay: boolean;
  /** True when no attraction fit this day's budget — an "over-nighted" signal
   *  the traveller should see as a warning, not a silent gap in the plan. */
  isFreeDay: boolean;
  transfer: TransferLeg | null;
  activities: PlannedActivity[];
  /**
   * Outings the traveller switched off. They keep the slot they were planned
   * into so the row stays on the page and can be ticked again, but they are
   * not billed and do not count towards `activeHours`.
   */
  excludedActivities: PlannedActivity[];
  activeHours: number;
  budgetHours: number;
  /** Hotel is null on the final day, when the traveller flies home. */
  hotelPlaceId: string | null;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean };
  notes: string[];
};

export type PlaceStay = {
  placeId: string;
  placeName: string;
  nights: number;
  /** Order in the routed sequence. */
  position: number;
};

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export type LineItem = {
  /** Stable id for this charge (component + label), so an admin can switch it off and on. */
  key: string;
  component: CostComponent;
  label: string;
  detail: string;
  quantity: number;
  unit: string;
  unitPriceInr: number;
  totalInr: number;
  /** Structural costs the traveller may not remove. */
  locked: boolean;
  /** Where the rate came from, so the quote can be audited. */
  source: "workbook" | "estimated" | "live" | "manual";
  placeId: string | null;
  /** Set when an admin replaced the rate and/or quantity. Holds what the engine had priced. */
  override?: { unitPriceInr: number; quantity: number };
  /** True for a charge an admin added by hand rather than one the engine priced. */
  custom?: boolean;
};

/** Where a sightseeing outing stands in the itinerary (admin view). */
export type SightseeingStatus = "planned" | "unscheduled" | "excluded";

/**
 * Every outing available at a stay, whether or not it made the itinerary, so
 * the admin can see and switch any of them. Never shown to the traveller.
 */
export type SightseeingOption = PlannedActivity & {
  placeId: string;
  placeName: string;
  status: SightseeingStatus;
};

export type QuoteTotals = {
  directCost: number;
  contingency: number;
  costBeforeMarkup: number;
  agentMarkup: number;
  salesVat: number;
  paymentAndFx: number;
  total: number;
  perPerson: number;
  /** Set when the published package floor bound the result. */
  flooredToPackage: string | null;
  /**
   * The agency's margin in rupees per category, present only when the admin set
   * a margin by hand. Without it the margin is spread pro rata to cost.
   */
  marginByComponent?: Record<string, number>;
};

export type QuoteWarning = {
  level: "info" | "warning";
  /**
   * Internal notes explain how the engine arrived at a number and are for the
   * agency and the calibration report only — showing a traveller that their
   * price was floored, or that a rate is provisional, undermines the quote.
   */
  audience: "traveller" | "internal";
  message: string;
};

export type Quotation = {
  request: QuoteRequest;
  /** The published package this quote was built from, when one matched. */
  referencePackage: { id: string; name: string; priceFromInr: number; matchRatio: number } | null;
  stays: PlaceStay[];
  days: PlannedDay[];
  lineItems: LineItem[];
  /** Lines an admin switched off. Not in `lineItems` or any total; kept so they can be switched back on. */
  excludedLineItems?: LineItem[];
  totals: QuoteTotals;
  /** Head counts after applying the child age bands. */
  pax: { adults: number; children: number; infants: number; total: number; rooms: number };
  warnings: QuoteWarning[];
  /** Items the traveller could add, with their price impact. */
  suggestions: PlannedActivity[];
  /** Every outing at every stay with its status, for the admin's sightseeing picker. */
  sightseeingOptions?: SightseeingOption[];
  /** Exchange-rate moves applied to rates quoted in a foreign currency, so the admin can see the quote is not on the card's own conversion. */
  fx?: { currency: string; liveInrPerUnit: number; cardInrPerUnit: number; factor: number; rowsAffected: number }[];
  /**
   * Planner guidance drawn from the destination files for exactly this trip —
   * how transfers really work in each city, what to do and avoid for this kind
   * of traveller, and the destination's own decision rules.
   *
   * Twenty-one of the files' thirty-six sections were previously read by
   * nothing at all; this is the route by which that knowledge reaches the
   * quotation instead of sitting unused on disk.
   */
  planningNotes: PlanningNote[];
  /**
   * The destination decision rules that actually fired for this trip.
   *
   * Section 33 of each file is a real rule block — `IF trip_length <= 3 nights
   * THEN …` — and there are around sixteen per destination. Showing all of
   * them told the traveller nothing; these are the ones whose conditions their
   * trip genuinely meets.
   */
  appliedRules: AppliedRule[];
};

/** A decision rule that fired, with where it came from and what it asked for. */
export type AppliedRule = {
  placeId: string;
  placeName: string;
  ruleId: string;
  /** The conditions that were met, rendered readably. */
  conditions: string[];
  action: string;
  reason: string | null;
  /** True when the engine acted on it, rather than only reporting it. */
  applied: boolean;
};
