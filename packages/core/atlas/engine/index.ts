/**
 * The quotation engine.
 *
 * Pure, deterministic and synchronous: the same request against the same
 * compiled data always yields the same quotation. No model, no network — live
 * rates, when present, are supplied by the caller as plain data.
 */
import policy from "../../../../content/quote-policy.json";
import type {
  Cluster,
  CoreBundle,
  DestinationBundle,
  PlaceSummary,
  RateSource,
  Route,
  TravellerType,
  TripStyle,
  VisaRule,
} from "../schema";
import { buildRouteLookup, buildStays, matchReferencePackage, styleScore } from "./itinerary";
import { planningNotes, seasonalityWarnings, suitabilityWarnings } from "./advisories";
import { clusterBias, fireRules, type RuleEvaluation, type RuleFacts } from "./rules";
import type {
  AppliedRule,
  PlannedActivity,
  PortOfEntryInfo,
  Quotation,
  QuoteRequest,
  QuoteWarning,
} from "./types";
import { planDays, type GroupProfile } from "./dayplan";
import { applyLiveFx, type FxAdjustment, type FxRates } from "./fx";
import { indiaGroundApplies, indiaRoadFirst, isDomesticTrip, priceQuotation, resolvePax, type LiveRate } from "./pricing";
import { normaliseKey, formatDuration } from "./text";
import { filterRealisticSelection } from "./bounds";
import { haversineKm } from "./geo";
import { airportDistanceKm, chooseAirport, type GatewayInfo } from "./gateway";
import { choosePortOfEntry, clock, entryOptions, pickEntry, roadLeg, type Hub } from "./entry";

/** Default trip style for each traveller type; the planner lets it be changed. */
export const STYLE_FOR_TRAVELLER: Record<TravellerType, TripStyle> = {
  family: "family",
  couple: "romantic",
  friends: "adventure",
  stags: "adventure",
  business: "luxury",
  pilgrimage: "pilgrimage",
  solo: "culture",
};

export type EngineData = {
  core: CoreBundle;
  routes: Route[];
  visaRules: VisaRule[];
  /** Only the destinations referenced by the request need to be loaded. */
  bundles: Map<string, DestinationBundle>;
  liveRates?: Map<string, LiveRate>;
  /** Today's exchange rates, to keep rates quoted in USD/EUR in step with the rupee. */
  fxRates?: FxRates;
  /**
   * Disables the published-package price floor. Used by the calibration
   * harness, which must see the engine's own unassisted number — with the
   * floor on, every package would trivially match its own published price.
   */
  ignorePackageFloor?: boolean;
};

/**
 * Matches a cluster to a priced activity code.
 *
 * The workbook's activity codes are `{DEST}_A_{AREA}` where the area name comes
 * from the same source as the cluster names, so a normalised comparison joins
 * them. Where nothing matches, the cluster is planned but not charged for.
 */
/** Paid tickets one half-day cluster can carry. */
const MAX_TICKETS_PER_CLUSTER = 2;

