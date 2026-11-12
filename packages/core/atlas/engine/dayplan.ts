/**
 * Stage 3: turn the ordered stays into a day-by-day plan.
 *
 * Each day gets an activity-hour budget derived from the pace, the group's
 * walking tolerance and whether it is an arrival, departure or transfer day.
 * Geographical clusters are then packed into that budget best-first, so a day
 * is filled as fully as it can be without breaching the rest requirement.
 */
import type { Cluster, DestinationBundle, PurposeActivity, TransportMode, TripStyle } from "../schema";
import policy from "../../../../content/quote-policy.json";
import type { AirportLink, PlaceStay, PlannedActivity, PlannedDay, SightseeingOption, TransferLeg, TransportPreference } from "./types";
import type { RouteLookup } from "./itinerary";
import type { AirportRef } from "./gateway";
import { formatDuration } from "./text";
import { arrivalDay, clock } from "./entry";

const DAY = policy.dayPlanning;

export type GroupProfile = {
  hasYoungChildren: boolean;
  hasSeniors: boolean;
  paxTotal: number;
};

/** Hours of activity a day can absorb before the rest requirement is breached. */
export function dayBudget(
  pace: keyof typeof DAY.pace,
  group: GroupProfile,
  kind: "arrival" | "departure" | "transfer" | "full",
): number {
  let hours = DAY.pace[pace];
  if (group.hasYoungChildren) hours *= DAY.youngChildPenalty;
  if (group.hasSeniors) hours *= DAY.seniorPenalty;
  if (kind === "arrival") hours *= DAY.arrivalDayFactor;
  if (kind === "departure") hours *= DAY.departureDayFactor;

  const ceiling = 24 - DAY.restHours - DAY.mealBreakHours;
  // `maxSightseeingHoursPerDay` is the hard one: every activity — planned by
  // the ranker or added by hand on the quotation page — is packed against
  // this budget, so it is the single place a day's sightseeing is capped.
  return Math.max(
    0,
    Math.min(hours, ceiling, DAY.maxActiveHours, DAY.maxSightseeingHoursPerDay),
  );
}

/**
 * Ranks a place's clusters for a trip style.
 *
 * The destination files list activities by purpose in prose, so a cluster is
 * scored by how many of that purpose's phrases its attractions echo. Falls back
 * to attraction count so a place with no purpose section still plans sensibly.
 *
 * A destination's own decision rules can then nudge the order: a rule that
 * fired for this trip and says `prioritize_TAJ_MAHAL_SUNRISE` pushes the
 * matching cluster up, and one saying `do not recommend Saqqara by default`
 * pushes it down. The nudge is bounded — it reorders, it does not override —
 * so the planner still decides what actually fits the day.
 */
export function rankClusters(
  clusters: Cluster[],
  purposeActivities: PurposeActivity[],
  style: TripStyle,
  bias: { tokens: string[]; bias: number }[] = [],
): Cluster[] {
  const phrases = purposeActivities
    .filter((p) => p.purpose === style)
    .map((p) => p.description.toLowerCase());

  const score = (c: Cluster) => {
    const haystack = `${c.name} ${c.attractions.join(" ")}`.toLowerCase();
    let matches = 0;
    for (const phrase of phrases) {
      // Match on distinctive words rather than whole sentences.
      const words = phrase.split(/\W+/).filter((w) => w.length > 4);
      const hits = words.filter((w) => haystack.includes(w)).length;
      if (hits >= 2) matches++;
    }

    let ruleScore = 0;
    for (const entry of bias) {
      if (entry.tokens.some((t) => tokenMatchesCluster(t, haystack))) {
        ruleScore += entry.bias * RULE_BIAS_WEIGHT;
      }
    }

    return matches * 10 + c.attractions.length + ruleScore;
  };

  return [...clusters].sort((a, b) => score(b) - score(a));
}

