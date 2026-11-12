/**
 * Port of entry: where a traveller actually enters the region, and how they get
 * there from home.
 *
 * A quote used to treat the first place on the route as if the plane landed at
 * its door. For a trip to Tawang that meant a "return airfare to Tawang" and an
 * itinerary that started at the far end of the valley. Real itineraries start at
 * the gateway the whole group of places hangs off (Guwahati for Arunachal,
 * Bagdogra/NJP for Sikkim), work outward and come back through it.
 *
 * This module decides that gateway, offers the ways of reaching it (flight,
 * train) with a fare and a journey time, and works out what time the traveller
 * is at the hotel so the first day is only planned as far as it can be used.
 */
import patch from "../../../../content/transport-patch.json";
import type { CoreBundle } from "../schema";
import { haversineKm, HILL_ROAD, MODE_PROFILES, type GeoPoint } from "./geo";

export type HubKind = "airport" | "rail";
export type Hub = { code: string; kind: HubKind; name: string; lat: number; lon: number };
export type EntryMode = "flight" | "train" | "bus";

type Patch = {
  hubs: Record<string, { kind: HubKind; name: string; lat: number; lon: number }>;
  portSubstitutes: Record<string, string>;
  railheads: Record<string, string>;
  hillStates: string[];
  roadHops: { hub: string; place: string; km: number; minutes: number }[];
};
const PATCH = patch as Patch;

export function hubByCode(code: string): Hub | null {
  const h = PATCH.hubs[code];
  return h ? { code, ...h } : null;
}

export type PortOfEntry = {
  /** The airport the trip is planned around. */
  airport: Hub;
  /** A railway station that serves the same places, when one is known. */
  rail: Hub | null;
  /** Selected places that hang off this port, nearest first. */
  servesPlaceIds: string[];
};

/**
 * The airport a set of places is entered through: the one serving the most of
 * them (a thinly served airport such as Tezpur is replaced by Guwahati), the
 * airport city itself winning ties, then the smaller total road distance.
 */
export function choosePortOfEntry(core: CoreBundle, placeIds: string[]): PortOfEntry | null {
  const placeOf = new Map(core.places.map((p) => [p.id, p]));
  type Cand = { hub: Hub; places: string[]; km: number; isCity: boolean };
  const cands = new Map<string, Cand>();

  for (const id of placeIds) {
    const a = core.placeAirports?.[id];
    if (!a) continue;
    const code = PATCH.portSubstitutes[a.iata] ?? a.iata;
    const hub: Hub = hubByCode(code) ?? { code, kind: "airport", name: a.name, lat: a.lat, lon: a.lon };
    const c = cands.get(code) ?? { hub, places: [], km: 0, isCity: false };
    c.places.push(id);
    cands.set(code, c);
  }
  if (!cands.size) return null;

  for (const c of cands.values()) {
    for (const id of placeIds) {
      const p = placeOf.get(id);
      if (!p || p.lat == null || p.lon == null) continue;
      c.km += haversineKm({ lat: p.lat, lon: p.lon }, c.hub);
    }
    c.isCity = c.places.some((id) => {
      const p = placeOf.get(id);
      return !!p && p.lat != null && p.lon != null && haversineKm({ lat: p.lat!, lon: p.lon! }, c.hub) <= 40;
    });
  }
  const best = [...cands.values()].sort(
    (x, y) =>
      y.places.length - x.places.length ||
      Number(y.isCity) - Number(x.isCity) ||
      x.km - y.km ||
      x.hub.code.localeCompare(y.hub.code),
  )[0];

  // A railhead that serves most of the places the airport does.
  const tally = new Map<string, number>();
  for (const id of placeIds) {
    const r = PATCH.railheads[id];
    if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
  }
  const railCode = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const rail = railCode ? hubByCode(railCode) : null;

  const servesPlaceIds = [...placeIds].sort((a, b) => distTo(core, a, best.hub) - distTo(core, b, best.hub));
  return { airport: best.hub, rail: rail && rail.kind === "rail" ? rail : null, servesPlaceIds };
}

function distTo(core: CoreBundle, placeId: string, hub: GeoPoint): number {
  const p = core.places.find((x) => x.id === placeId);
  return p && p.lat != null && p.lon != null ? haversineKm({ lat: p.lat, lon: p.lon }, hub) : Infinity;
}

/** True for a state whose roads are hill roads (see `HILL_ROAD`). */
export function isHillState(stateId: string | null | undefined): boolean {
  return !!stateId && PATCH.hillStates.includes(stateId);
}

/** True when a place sits in hill country, where a road covers about half the plains distance per hour. */
export function isHillPlace(core: CoreBundle, placeId: string): boolean {
  return isHillState(core.places.find((p) => p.id === placeId)?.stateId);
}

/**
 * Road time between a hub and a place. A curated hop wins; otherwise the
 * distance model, slower in hill states. Never under 45 minutes.
 */
export function roadLeg(
  core: CoreBundle,
  hub: Hub,
  placeId: string,
): { km: number | null; minutes: number | null } {
  const curated = PATCH.roadHops.find((h) => h.hub === hub.code && h.place === placeId);
  if (curated) return { km: curated.km, minutes: curated.minutes };
  const p = core.places.find((x) => x.id === placeId);
  if (!p || p.lat == null || p.lon == null) return { km: null, minutes: null };
  const km = haversineKm({ lat: p.lat, lon: p.lon }, hub);
  const hill = isHillPlace(core, placeId);
  const detour = hill ? HILL_ROAD.detour : 1.3;
  const kmh = hill ? HILL_ROAD.kmh : 50;
  return { km: Math.round(km), minutes: Math.max(45, Math.round(((km * detour) / kmh) * 60)) };
}