export function buildActivityPricer(bundles: Map<string, DestinationBundle>) {
  const byPlace = new Map<string, { key: string; code: string; inr: number; source: RateSource }[]>();

  for (const [placeId, bundle] of bundles) {
    const rows = bundle.activityRates.map((rate) => ({
      key: normaliseKey(rate.code.replace(/^[A-Z0-9]+_A_/i, "")),
      code: rate.code,
      inr: rate.inr,
      source: rate.source,
    }));
    byPlace.set(placeId, rows);
  }

  // A paid rate is charged to one cluster only. Two clusters that both mention
  // "Grand World" must not each bill its ticket.
  const claimed = new Map<string, string>();
  const cache = new Map<string, { code: string | null; price: number; source: RateSource }>();

  /**
   * Rates the cluster's own attractions name, summed.
   *
   * Cluster titles are area names ("NORTH ISLAND / VINPEARL") while the rate
   * card is priced per ticket (VINWONDERS, SAFARI_PARK, GRAND_WORLD), so a
   * title-only match found nothing and Vietnam's headline paid attractions were
   * quoted at zero. The attraction lines inside the cluster do name them
   * ("Vin-Wonders Theme Park + Water Park"), so match against those too.
   */
  const byAttractions = (
    placeId: string,
    rows: { key: string; code: string; inr: number; source: RateSource }[],
    cluster: Cluster,
  ) => {
    const text = normaliseKey([cluster.name, ...(cluster.attractions ?? [])].join(" "));
    if (!text) return [];
    const compact = text.replace(/ /g, "");
    const tokens = new Set(text.split(" "));
    return rows.filter((row) => {
      if (row.inr <= 0) return false;
      const owner = claimed.get(`${placeId}|${row.code}`);
      if (owner && owner !== cluster.id) return false;
      const words = row.key.split(" ").filter((w) => w.length >= 4);
      const rowCompact = row.key.replace(/ /g, "");
      if (rowCompact.length >= 6 && compact.includes(rowCompact)) return true;
      if (!words.length) return false;
      const hit = words.filter((w) => tokens.has(w) || tokens.has(`${w}s`));
      if (hit.length === words.length) return true;
      // Compound rate names ("DOTONBORI + GLICO_SIGN + RIVER_CRUISE") are only partly
      // echoed by the attraction text: three of five words, the longest among them, is the same item.
      if (words.length >= 4 && hit.length / words.length >= 0.6 && hit.includes(words.reduce((a, b) => (b.length > a.length ? b : a)))) return true;
      // "SAFARI PARK" is "Vinpearl Safari Zoo": all but one word, and the one that
      // names the thing (the longest) is among those present.
      const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
      // At least six letters: "hills" alone must not turn "5 hills, caves, pagodas" into the Ba Na Hills cable-car ticket.
      return words.length >= 2 && longest.length >= 6 && hit.length >= words.length - 1 && hit.includes(longest);
    });
  };

  return (placeId: string, cluster: Cluster): { code: string | null; price: number; source: RateSource } => {
    const cached = cache.get(cluster.id);
    if (cached) return cached;
    const result = price(placeId, cluster);
    cache.set(cluster.id, result);
    return result;
  };

  function price(placeId: string, cluster: Cluster): { code: string | null; price: number; source: RateSource } {
    const rows = byPlace.get(placeId) ?? [];
    if (!rows.length) return { code: null, price: 0, source: "estimated" };

    const target = normaliseKey(cluster.name);
    const exact = rows.find((r) => r.key === target);
    if (exact) return { code: exact.code, price: exact.inr, source: exact.source };

    // A half-day cluster buys at most MAX_TICKETS paid tickets. Dubai's downtown
    // cluster names eight attractions that match five overlapping bundle prices,
    // which summed to ₹49,000 a head for one morning.
    const named = byAttractions(placeId, rows, cluster).sort((a, b) => b.inr - a.inr).slice(0, MAX_TICKETS_PER_CLUSTER);
    if (named.length) {
      for (const row of named) claimed.set(`${placeId}|${row.code}`, cluster.id);
      const top = named.reduce((a, b) => (b.inr > a.inr ? b : a));
      return {
        code: top.code,
        price: Math.round(named.reduce((sum, r) => sum + r.inr, 0)),
        source: named.every((r) => r.source === "workbook") ? "workbook" : "estimated",
      };
    }

    // Cluster names and area names overlap but are rarely identical
    // ("GIZA PYRAMIDS AND SPHINX" vs "GIZA_PYRAMIDS"); score on shared words.
    const words = target.split(" ").filter((w) => w.length > 3);
    let best: { row: (typeof rows)[number]; hits: number } | null = null;
    for (const row of rows) {
      const hits = words.filter((w) => row.key.includes(w)).length;
      if (hits && (!best || hits > best.hits)) best = { row, hits };
    }
    if (best) return { code: best.row.code, price: best.row.inr, source: best.row.source };

    // Otherwise charge the place's median activity rate — the cluster is real
    // sightseeing even if we cannot tie it to a specific priced line.
    const sorted = rows.map((r) => r.inr).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    return { code: null, price: median, source: "estimated" };
  }
}

function groupProfile(request: QuoteRequest): GroupProfile {
  return {
    hasYoungChildren: request.childAges.some((a) => a <= 7),
    hasSeniors: request.travellerType === "pilgrimage",
    paxTotal: request.adults + request.childAges.length,
  };
}