/**
 * How strongly a fired rule moves a cluster in the ranking.
 *
 * Comparable to one purpose-phrase match, so a rule is influential without
 * being able to drag an otherwise irrelevant cluster to the top of the list.
 */
const RULE_BIAS_WEIGHT = 12;

/**
 * Whether a rule's target names this cluster.
 *
 * Rule tokens are workbook-style identifiers turned into words ("TAJ MAHAL
 * SUNRISE"), and the cluster they refer to is rarely titled identically, so
 * the test is on the distinctive words they share. Two is the threshold: one
 * shared common word ("city", "temple") is noise, two is a reference.
 */
function tokenMatchesCluster(token: string, haystack: string): boolean {
  const words = token.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (!words.length) return false;
  const hits = words.filter((w) => haystack.includes(w)).length;
  return words.length === 1 ? hits === 1 : hits >= 2;
}

/** A cluster rendered as a plannable, priceable activity. */
function toActivity(cluster: Cluster, priceLookup: (cluster: Cluster) => { code: string | null; price: number }): PlannedActivity {
  const { code, price } = priceLookup(cluster);
  return {
    clusterId: cluster.id,
    code,
    title: cluster.name,
    hours: cluster.durationHours,
    attractions: cluster.attractions,
    walkingIntensity: cluster.walkingIntensity,
    locked: false,
    pricePerPersonInr: price,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DayPlanInput = {
  stays: PlaceStay[];
  startDate: string;
  style: TripStyle;
  pace: keyof typeof DAY.pace;
  group: GroupProfile;
  bundles: Map<string, DestinationBundle>;
  routes: RouteLookup;
  mealPlan: { lunch: boolean; dinner: boolean };
  excludedClusterIds: Set<string>;
  /** Clusters the traveller asked for; packed ahead of the ranker's picks. */
  pinnedClusterIds: Set<string>;
  /**
   * "manual" plans only the pinned clusters; everything else is offered as an
   * add-on rather than backfilling the day. Absent means "auto".
   */
  sightseeingMode?: "auto" | "manual";
  /** How hard to trade fare against journey time on intercity legs. */
  transportPreference: TransportPreference;
  /** Per-leg mode the traveller pinned, keyed by the arriving place's id. */
  legModes: Record<string, TransportMode>;
  /**
   * Set when the trip bills one all-in vehicle per day (all-India trips). A road
   * leg then adds no fare of its own, and is the default way to make any leg
   * whose drive is at most `maxMinutes` (unless the traveller wants the fastest).
   */
  roadFirst?: { maxMinutes: number } | null;
  /** Resolves a cluster to its priced activity code and per-person price. */
  priceLookup: (placeId: string, cluster: Cluster) => { code: string | null; price: number };
  /**
   * Ranking nudges from the destination's own decision rules that fired for
   * this trip, keyed by place. Optional: with none supplied the planner ranks
   * exactly as it did before.
   */
  clusterBiasFor?: (placeId: string) => { tokens: string[]; bias: number }[];
  /**
   * The airports the trip lands at and leaves from, and how long the road from
   * each to its hotel takes. Present on a trip that flies in from abroad, so the
   * first and last days name the airport instead of a bare "Airport".
   */
  gateways?: {
    arrival: AirportRef & { kind?: "airport" | "rail" };
    arrivalMinutes: number | null;
    departure: AirportRef & { kind?: "airport" | "rail" };
    departureMinutes: number | null;
    /**
     * Clock time (minutes after midnight) the traveller reaches the arrival
     * port. When known, the first day only gets the daylight that is left once
     * they are at the hotel; an evening arrival is a rest day.
     */
    arrivalClockMin?: number | null;
    /** Whole days of travel before the arrival day (an overnight train is 1). */
    daysEnRoute?: number;
  } | null;
  /**
   * The day (1-based, across the whole trip) the traveller wants an outing on,
   * keyed by cluster id. Honoured only for a day spent at that outing's own
   * destination and while the day stays under the daily sightseeing cap.
   */
  clusterDays?: Record<string, number>;
};

/**
 * Builds stand-in clusters for a place that has priced activities but no
 * geographical clusters of its own.
 *
 * Without this a destination with no knowledge file is planned as empty days
 * and charged nothing for sightseeing, which both reads badly and undercuts the
 * quote. Each priced activity becomes a half-day outing instead.
 */
function syntheticClusters(bundle: DestinationBundle | undefined, placeId: string): Cluster[] {
  if (!bundle || bundle.clusters.length) return [];

  // Prefer the workbook's priced activities; fall back to named attractions.
  const fromRates = bundle.activityRates.map((rate) => {
    const activity = bundle.activities.find((a) => a.code === rate.code);
    return activity?.name ?? rate.code.replace(/^[A-Z0-9]+_A_/i, "").replace(/_/g, " ");
  });
  const names = fromRates.length
    ? fromRates
    : bundle.attractions.slice(0, 8).map((a) => a.name);

  return names.map((name, i) => ({
    id: `${placeId}:auto:${i}`,
    placeId,
    name,
    attractions: [name],
    recommendedDuration: "Half day",
    durationHours: 4,
    walkingIntensity: "MEDIUM" as const,
  }));
}

export type DayPlanResult = {
  days: PlannedDay[];
  /** Clusters that did not fit, offered as paid add-ons. */
  suggestions: PlannedActivity[];
  /** Every cluster at every stay and where it ended up, for the admin's picker. */
  options: SightseeingOption[];
  /**
   * Legs whose journey time did not fit inside the nights booked at the
   * destination it arrives at, even after giving it every day the stay had.
   * The plan still shows a day-by-day itinerary that stays truthful to the
   * calendar rather than silently pretending the transfer took one day, but
   * this list is what tells the traveller the numbers do not add up.
   */
  transitOverflows: TransitOverflow[];
  /**
   * Outings the traveller put on a day that could not take them: a day at a
   * different destination, or one the daily sightseeing cap left no room on.
   */
  unplacedDayChoices: { clusterId: string; title: string; day: number; reason: "wrong-place" | "no-room" }[];
};

export type TransitOverflow = {
  from: string;
  to: string;
  mode: TransportMode | "transfer";
  durationMinutes: number;
  /** Calendar days the journey actually needs, at a realistic pace. */
  daysRequired: number;
  /** Calendar days the stay could spare for it. */
  daysAvailable: number;
};

export function planDays(input: DayPlanInput): DayPlanResult {
  const {
    stays, startDate, style, pace, group, bundles, routes, mealPlan, excludedClusterIds,
    pinnedClusterIds, transportPreference, legModes, priceLookup, clusterBiasFor, roadFirst, gateways,
  } = input;
  const manual = input.sightseeingMode === "manual";

  const days: PlannedDay[] = [];
  const suggestions: PlannedActivity[] = [];
  const options: SightseeingOption[] = [];
  const transitOverflows: TransitOverflow[] = [];
  const unplacedDayChoices: DayPlanResult["unplacedDayChoices"] = [];
  const dayChoice = input.clusterDays ?? {};
  const sightseeingCap = policy.dayPlanning.maxSightseeingHoursPerDay;

  const totalNights = stays.reduce((a, s) => a + s.nights, 0);
  const totalDays = totalNights + 1;
  let dayNumber = 0;

  // A place can be visited twice (Bangkok, Pattaya, Bangkok). Its outings are
  // ranked once and shared across the visits, so none repeats, and what is left
  // over is offered once, after the last visit.
  const lastVisit = new Map<string, number>();
  stays.forEach((s, i) => lastVisit.set(s.placeId, i));
  const planned = new Map<string, { available: Cluster[]; queue: Cluster[]; notChosen: Cluster[] }>();

  for (let stayIndex = 0; stayIndex < stays.length; stayIndex++) {
    const stay = stays[stayIndex];
    const bundle = bundles.get(stay.placeId);
    const isFirst = stayIndex === 0;
    const isLast = stayIndex === stays.length - 1;

    // Rank once per place, then consume the queue across that place's days so a
    // cluster is never repeated. Places with no clusters of their own fall back
    // to their priced activities so the days are neither empty nor free.
    let state = planned.get(stay.placeId);
    if (!state) {
      const available = bundle?.clusters.length
        ? bundle.clusters
        : syntheticClusters(bundle, stay.placeId);
      // Switched-off outings are still planned, so they hold their slot and the
      // traveller can tick them again; they are split out of the billed list
      // once the day is packed.
      const candidates = available;
      // In manual mode the admin's ticked list is the itinerary: only pinned
      // clusters are planned and the rest wait as add-ons instead of backfilling.
      const notChosen = manual ? candidates.filter((c) => !pinnedClusterIds.has(c.id)) : [];
      const queue = rankClusters(
        manual ? candidates.filter((c) => pinnedClusterIds.has(c.id)) : candidates,
        bundle?.purposeActivities ?? [],
        style,
        clusterBiasFor?.(stay.placeId) ?? [],
      );

      // Anything the traveller explicitly asked for jumps the queue, so it is
      // packed before the ranker's own preferences. `sort` is stable, so the
      // ranking order still decides within each group. It does not get special
      // treatment on capacity: it competes for the same daily budget, which is
      // what keeps a day inside the sightseeing cap no matter what is pinned.
      if (pinnedClusterIds.size) {
        queue.sort(
          (a, b) => Number(pinnedClusterIds.has(b.id)) - Number(pinnedClusterIds.has(a.id)),
        );
      }
      state = { available, queue, notChosen };
      planned.set(stay.placeId, state);
    }
    const { available, queue, notChosen } = state;

    // The arrival leg into this place: an airport transfer for the first stay,
    // an intercity hop thereafter.
    let transfer: TransferLeg | null = null;
    if (isFirst) {
      transfer = {
        from: gateways ? `${gateways.arrival.name} (${gateways.arrival.iata})` : "Airport",
        to: stay.placeName,
        mode: "transfer",
        durationMinutes: gateways?.arrivalMinutes ?? 60,
        onsiteMode: null,
        priceInr: 0, // priced separately as an airport transfer line item
        estimated: false,
        distanceKm: null,
        via: [],
        alternatives: [],
        userChosen: false,
      };
    } else {
      const previous = stays[stayIndex - 1];
      // Returning to a place already visited needs its own key, so the traveller
      // can pin the way back to Bangkok without changing the way out of it.
      const legKey = stay.visit ? `${stay.placeId}#${stay.visit}` : stay.placeId;
      // Every viable mode, best-first for the trip's preference. The
      // traveller can pin a different one per leg; if the pinned mode is no
      // longer offered (they changed destinations), fall back to the best.
      const choices = routes.options(previous.placeId, stay.placeId, transportPreference, group.paxTotal);
      const pinned = legModes[legKey];
      const roadHop =
        roadFirst && transportPreference !== "fastest"
          ? choices.find(
              (c) =>
                c.mode === "private_vehicle" &&
                (transportPreference === "cheapest" || c.minutes <= roadFirst.maxMinutes),
            )
          : undefined;
      const hop = (pinned && choices.find((c) => c.mode === pinned)) ?? roadHop ?? choices[0] ?? null;
      // A road leg on a day-rate trip runs in the vehicle already paid for.
      const inVehicle = (mode: string | undefined) => Boolean(roadFirst) && mode === "private_vehicle";
      transfer = {
        from: previous.placeName,
        to: stay.placeName,
        mode: hop?.mode ?? "transfer",
        durationMinutes: hop?.minutes ?? null,
        onsiteMode: hop?.onsiteMode ?? null,
        priceInr: inVehicle(hop?.mode) ? 0 : (hop?.priceInr ?? 0),
        estimated: hop?.estimated ?? false,
        distanceKm: hop?.distanceKm ?? null,
        via: hop?.via ?? [],
        alternatives: choices.map((c) => ({
          mode: c.mode,
          minutes: c.minutes,
          priceInr: inVehicle(c.mode) ? 0 : Math.round(c.priceInr),
          estimated: c.estimated,
          car: c.car,
          ...(inVehicle(c.mode) ? { includedInVehicle: true } : {}),
        })),
        userChosen: Boolean(pinned && hop && hop.mode === pinned),
        car: hop?.car,
        ...(inVehicle(hop?.mode) ? { includedInVehicle: true } : {}),
        legKey,
      };
    }

    // A flight lands at an airport, not at the hotel. Attach the ground link at
    // each end — place -> its airport, airport -> the arrival place — each with
    // its own mode choice, so a destination without an airport of its own
    // (Interlaken is served by Zurich) is never left with a missing leg.
    // (On a day-rate trip the vehicle that runs the sightseeing also does the
    // airport runs, so there are no separate links to bill.)
    if (!isFirst && transfer?.mode === "flight" && !roadFirst) {
      const previous = stays[stayIndex - 1];
      const out = routes.airportAccess(previous.placeId, transportPreference, group.paxTotal);
      const inn = routes.airportAccess(stay.placeId, transportPreference, group.paxTotal);
      const links: AirportLink[] = [];
      const build = (
        key: string,
        direction: AirportLink["direction"],
        access: NonNullable<typeof out>,
        placeName: string,
      ) => {
        const pinned = legModes[key];
        const hop = (pinned && access.options.find((c) => c.mode === pinned)) ?? access.options[0];
        links.push({
          key,
          direction,
          from: direction === "to-airport" ? placeName : access.name,
          to: direction === "to-airport" ? access.name : placeName,
          airportIata: access.iata,
          airportName: access.name,
          distanceKm: access.distanceKm,
          mode: hop.mode,
          minutes: hop.minutes,
          priceInr: Math.round(hop.priceInr),
          estimated: hop.estimated,
          alternatives: access.options.map((c) => ({
            mode: c.mode, minutes: c.minutes, priceInr: Math.round(c.priceInr), estimated: c.estimated, car: c.car,
          })),
          userChosen: Boolean(pinned && hop.mode === pinned),
          car: hop.car,
        });
      };
      // Same airport at both ends means there is no flight to take.
      if (!(out && inn && out.iata === inn.iata)) {
        const visitKey = stay.visit ? `${stay.placeId}#${stay.visit}` : stay.placeId;
        if (out) build(`air-out:${visitKey}`, "to-airport", out, previous.placeName);
        if (inn) build(`air-in:${visitKey}`, "from-airport", inn, stay.placeName);
      }
      if (links.length) transfer = { ...transfer, airportLinks: links };
    }

    // Days spent at this place. The final stay gets one extra day for departure.
    const dayCount = stay.nights + (isLast ? 1 : 0);
    const stayFirstDay = dayNumber + 1;
    const stayLastDay = dayNumber + dayCount;
    /** A cluster the traveller put on one of this stay's days, other than today. */
    const reservedForAnotherDay = (c: Cluster, today: number) => {
      const wanted = dayChoice[c.id];
      return wanted != null && wanted >= stayFirstDay && wanted <= stayLastDay && wanted !== today;
    };

    // A transfer that takes longer than one calendar day's realistic
    // waking-plus-rest window (`maxActiveHours`, 14h — the same "at least
    // restHours of rest" ceiling every other day is held to) is not folded
    // into a single arrival day: physically, the traveller is still
    // travelling into the next calendar day(s). Every extra block is carved
    // out of *this* stay's own night count as a dedicated low/no-activity
    // transit day, rather than one day quietly absorbing the whole thing
    // regardless of how long it actually is.
    const usableMinutesPerDay = DAY.maxActiveHours * 60;
    const rawTransferDays = transfer?.durationMinutes
      ? Math.max(1, Math.ceil(transfer.durationMinutes / usableMinutesPerDay))
      : 1;
    // Never let transit claim every day the stay has: the final stay must
    // keep its departure day free, and a mid-trip stay should not be pared
    // to nothing without at least surfacing why.
    const maxTransferDays = isLast ? Math.max(1, dayCount - 1) : dayCount;
    const transferDays = Math.min(rawTransferDays, maxTransferDays);
    if (rawTransferDays > maxTransferDays && transfer?.durationMinutes) {
      transitOverflows.push({
        from: transfer.from,
        to: transfer.to,
        mode: transfer.mode,
        durationMinutes: transfer.durationMinutes,
        daysRequired: rawTransferDays,
        daysAvailable: maxTransferDays,
      });
    }

    for (let d = 0; d < dayCount; d++) {
      dayNumber++;
      const isArrivalDay = d === 0;
      // Later days still swallowed by the same journey — no hotel checkout,
      // no attractions, just the road, rail or water continuing underneath.
      const isTransitContinuation = !isArrivalDay && d < transferDays;
      const isDepartureDay = isLast && d === dayCount - 1;
      const kind = isDepartureDay
        ? "departure"
        : isArrivalDay || isTransitContinuation
          ? isFirst
            ? "arrival"
            : "transfer"
          : "full";

      let budget = dayBudget(pace, group, kind);
      // The road to the airport is part of the last day.
      if (isDepartureDay && gateways?.departureMinutes) {
        budget = Math.max(0, budget - gateways.departureMinutes / 60);
      }

      // The first day only has what is left of the daylight once the traveller
      // is at the hotel: arriving in the evening leaves no trip at all, and
      // below a few hours it is not worth planning an outing into.
      let arrival: PlannedDay["arrival"];
      if (isFirst && isArrivalDay && gateways?.arrivalClockMin != null) {
        const a = arrivalDay(gateways.arrivalClockMin, gateways.arrivalMinutes ?? 60);
        arrival = { atHotel: clock(a.hotelClockMin), restDay: a.restDay, usableHours: Number(a.usableHours.toFixed(1)) };
        budget = Math.min(budget, a.usableHours);
      }

      // A long transfer eats into the same 24 hours as sightseeing — and,
      // spread over several days, each day only absorbs its own share of the
      // remaining journey rather than the whole thing landing on day one.
      if ((isArrivalDay || isTransitContinuation) && transfer?.durationMinutes && !arrival) {
        const minutesElapsedBefore = d * usableMinutesPerDay;
        const minutesLeft = Math.max(0, transfer.durationMinutes - minutesElapsedBefore);
        budget = Math.max(0, budget - Math.min(usableMinutesPerDay, minutesLeft) / 60);
      }

      const placed: PlannedActivity[] = [];
      let used = 0;

      /** Walking tolerance is a property of the cluster, not of the day. */
      const allowanceFor = (cluster: Cluster) => {
        const factor =
          DAY.walkingBudgetFactor[
            (cluster.walkingIntensity ?? "MEDIUM") as keyof typeof DAY.walkingBudgetFactor
          ] ?? 0.9;
        return budget * factor;
      };

      // Outings the traveller put on this very day go in first, up to the daily
      // sightseeing cap (not the day's budget: they asked for it).
      for (const cluster of queue.filter((c) => dayChoice[c.id] === dayNumber)) {
        if (used + cluster.durationHours > sightseeingCap + 1e-9) continue;
        queue.splice(queue.indexOf(cluster), 1);
        placed.push({ ...toActivity(cluster, (c) => priceLookup(stay.placeId, c)), slot: placed.length });
        used += cluster.durationHours;
      }

      // Best-first packing: take the highest-ranked cluster that still fits.
      let guard = 0;
      while (queue.length && guard++ < 50) {
        const index = queue.findIndex(
          (c) => !reservedForAnotherDay(c, dayNumber) && used + c.durationHours <= allowanceFor(c),
        );
        if (index < 0) break;
        const [cluster] = queue.splice(index, 1);
        placed.push({ ...toActivity(cluster, (c) => priceLookup(stay.placeId, c)), slot: placed.length });
        used += cluster.durationHours;
      }

      // A full-day cluster never fits a relaxed day with young children, but
      // dropping it entirely would leave the traveller with an empty itinerary.
      // Shorten the visit instead, which is what an agent actually does.
      const partialIndex = queue.findIndex((c) => !reservedForAnotherDay(c, dayNumber));
      if (!placed.length && partialIndex >= 0 && budget >= DAY.minPartialVisitHours) {
        const [cluster] = queue.splice(partialIndex, 1);
        const hours = Math.min(cluster.durationHours, Math.max(DAY.minPartialVisitHours, allowanceFor(cluster)));
        const activity = toActivity(cluster, (c) => priceLookup(stay.placeId, c));
        placed.push({ ...activity, hours: Number(hours.toFixed(1)), slot: 0 });
        used += hours;
      }

      // Split what is billed from what the traveller has switched off. The
      // day's hours count only what is still in the plan.
      const activities = placed.filter((a) => !(a.clusterId && excludedClusterIds.has(a.clusterId)));
      const excludedActivities = placed.filter((a) => a.clusterId && excludedClusterIds.has(a.clusterId));
      used = activities.reduce((sum, a) => sum + a.hours, 0);

      const notes: string[] = [];
      if (isArrivalDay && isFirst) {
        const verb = gateways?.arrival.kind === "rail" ? "Arrive at" : "Land at";
        notes.push(
          gateways
            ? `${verb} ${gateways.arrival.name} (${gateways.arrival.iata}), transfer to ${stay.placeName} and check in` +
                (gateways.arrivalMinutes ? ` — about ${formatDuration(gateways.arrivalMinutes)} by road` : "")
            : "Arrival and hotel check-in",
        );
        if (arrival) {
          notes.push(
            arrival.restDay
              ? `Reach the hotel about ${arrival.atHotel} — too late in the day for sightseeing, so today is a rest day`
              : `Reach the hotel about ${arrival.atHotel} — only ${arrival.usableHours}h of daylight is left, so today is kept light`,
          );
        }
        if (gateways?.daysEnRoute) notes.push("The train leaves the evening before");
        if (gateways?.arrivalClockMin != null && gateways.arrivalClockMin + (gateways.arrivalMinutes ?? 0) >= 22 * 60) {
          notes.push("That is a late-night drive — consider staying near the arrival point and setting off in the morning");
        }
      }
      if (isArrivalDay && !isFirst && transfer) {
        notes.push(
          transferDays > 1
            ? `Transfer from ${transfer.from} to ${transfer.to} — day 1 of ${transferDays} ` +
              `(${formatDuration(transfer.durationMinutes ?? 0)} total journey)`
            : `Transfer from ${transfer.from} to ${transfer.to}`,
        );
      }
      if (isTransitContinuation && transfer) {
        notes.push(`Still travelling from ${transfer.from} to ${transfer.to} — day ${d + 1} of ${transferDays}`);
      }
      if (isDepartureDay) {
        notes.push(
          gateways
            ? `Check out and transfer to ${gateways.departure.name} (${gateways.departure.iata}) for the ${gateways.departure.kind === "rail" ? "train or coach" : "flight"} home` +
                (gateways.departureMinutes ? ` — about ${formatDuration(gateways.departureMinutes)} by road` : "")
            : "Check-out and departure transfer",
        );
      }
      // Nothing fit this day's budget and it is not otherwise spoken for
      // (arrival/transfer/departure) — the stay is longer than there is
      // content to fill at this pace. Flagged as `isFreeDay` rather than left
      // as a silent gap, so the caller can warn the traveller about it.
      const isFreeDay = !placed.length && !notes.length;
      if (isFreeDay) notes.push("Free day at leisure");

      days.push({
        dayNumber,
        date: addDays(startDate, dayNumber - 1),
        placeId: stay.placeId,
        placeName: stay.placeName,
        // Only the arrival day carries the priced leg, so a multi-day
        // journey's fare is billed once, not once per day it spans.
        isTransferDay: isArrivalDay && !isFirst,
        isFreeDay,
        transfer: isArrivalDay ? transfer : null,
        activities,
        excludedActivities,
        activeHours: Number(used.toFixed(1)),
        budgetHours: Number(budget.toFixed(1)),
        // No hotel on the very last day — the traveller flies home.
        hotelPlaceId: dayNumber < totalDays ? stay.placeId : null,
        meals: {
          breakfast: dayNumber > 1, // first night's breakfast is the next morning
          lunch: mealPlan.lunch && !isDepartureDay,
          dinner: mealPlan.dinner && !isDepartureDay,
        },
        notes,
        ...(arrival ? { arrival } : {}),
        ...(gateways && isArrivalDay && isFirst
          ? { airport: { kind: "arrival" as const, iata: gateways.arrival.iata, name: gateways.arrival.name, ...(gateways.arrival.kind === "rail" ? { hub: "rail" as const } : {}) } }
          : gateways && isDepartureDay
            ? { airport: { kind: "departure" as const, iata: gateways.departure.iata, name: gateways.departure.name, ...(gateways.departure.kind === "rail" ? { hub: "rail" as const } : {}) } }
            : {}),
      });
    }

    // A place visited again is not finished with: its queue carries on.
    if (lastVisit.get(stay.placeId) !== stayIndex) continue;

    // Anything left over becomes an upsell rather than being silently dropped.
    for (const cluster of [...queue, ...notChosen]) {
      if (excludedClusterIds.has(cluster.id)) continue; // switched off and never placed: nothing to offer
      suggestions.push(toActivity(cluster, (c) => priceLookup(stay.placeId, c)));
    }

    // Everything the stay has to offer, with where it landed. What is neither
    // switched off nor left over made it into a day.
    const leftover = new Set([...queue, ...notChosen].map((c) => c.id));
    for (const cluster of available) {
      const status = excludedClusterIds.has(cluster.id) ? "excluded" : leftover.has(cluster.id) ? "unscheduled" : "planned";
      options.push({
        ...toActivity(cluster, (c) => priceLookup(stay.placeId, c)),
        placeId: stay.placeId,
        placeName: stay.placeName,
        status,
      });
    }
  }

  // Day choices that never landed: wrong destination, or no room under the cap.
  const idsOnDay = new Map<number, Set<string | null>>();
  for (const d of days) idsOnDay.set(d.dayNumber, new Set(d.activities.concat(d.excludedActivities).map((a) => a.clusterId)));
  const stayDays = new Map<string, number[]>();
  for (const d of days) stayDays.set(d.placeId, [...(stayDays.get(d.placeId) ?? []), d.dayNumber]);
  const everyCluster = new Map<string, { placeId: string; title: string }>();
  for (const [placeId, st] of planned) for (const c of st.available) everyCluster.set(c.id, { placeId, title: c.name });
  for (const [clusterId, day] of Object.entries(dayChoice)) {
    const c = everyCluster.get(clusterId);
    if (!c) continue;
    if (!(stayDays.get(c.placeId) ?? []).includes(day)) {
      unplacedDayChoices.push({ clusterId, title: c.title, day, reason: "wrong-place" });
    } else if (!idsOnDay.get(day)?.has(clusterId)) {
      unplacedDayChoices.push({ clusterId, title: c.title, day, reason: "no-room" });
    }
  }

  return { days, suggestions, options, transitOverflows, unplacedDayChoices };
}