// ---------------------------------------------------------------------------
// Getting from home to the port
// ---------------------------------------------------------------------------

/**
 * Domestic fares, one way, per adult, in INR. Local to this module on purpose:
 * the generic curves in geo.ts feed the ETL's gap-filling and are fitted to the
 * authored table, and the domestic ticket is a different thing from a transfer.
 */
const DOMESTIC_FARE = {
  flight: { fixedInr: 2200, perKmInr: 2.6 },
  train: { fixedInr: 250, perKmInr: 2.1 },
  bus: { fixedInr: 150, perKmInr: 1.2 },
} as const;

/** The first morning flight leaves about 06:30; a train out leaves about 17:00 the evening before. */
const FLIGHT_DEPARTS_MIN = 6 * 60 + 30;
const TRAIN_DEPARTS_MIN = 17 * 60;
/** An overnight coach leaves in the evening too. */
const BUS_DEPARTS_MIN = 18 * 60;

export type EntryOption = {
  mode: EntryMode;
  /** Hub the traveller arrives at by this mode. */
  hub: Hub;
  km: number;
  /** Door-to-door journey, including airport or station overhead. */
  minutes: number;
  /** One way, per adult. */
  fareInr: number;
  /** Clock time the traveller reaches the hub, minutes after midnight. */
  arrivesAtMin: number;
  /** Whole days the journey runs into before the arrival day (an overnight train is 1). */
  daysEnRoute: number;
};

export function entryOptions(home: GeoPoint, port: PortOfEntry): EntryOption[] {
  const out: EntryOption[] = [];
  // Home is already at the port (a Delhi traveller on a Delhi trip): nothing to book.
  if (haversineKm(home, port.airport) < 150) return out;
  const build = (mode: EntryMode, hub: Hub) => {
    const km = Math.round(haversineKm(home, hub));
    const profile = MODE_PROFILES[mode];
    const minutes = Math.round(profile.overheadMin + ((km * profile.detour) / profile.kmh) * 60);
    const departs = mode === "flight" ? FLIGHT_DEPARTS_MIN : mode === "bus" ? BUS_DEPARTS_MIN : TRAIN_DEPARTS_MIN;
    const fare = DOMESTIC_FARE[mode];
    const total = departs + minutes;
    out.push({
      mode,
      hub,
      km,
      minutes,
      fareInr: Math.round(fare.fixedInr + km * fare.perKmInr),
      arrivesAtMin: total % 1440,
      daysEnRoute: Math.floor(total / 1440),
    });
  };
  build("flight", port.airport);
  // A train is only a real answer where it is not absurdly far; 2,800 km is Delhi to Kanyakumari.
  if (port.rail) {
    const km = haversineKm(home, port.rail);
    if (km >= 80 && km <= 2800) build("train", port.rail);
    // A coach is a real answer only for a regional trip, and it serves the same city as the station.
    if (km >= 80 && km <= 900) build("bus", port.rail);
  }
  return out;
}

/** Hours of travel a traveller will take over to save money, per preference. */
const ENTRY_HOUR_VALUE = { cheapest: 60, balanced: 450, fastest: 2500 } as const;

/** Best option for the traveller's preference, unless they chose a mode themselves. */
export function pickEntry(
  options: EntryOption[],
  preference: keyof typeof ENTRY_HOUR_VALUE,
  chosen?: EntryMode,
): EntryOption | null {
  if (!options.length) return null;
  const pinned = chosen && options.find((o) => o.mode === chosen);
  if (pinned) return pinned;
  const score = (o: EntryOption) => o.fareInr + (o.minutes / 60) * ENTRY_HOUR_VALUE[preference];
  return [...options].sort((a, b) => score(a) - score(b))[0];
}

// ---------------------------------------------------------------------------
// The first day
// ---------------------------------------------------------------------------

/** After this clock time nobody starts sightseeing. */
export const SIGHTSEEING_ENDS_MIN = 18 * 60;
/** Check-in, freshening up and a sit-down. */
export const SETTLE_IN_MIN = 60;
/** Less usable daylight than this and the day is not worth planning outings into. */
export const MIN_USABLE_SIGHTSEEING_HOURS = 3;

/**
 * What is left of the arrival day once the traveller is at the hotel.
 *
 * Arriving in the evening leaves no trip at all, so the day is a rest day; an
 * afternoon arrival leaves a little, and below three hours that is not enough
 * to plan an outing into.
 */
export function arrivalDay(arrivesAtHubMin: number, roadMinutes: number) {
  const atHotel = arrivesAtHubMin + roadMinutes + SETTLE_IN_MIN;
  const usableHours = Math.max(0, (SIGHTSEEING_ENDS_MIN - atHotel) / 60);
  return {
    hotelClockMin: arrivesAtHubMin + roadMinutes,
    usableHours: usableHours < MIN_USABLE_SIGHTSEEING_HOURS ? 0 : usableHours,
    restDay: usableHours < MIN_USABLE_SIGHTSEEING_HOURS,
  };
}

export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
