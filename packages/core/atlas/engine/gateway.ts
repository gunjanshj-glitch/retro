/**
 * Gateways: the airport a trip lands at and leaves from.
 *
 * A planner who sells "Bangkok and Pattaya" does not land the couple at
 * Suvarnabhumi, drive them to Pattaya for the last nights and then put them on a
 * two-hour road to the airport on the morning they fly. They land in Bangkok,
 * go out to Pattaya and come back to Bangkok for the last nights, so the flight
 * home starts from a hotel near the airport. This module is where that rule
 * lives, for every destination:
 *
 *  - a place is a **satellite** when the airport that serves it is far away
 *    (Pattaya, Kyoto, Interlaken, Kandy); a place close to its airport is an
 *    **airport city** (Bangkok, Osaka, Zurich, Colombo);
 *  - when a trip ends at a satellite and the airport's own city is also in the
 *    trip, the airport city is added back as the last stay, and likewise at the
 *    start, with its nights split between the two visits;
 *  - a metro with more than one airport (Bangkok has BKK and DMK) lists them
 *    all, so the cheapest can be searched in one query and shown by name.
 */
import type { CoreBundle } from "../schema";
import gateways from "../../../../content/gateway-airports.json";
import { haversineKm } from "./geo";

export type AirportRef = { iata: string; name: string };

/** One visit in the route: a place and the nights spent there on that visit. */
export type Visit = { placeId: string; nights: number };

export type GatewayInfo = {
  iata: string;
  name: string;
  /** The stay the traveller lands at, or leaves from. */
  placeId: string;
  placeName: string;
  /** Straight-line distance from the airport to that stay; null when unknown. */
  distanceKm: number | null;
  /** Other airports that serve the same metro, searched alongside this one. */
  alternatives: AirportRef[];
  /** Where the airport was decided: the place's listed airport, or the cheapest live fare. */
  basis: "listed" | "cheapest-fare";
};

const SATELLITE_MIN_KM = gateways.satelliteMinKm;

/** Country-level pseudo-places sit at a centroid, not a town, so they are never "far" from their hub. */
const COUNTRY_LEVEL_PLACES = new Set(["norway", "sweden", "finland", "denmark", "iceland"]);

const METROS: AirportRef[][] = gateways.metroAirports;

function airportOf(core: CoreBundle, placeId: string) {
  return core.placeAirports?.[placeId] ?? null;
}

export function airportRefOf(core: CoreBundle, placeId: string): AirportRef | null {
  const a = airportOf(core, placeId);
  return a ? { iata: a.iata, name: a.name } : null;
}

/** Straight-line kilometres from a place to the airport that serves it. */
export function airportDistanceKm(core: CoreBundle, placeId: string): number | null {
  const a = airportOf(core, placeId);
  const p = core.places.find((x) => x.id === placeId);
  if (!a || !p || p.lat == null || p.lon == null) return null;
  return haversineKm({ lat: p.lat, lon: p.lon }, { lat: a.lat, lon: a.lon });
}

function isCountryLevel(core: CoreBundle, placeId: string): boolean {
  if (COUNTRY_LEVEL_PLACES.has(placeId)) return true;
  const place = core.places.find((p) => p.id === placeId);
  const country = core.countries.find((c) => c.id === place?.countryId);
  return Boolean(place && country && place.name.trim().toLowerCase() === country.name.trim().toLowerCase());
}

/** True when the airport serving this place is too far to be the place's own airport. */
export function isSatellite(core: CoreBundle, placeId: string): boolean {
  if (isCountryLevel(core, placeId)) return false;
  const km = airportDistanceKm(core, placeId);
  return km != null && km >= SATELLITE_MIN_KM;
}

/**
 * Airports a traveller can land at for this place, the listed one first.
 *
 * A satellite gets only its listed airport: Don Mueang is no use for Pattaya
 * just because it is cheaper to reach from Kolkata, it is further away again.
 */
export function airportAlternatives(core: CoreBundle, placeId: string): AirportRef[] {
  const listed = airportRefOf(core, placeId);
  if (!listed) return [];
  if (isSatellite(core, placeId)) return [listed];
  const metro = METROS.find((m) => m.some((a) => a.iata === listed.iata));
  if (!metro) return [listed];
  return [listed, ...metro.filter((a) => a.iata !== listed.iata)];
}

/** The airport city a satellite should be reached through: a trip stop that shares its airport. */
function gatewayCityFor(core: CoreBundle, satelliteId: string, tripPlaceIds: Set<string>): string | null {
  if (!isSatellite(core, satelliteId)) return null;
  const iata = airportOf(core, satelliteId)?.iata;
  let best: { id: string; km: number } | null = null;
  for (const id of tripPlaceIds) {
    if (id === satelliteId || isSatellite(core, id) || airportOf(core, id)?.iata !== iata) continue;
    const km = airportDistanceKm(core, id) ?? 0;
    if (!best || km < best.km) best = { id, km };
  }
  return best?.id ?? null;
}

/**
 * Makes both ends of the route an airport city wherever the trip allows it.
 *
 * `path` is the visiting order with one entry per place. When the last stop is
 * a satellite whose airport city is also on the trip, the airport city is
 * visited again at the end, taking half its nights (the larger half when odd:
 * the last evening is the shopping evening, and it is the one near the flight).
 * The same is done for the first stop. A single night cannot be split, so it
 * moves to the end of the trip instead, where a missed connection costs most;
 * the traveller is then driven from the airport to the satellite on arrival.
 *
 * Total nights never change, and a place keeps every night it was allocated.
 */
export function bookendGateways(core: CoreBundle, path: Visit[]): Visit[] {
  if (path.length < 2) return path.map((v) => ({ ...v }));
  const route = path.map((v) => ({ ...v }));
  const tripPlaceIds = new Set(route.map((v) => v.placeId));

  const bookend = (side: "exit" | "entry") => {
    const end = side === "exit" ? route[route.length - 1] : route[0];
    const cityId = gatewayCityFor(core, end.placeId, tripPlaceIds);
    if (!cityId) return;

    // Take from the visit with the most nights; ties go to the first one.
    let source = -1;
    route.forEach((v, i) => {
      if (v.placeId === cityId && (source < 0 || v.nights > route[source].nights)) source = i;
    });
    if (source < 0) return;
    const from = route[source];
    // The entry bookend may not strip the exit bookend of its only night.
    if (side === "entry" && from.nights < 2 && source === route.length - 1) return;

    const take = from.nights >= 2 ? Math.ceil(from.nights / 2) : 1;
    from.nights -= take;
    const visit: Visit = { placeId: cityId, nights: take };
    if (from.nights <= 0) route.splice(source, 1);
    if (side === "exit") route.push(visit);
    else route.unshift(visit);
  };

  bookend("exit");
  bookend("entry");
  return route;
}

/** The airport the traveller lands at (or leaves from) for a stay, given what live fares said. */
export function chooseAirport(
  core: CoreBundle,
  placeId: string,
  liveIata: string | undefined,
): { airport: AirportRef; alternatives: AirportRef[]; basis: GatewayInfo["basis"] } | null {
  const alternatives = airportAlternatives(core, placeId);
  if (!alternatives.length) return null;
  const live = liveIata ? alternatives.find((a) => a.iata === liveIata) : undefined;
  return live
    ? { airport: live, alternatives, basis: "cheapest-fare" }
    : { airport: alternatives[0], alternatives, basis: "listed" };
}