export function generateQuotation(request: QuoteRequest, data: EngineData): Quotation {
  const warnings: QuoteWarning[] = [];
  const { core, bundles, applied: fxApplied } = applyLiveFx(data.core, data.bundles, data.fxRates);

  const summaries = new Map<string, PlaceSummary>(core.placeSummaries.map((s) => [s.placeId, s]));
  const names = new Map(core.places.map((p) => [p.id, p.name]));

  // --- validate and trim the selection -------------------------------------
  const known = new Set(core.places.map((p) => p.id));
  let placeIds = request.placeIds.filter((id) => known.has(id));
  if (placeIds.length !== request.placeIds.length) {
    warnings.push({ level: "warning", audience: "traveller", message: "Some selected places are not in the catalogue and were dropped." });
  }

  // Backstop against an unrealistic combination reaching the engine by any
  // path other than the two live pickers (a future UI, a stale link, a
  // direct request) — the same region/country/place caps and pairwise
  // compatibility graph the pickers already enforce live, applied here too
  // so a quote can never be silently generated for a trip no agency would
  // actually sell. Processes in selection order and drops only what
  // breaches a rule, rather than truncating the whole list at a fixed count.
  const filtered = filterRealisticSelection(core, placeIds);
  placeIds = filtered.kept;
  if (filtered.dropped.length) {
    const placeName = new Map(core.places.map((p) => [p.id, p.name]));
    const byReason = new Map<string, string[]>();
    for (const d of filtered.dropped) {
      const name = placeName.get(d.placeId) ?? d.placeId;
      const list = byReason.get(d.reason);
      if (list) list.push(name);
      else byReason.set(d.reason, [name]);
    }
    for (const [reason, names] of byReason) {
      warnings.push({
        level: "warning",
        audience: "traveller",
        message: `${names.join(", ")} dropped — ${reason}.`,
      });
    }
  }
  if (!placeIds.length) throw new Error("No valid places selected");

  // Nights must at least cover one per place.
  let nights = request.nights;
  if (nights < placeIds.length) {
    nights = placeIds.length;
    warnings.push({
      level: "info",
      audience: "traveller",
      message: `Extended to ${nights} nights so each destination gets at least one night.`,
    });
  }

  for (const id of placeIds) {
    const place = core.places.find((p) => p.id === id);
    if (place && !place.hasContent) {
      warnings.push({
        level: "info",
        audience: "internal",
        message: `${place.name} has no destination file yet, so its days follow a generic plan.`,
      });
    }
  }

  // --- 1-2. allocate and sequence ------------------------------------------
  const routeLookup = buildRouteLookup(data.routes, core.places, core.countries, core.placeAirports);

  // The order places are visited in depends on where the traveller enters and
  // leaves the trip, not just on the hops between them.
  const gatewayCity = (core.departureCities ?? []).find((c) => c.code === request.departureCity);  const gateway =
    gatewayCity?.lat != null && gatewayCity.lon != null
      ? { lat: gatewayCity.lat, lon: gatewayCity.lon }
      : null;
  const placePoints = new Map<string, { lat: number; lon: number }>();
  for (const p of core.places) {
    if (p.lat != null && p.lon != null) placePoints.set(p.id, { lat: p.lat, lon: p.lon });
  }

  // A trip that flies in from abroad starts and ends at the airport city where
  // it can (Bangkok, Pattaya, Bangkok), rather than ending at a satellite town
  // two hours from the airport on the morning of the flight.
  const international = !isDomesticTrip(core, placeIds, request.nationality);

  // A trip inside the traveller's own country is built around a port of entry
  // (Guwahati for Arunachal, Bagdogra/NJP for Sikkim): the route starts at the
  // place nearest it, works outward and comes back through it.
  const port = international ? null : choosePortOfEntry(core, placeIds);
  const portPoint = port ? { lat: port.airport.lat, lon: port.airport.lon } : null;
  // Rule: two cities within 200 km share an arrival airport (land at the
  // airport city, visit the other, come back through it). Farther places are
  // destinations in their own right and are not folded into the port's city.
  const nearPort = (id: string) => {
    const p = core.places.find((x) => x.id === id);
    return !!port && !!p && p.lat != null && p.lon != null &&
      haversineKm({ lat: p.lat, lon: p.lon }, port.airport) <= 200;
  };
  const bookendCore: CoreBundle | null = port
    ? ({
        ...core,
        placeAirports: {
          ...core.placeAirports,
          ...Object.fromEntries(
            placeIds.filter(nearPort).map((id) => [
              id,
              { iata: port.airport.code, name: port.airport.name, lat: port.airport.lat, lon: port.airport.lon, source: "primary" },
            ]),
          ),
        },
      } as CoreBundle)
    : international
      ? core
      : null;
  const roadKmToPort = new Map<string, number>();
  if (port) {
    for (const id of placeIds) {
      const km = roadLeg(core, port.airport, id).km;
      if (km != null) roadKmToPort.set(id, km);
    }
  }
  const stays = buildStays(
    placeIds, nights, summaries, request.tripStyle, routeLookup, names, request.nightOverrides,
    portPoint ?? gateway, placePoints, bookendCore,
    port
      ? {
          // A place is a satellite of the port unless it is the port's own city.
          satellite: (id) => nearPort(id) && (roadKmToPort.get(id) ?? Infinity) > 40,
          roadKm: roadKmToPort,
        }
      : null,
  );
  if (stays.length > placeIds.length) {
    const first = stays[0];
    const last = stays[stays.length - 1];
    const returned = [...new Set(stays.filter((s) => (s.visit ?? 0) > 0).map((s) => s.placeId))];
    for (const id of returned) {
      const city = names.get(id) ?? id;
      const where = [first, last].filter((s) => s.placeId === id).length === 2 ? "at both ends" : "at the end";
      warnings.push({
        level: "info",
        audience: "traveller",
        message:
          `The trip lands and departs from ${city}, which has the ${port ? "port of entry" : "international airport"}. The nights there are split ` +
          `${where} of the trip, so the flight home starts from a hotel near the airport rather than from a long road transfer.`,
      });
    }
  }

  // --- 3. plan the days ----------------------------------------------------
  const pricer = buildActivityPricer(bundles);
  const activityPrices = new Map<string, { code: string | null; price: number; source: RateSource }>();

  // Evaluate each destination's own decision rules against this trip. Only the
  // rules that decisively apply fire; the rest are either not applicable or
  // rest on something the planner never asked, and are reported to the agent
  // rather than guessed at.
  const startMonth = new Date(`${request.startDate}T00:00:00Z`).getUTCMonth() + 1;
  const firedByPlace = new Map<string, RuleEvaluation[]>();
  const skippedRuleCount = new Map<string, number>();

  for (const stay of stays) {
    const rules = bundles.get(stay.placeId)?.decisionRules ?? [];
    if (!rules.length) continue;
    const summary = summaries.get(stay.placeId);
    const facts: RuleFacts = {
      // The rules are a destination's own, so `trip_length` is how long the
      // traveller is *there*, not how long they are away from home.
      nights: stay.nights,
      travellerType: request.travellerType,
      tripStyle: request.tripStyle,
      childAges: request.childAges,
      month: startMonth,
      monthWeather: summary?.monthWeather?.[String(startMonth)] ?? null,
      interests: request.interests,
      firstTimeVisitor: request.firstTimeVisitor,
    };
    const { fired, skipped } = fireRules(rules, facts);
    if (fired.length) firedByPlace.set(stay.placeId, fired);
    if (skipped.length) skippedRuleCount.set(stay.placeId, skipped.length);
  }

  // The airport each end of the trip uses: the place's listed airport, or the
  // cheapest of its metro's airports when a live fare says so.
  const gatewayFor = (placeId: string): GatewayInfo | null => {
    const countryId = core.places.find((p) => p.id === placeId)?.countryId;
    const fare = data.liveRates?.get(`flight:${request.departureCity}:${countryId}:${request.carrier}`);
    const chosen = chooseAirport(core, placeId, fare?.provider === "google-flights" ? fare.airportIata : undefined);
    if (!chosen) return null;
    return {
      iata: chosen.airport.iata,
      name: chosen.airport.name,
      placeId,
      placeName: names.get(placeId) ?? placeId,
      distanceKm: airportDistanceKm(core, placeId),
      alternatives: chosen.alternatives,
      basis: chosen.basis,
    };
  };
  const arrivalGateway = international && stays.length ? gatewayFor(stays[0].placeId) : null;
  let departureGateway = international && stays.length ? gatewayFor(stays[stays.length - 1].placeId) : null;
  // A round trip flies home from the airport it landed at when that airport also serves the last stay.
  if (arrivalGateway && departureGateway && departureGateway.iata !== arrivalGateway.iata) {
    const sameCountry =
      core.places.find((p) => p.id === stays[0].placeId)?.countryId ===
      core.places.find((p) => p.id === stays[stays.length - 1].placeId)?.countryId;
    const shared = departureGateway.alternatives.find((a) => a.iata === arrivalGateway.iata);
    if (sameCountry && shared) {
      departureGateway = { ...departureGateway, iata: shared.iata, name: shared.name, basis: arrivalGateway.basis };
    }
  }
  // A domestic trip: how the traveller reaches the port from home, the clock time
  // they get there, and the road from the port to the first and last stay.
  let portInfo: PortOfEntryInfo | undefined;
  let entryForPricing: Parameters<typeof priceQuotation>[0]["entry"] = null;
  let domesticGateways: Parameters<typeof planDays>[0]["gateways"] = null;
  if (port && stays.length) {
    const homeCity = (core.departureCities ?? []).find((c) => c.code === request.departureCity);
    const homePoint = homeCity?.lat != null && homeCity.lon != null ? { lat: homeCity.lat, lon: homeCity.lon } : null;
    const options = homePoint ? entryOptions(homePoint, port) : [];
    const chosen = pickEntry(options, request.transportPreference, request.entryMode);
    const hub: Hub = chosen?.hub ?? port.airport;
    const firstStay = stays[0];
    const lastStay = stays[stays.length - 1];
    const inbound = roadLeg(core, hub, firstStay.placeId);
    const outbound = roadLeg(core, hub, lastStay.placeId);
    const homeLabel = homeCity ? `${homeCity.label} (${homeCity.code})` : request.departureCity;
    domesticGateways = {
      arrival: { iata: hub.code, name: hub.name, kind: hub.kind },
      arrivalMinutes: inbound.minutes,
      departure: { iata: hub.code, name: hub.name, kind: hub.kind },
      departureMinutes: outbound.minutes,
      arrivalClockMin: chosen?.arrivesAtMin ?? null,
      daysEnRoute: chosen?.daysEnRoute ?? 0,
    };
    if (chosen) {
      entryForPricing = {
        mode: chosen.mode, homeLabel: homeCity?.label ?? request.departureCity, hubName: hub.name, hubCode: hub.code,
        minutes: chosen.minutes, oneWayFareInr: chosen.fareInr,
      };
    }
    const alt = hub.code === port.airport.code ? port.rail : port.airport;
    portInfo = {
      code: hub.code,
      name: hub.name,
      kind: hub.kind,
      serves: port.servesPlaceIds.map((id) => names.get(id) ?? id),
      entry: chosen
        ? {
            mode: chosen.mode,
            from: homeLabel,
            minutes: chosen.minutes,
            fareInr: chosen.fareInr * 2,
            arrivesAt: clock(chosen.arrivesAtMin),
            daysEnRoute: chosen.daysEnRoute,
            userChosen: Boolean(request.entryMode && request.entryMode === chosen.mode),
            options: options.map((o) => ({
              mode: o.mode, hub: o.hub.name, minutes: o.minutes, roundTripFareInr: o.fareInr * 2, arrivesAt: clock(o.arrivesAtMin),
            })),
          }
        : null,
      firstStay: { place: firstStay.placeName, ...inbound },
      lastStay: { place: lastStay.placeName, ...outbound },
      alternativeHub: alt ? { code: alt.code, name: alt.name, kind: alt.kind } : null,
    };
    if (outbound.minutes != null && outbound.minutes > 360) {
      warnings.push({
        level: "warning",
        audience: "traveller",
        message:
          `The last day is a ${formatDuration(outbound.minutes)} drive from ${lastStay.placeName} back to ${hub.name}, ` +
          "so a flight or train home the same day is not realistic. Book it for the next day, or add a night near the port.",
      });
    }
  }

  // By road from the airport at about 50 km/h on a 1.3x winding path, never under 45 minutes.
  const roadMinutes = (g: GatewayInfo | null) =>
    g?.distanceKm != null ? Math.max(45, Math.round(((g.distanceKm * 1.3) / 50) * 60)) : null;

  const plan = planDays({
    clusterDays: request.clusterDays,
    gateways:
      domesticGateways ??
      (arrivalGateway && departureGateway
        ? {
            arrival: { iata: arrivalGateway.iata, name: arrivalGateway.name },
            arrivalMinutes: roadMinutes(arrivalGateway),
            departure: { iata: departureGateway.iata, name: departureGateway.name },
            departureMinutes: roadMinutes(departureGateway),
          }
        : null),
    stays,
    startDate: request.startDate,
    style: request.tripStyle,
    pace: request.pace,
    group: groupProfile(request),
    bundles,
    routes: routeLookup,
    mealPlan: policy.meals.plans[request.mealPlan],
    excludedClusterIds: new Set(request.excludedClusterIds),
    pinnedClusterIds: new Set(request.pinnedClusterIds),
    sightseeingMode: request.sightseeingMode,
    transportPreference: request.transportPreference,
    legModes: request.legModes,
    roadFirst: indiaGroundApplies(core, stays.map((s) => s.placeId)) ? indiaRoadFirst() : null,
    clusterBiasFor: (placeId) => clusterBias(firedByPlace.get(placeId) ?? []),
    priceLookup: (placeId, cluster) => {
      const priced = pricer(placeId, cluster);
      activityPrices.set(cluster.id, priced);
      return { code: priced.code, price: priced.price };
    },
  });

  // Nights booked at a place beyond what there is to see become empty days —
  // no traveller wants "free day at leisure" as a surprise, only as something
  // they explicitly chose. Warn plainly and point at the fix, rather than
  // letting the day cards quietly carry the news on their own.
  const freeDays = plan.days.filter((d) => d.isFreeDay);
  if (freeDays.length) {
    const byPlace = new Map<string, number>();
    for (const d of freeDays) byPlace.set(d.placeName, (byPlace.get(d.placeName) ?? 0) + 1);
    const placeList = [...byPlace.entries()].map(([name, count]) => `${count} in ${name}`).join(", ");
    const hasSuggestions = plan.suggestions.length > 0;
    warnings.push({
      level: "warning",
      audience: "traveller",
      message:
        `${freeDays.length} free day(s) at leisure (${placeList}) — the trip is booked with more nights ` +
        "than there is planned to fill at this pace. " +
        (hasSuggestions
          ? "Add one of the suggested extras below, or shorten the stay."
          : "Shorten the stay, or pick a more packed pace, to make use of the time."),
    });
  }

  // A transfer whose real journey time does not fit inside the nights booked
  // at the destination it arrives at (a slow overland mode across a long
  // distance, say) is a scheduling problem for the traveller to resolve, not
  // something the day plan should quietly absorb into one under-priced,
  // under-timed arrival day.
  for (const overflow of plan.transitOverflows) {
    warnings.push({
      level: "warning",
      audience: "traveller",
      message:
        `${overflow.mode.replace(/_/g, " ")} from ${overflow.from} to ${overflow.to} takes about ` +
        `${formatDuration(overflow.durationMinutes)} — that needs ${overflow.daysRequired} day(s) of travel, ` +
        `more than the ${overflow.daysAvailable} available at ${overflow.to}. Add nights, or choose a faster ` +
        "mode for this leg.",
    });
  }

  for (const u of plan.unplacedDayChoices) {
    warnings.push({
      level: "warning",
      audience: "traveller",
      message:
        u.reason === "wrong-place"
          ? `${u.title} cannot go on day ${u.day}: you are not at its destination that day.`
          : `${u.title} did not fit on day ${u.day} without going over the ${policy.dayPlanning.maxSightseeingHoursPerDay}-hour daily sightseeing limit.`,
    });
  }

  // A pinned cluster that still did not land on a day could not be fitted
  // without breaching the daily sightseeing cap. Say so plainly rather than
  // silently ignoring the request or quietly overfilling the day.
  if (request.pinnedClusterIds.length) {
    const placed = new Set<string>();
    for (const day of plan.days) {
      for (const activity of day.activities) {
        if (activity.clusterId) placed.add(activity.clusterId);
      }
    }
    const unplaced = plan.suggestions.filter(
      (s) => s.clusterId && request.pinnedClusterIds.includes(s.clusterId) && !placed.has(s.clusterId),
    );
    if (unplaced.length) {
      warnings.push({
        level: "warning",
        audience: "traveller",
        message:
          `No room for ${unplaced.map((s) => s.title).join(", ")} without going over the ` +
          `${policy.dayPlanning.maxSightseeingHoursPerDay}-hour daily sightseeing limit. ` +
          `Add a night, or drop something else, to fit ${unplaced.length > 1 ? "them" : "it"} in.`,
      });
    }
  }

  // Deselected activities stay in the plan but stop being charged.
  const excludedCodes = new Set(request.excludedActivityCodes);
  for (const [clusterId, priced] of activityPrices) {
    if (priced.code && excludedCodes.has(priced.code)) {
      activityPrices.set(clusterId, { ...priced, price: 0 });
    }
  }

  // The transport data has no real rate for these legs at any scope, so they
  // priced off geography or a chain of real hops (see `RouteLookup.best`)
  // rather than being silently dropped. The agent should still confirm it.
  const estimatedLegs = plan.days.filter((d) => d.isTransferDay && d.transfer?.estimated);
  if (estimatedLegs.length) {
    warnings.push({
      level: "warning",
      audience: "internal",
      message:
        `${estimatedLegs.length} intercity leg(s) have no contracted route rate and were priced from ` +
        `measured distance or a composed connection: ${estimatedLegs
          .map((d) => `${d.transfer!.from} to ${d.transfer!.to}`)
          .join(", ")}.`,
    });
  }

  // A leg the traveller has to make in two or more hops because no direct
  // service exists is a real constraint on their day, so say so.
  for (const day of plan.days) {
    const via = day.transfer?.via;
    if (!via?.length) continue;
    warnings.push({
      level: "info",
      audience: "traveller",
      message:
        `No direct service from ${day.transfer!.from} to ${day.transfer!.to} — routed via ` +
        `${via.map((id) => names.get(id) ?? id).join(", ")}.`,
    });
  }

  // Finally, the destination knowledge that should shape the trip rather than
  // just price it: travelling in a month the destination itself rates poorly,
  // and places documented as a bad fit for this kind of trip.
  // One entry per place: a place visited twice is still one place to warn about.
  const stayPerPlace = stays.filter((s) => !s.visit);
  warnings.push(...seasonalityWarnings(stayPerPlace, plan.days, bundles));
  warnings.push(
    ...suitabilityWarnings(stayPerPlace, bundles, request.tripStyle, request.travellerType, request.childAges),
  );

  // --- 4. price -------------------------------------------------------------
  const referencePackage = matchReferencePackage(placeIds, core.packages);
  const pax = resolvePax(request.adults, request.childAges, request.rooms);
  const { lineItems, excludedLineItems, totals } = priceQuotation({
    request,
    pax,
    stays,
    days: plan.days,
    core,
    summaries,
    visaRules: data.visaRules,
    liveRates: data.liveRates ?? new Map(),
    activityPrices,
    referencePackageId: referencePackage?.id ?? null,
    gateways: arrivalGateway && departureGateway ? { arrival: arrivalGateway, departure: departureGateway } : null,
    entry: entryForPricing,
  });

  // --- 5. reconcile against the published package --------------------------
  // The floor protects against under-quoting an *engine* price. Once an admin has
  // switched lines off, replaced a rate or added a charge, the figure is theirs:
  // raising it back to the published "from" price would silently undo their edit.
  const handEdited =
    request.excludedLineKeys.length > 0 ||
    Object.keys(request.lineOverrides).length > 0 ||
    request.customLines.length > 0 ||
    request.marginPct != null ||
    Object.keys(request.componentMarginPct).length > 0;
  if (handEdited && referencePackage) {
    warnings.push({
      level: "info",
      audience: "internal",
      message: `Price lines or the margin were edited by hand, so the published "from" price for ${referencePackage.name} is not applied as a floor.`,
    });
  }
  if (
    policy.guardrails.enforcePackageFloor &&
    !data.ignorePackageFloor &&
    !handEdited &&
    referencePackage &&
    // Only floor when the quote genuinely covers that package's scope; a
    // two-night taster of a fourteen-night package should not inherit its price.
    referencePackage.matchRatio >= 0.8
  ) {
    const pkg = core.packages.find((p) => p.id === referencePackage.id);
    const scale = pkg && pkg.nights > 0 ? Math.min(1, nights / pkg.nights) : 1;
    const floorPerPerson = referencePackage.priceFromInr * scale * (1 - policy.guardrails.packageFloorTolerance);

    // The published "from" price covers the land package only unless the
    // package says otherwise, so the comparison has to be like-for-like:
    // measure the quote's *land* share against it, not the all-in total that
    // also carries an ex-India airfare. Every markup in the chain is
    // multiplicative on `directCost`, so the flight's share of the total is
    // exactly its share of the direct cost.
    const flightDirect = lineItems
      .filter((i) => i.component === "flight")
      .reduce((a, i) => a + i.totalInr, 0);
    const landShare =
      pkg?.priceIncludesFlight || totals.directCost <= 0
        ? 1
        : Math.max(0, totals.directCost - flightDirect) / totals.directCost;
    const flightTotal = totals.total - totals.total * landShare;
    const landPerPerson = (totals.total * landShare) / Math.max(1, pax.total);

    // A "from" price several times the bottom-up quote is a data error, not a
    // marketing floor (Maharashtra is listed at Rs 5,00,000 against a quote
    // near Rs 46,000). Flooring to it would charge every Maharashtra traveller
    // ten times the trip; say so internally instead.
    const maxOver = policy.guardrails.maxFloorOverQuote ?? Infinity;
    if (landPerPerson > 0 && floorPerPerson > landPerPerson * maxOver) {
      warnings.push({
        level: "warning",
        audience: "internal",
        message:
          `Published "from" price for ${referencePackage.name} (₹${referencePackage.priceFromInr.toLocaleString("en-IN")}) is more than ` +
          `${maxOver}x the quoted land price (₹${Math.round(landPerPerson).toLocaleString("en-IN")} per person); treated as a data error and not applied as a floor.`,
      });
    } else if (landPerPerson < floorPerPerson) {
      const flooredLandTotal = floorPerPerson * pax.total;
      const newTotal = Math.round(flooredLandTotal + flightTotal);
      warnings.push({
        level: "info",
        audience: "internal",
        message:
          `Raised to the published "from" price for ${referencePackage.name}. ` +
          `Land component rates came to ₹${Math.round(landPerPerson).toLocaleString("en-IN")} per person ` +
          `against a published land-only "from" of ₹${referencePackage.priceFromInr.toLocaleString("en-IN")}.`,
      });
      // The uplift is the agency's, not a tax: book it as margin and re-derive
      // GST so direct cost + contingency + margin + GST + fees still adds up to
      // the total. Leaving the gap unallocated made the traveller's "Taxes &
      // fees" row swallow it.
      const uplift = newTotal - totals.total;
      const markup = policy.markup;
      const preTax = uplift / ((1 + markup.salesVat) * (1 + markup.paymentGatewayFee + markup.fxBuffer));
      totals.agentMarkup = Math.round(totals.agentMarkup + preTax);
      // Keep the per-category margins summing to the margin: the uplift is
      // spread over categories in proportion to cost, the remainder (rounding)
      // lands on the largest. The floor is a land-package figure, so when the
      // package does not include the flight the uplift stays off the airfare
      // line: that line is the fare as read, with nothing added to it.
      if (totals.marginByComponent && totals.directCost > 0) {
        const byCost = new Map<string, number>();
        for (const i of lineItems) {
          if (i.component === "flight" && !pkg?.priceIncludesFlight) continue;
          byCost.set(i.component, (byCost.get(i.component) ?? 0) + i.totalInr);
        }
        const spread = [...byCost.values()].reduce((a, b) => a + b, 0);
        const next: Record<string, number> = { ...totals.marginByComponent };
        if (spread > 0) {
          for (const [c, amt] of byCost) next[c] = Math.round((next[c] ?? 0) + (preTax * amt) / spread);
        }
        const largest = [...byCost.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const gap = totals.agentMarkup - Object.values(next).reduce((a, b) => a + b, 0);
        if (largest) next[largest] = (next[largest] ?? 0) + gap;
        totals.marginByComponent = next;
      }
      const afterMarkup = totals.costBeforeMarkup + totals.agentMarkup;
      totals.paymentAndFx = Math.max(
        0,
        Math.round(afterMarkup * (1 + markup.salesVat) * (markup.paymentGatewayFee + markup.fxBuffer)),
      );
      // GST takes up the rounding, so the parts add up to the total exactly.
      totals.salesVat = newTotal - afterMarkup - totals.paymentAndFx;
      totals.total = newTotal;
      totals.perPerson = Math.round(newTotal / Math.max(1, pax.total));
      totals.flooredToPackage = referencePackage.name;
    }
  }

  // --- 6. suggestions -------------------------------------------------------
  const suggestions: PlannedActivity[] = plan.suggestions
    .sort((a, b) => b.attractions.length - a.attractions.length)
    .slice(0, 8);

  if (!lineItems.some((i) => i.component === "flight") && request.includeFlight) {
    warnings.push({ level: "warning", audience: "traveller", message: "No airfare band for this destination; flights quoted separately." });
  }
  const flightLines = lineItems.filter((i) => i.component === "flight");
  if (flightLines.length) {
    // Airlines reprice minute to minute, so the quote says plainly which kind of
    // figure the airfare is and that it can move before the ticket is issued.
    const live = flightLines.every((i) => i.source === "live");
    warnings.push({
      level: "info",
      audience: "traveller",
      message: live
        ? "Airfare is the lowest live fare for your route, dates and cabin as seen on Google Flights when this quote was prepared. The actual price will be confirmed on the final quotation, as airlines change fares until the ticket is issued."
        : "Airfare is a typical fare for this route, not a live price for your dates. The actual price will be confirmed on the final quotation, as airlines change fares until the ticket is issued.",
    });
  }
  if (!request.includeFlight) {
    warnings.push({
      level: "info",
      audience: "traveller",
      message:
        "This is a land-only price — airfare is not included. Tick return flights in the trip options to have them quoted.",
    });
  }
  if (!request.includeInsurance) {
    warnings.push({
      level: "info",
      audience: "traveller",
      message: "Travel insurance is excluded from this quote — add it back any time from the trip options.",
    });
  }
  const estimatedCount = lineItems.filter((i) => i.source === "estimated").length;
  if (estimatedCount) {
    warnings.push({
      level: "info",
      audience: "internal",
      message: `${estimatedCount} line item(s) use estimated rates pending the agency's contracted card.`,
    });
  }

  // --- 7. decision rules ----------------------------------------------------
  const appliedRules: AppliedRule[] = [];
  for (const [placeId, fired] of firedByPlace) {
    const placeName = names.get(placeId) ?? placeId;
    for (const { rule } of fired) {
      appliedRules.push({
        placeId,
        placeName,
        ruleId: rule.id,
        conditions: rule.conditions.map(
          (c) => `${c.joiner ? `${c.joiner} ` : ""}${c.variable} ${c.operator} ${c.value}`,
        ),
        action: rule.action,
        reason: rule.reason,
        applied: rule.effects.length > 0,
      });
    }
  }

  // Rules resting on something the planner never asks — the traveller's route
  // preference, their hotel priority, the visibility on the day. Surfaced to
  // the agent so the coverage gap is visible rather than silently absorbed.
  const totalSkipped = [...skippedRuleCount.values()].reduce((a, b) => a + b, 0);
  if (totalSkipped) {
    warnings.push({
      level: "info",
      audience: "internal",
      message:
        `${totalSkipped} destination rule(s) could not be evaluated because they depend on inputs ` +
        "the planner does not collect; they were skipped rather than guessed at.",
    });
  }
  if (appliedRules.length) {
    warnings.push({
      level: "info",
      audience: "internal",
      message:
        `${appliedRules.length} destination decision rule(s) fired for this trip, ` +
        `${appliedRules.filter((r) => r.applied).length} of which the planner acted on directly.`,
    });
  }

  return {
    // A trip inside the traveller's own country needs no visa, so it is never
    // shown as "visa support included".
    request: request.includeVisa && isDomesticTrip(core, placeIds, request.nationality)
      ? { ...request, includeVisa: false }
      : request,
    referencePackage,
    stays,
    days: plan.days,
    lineItems,
    excludedLineItems,
    totals,
    pax: {
      adults: pax.adults, children: pax.children, infants: pax.infants,
      total: pax.total, rooms: pax.rooms,
    },
    warnings,
    suggestions,
    sightseeingOptions: plan.options,
    fx: fxApplied.length ? fxApplied : undefined,
    planningNotes: planningNotes(
      stayPerPlace, bundles, request.tripStyle, request.travellerType, request.childAges,
    ),
    appliedRules,
    ...(portInfo ? { portOfEntry: portInfo } : {}),
    ...(arrivalGateway && departureGateway
      ? {
          gateways: {
            home: {
              code: request.departureCity,
              label: (core.departureCities ?? []).find((c) => c.code === request.departureCity)?.label ?? request.departureCity,
            },
            arrival: arrivalGateway,
            departure: departureGateway,
          },
        }
      : {}),
  };
}

export { styleScore };
export type { FxAdjustment, FxRates };
export type { Quotation, QuoteRequest } from "./types";
