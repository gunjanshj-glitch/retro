/**
 * Writes the Europe map's markers: every supported place, with its country.
 *
 * The Europe destination file's markers used to be a hand-picked handful. Now
 * every place the planner can quote — the master's own places plus every city in
 * `content/europe-cities` — gets a pin, ordered within each country from most to
 * least important so the map can reveal them in that order as the traveller
 * zooms in.
 *
 *   npx tsx scripts/etl/europe-markers.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadCities } from "./europe-cities";
import { normalise } from "./normalise";

const FILE = "content/destinations/europe.json";
const CITIES_DIR = "content/europe-cities";
const CORE = "public/atlas/core.json";

/** Package group each country belongs to (ids from europe.json). */
const GROUP_BY_COUNTRY: Record<string, number> = {
  France: 1, Switzerland: 1, Luxembourg: 1, Belgium: 1, Monaco: 1,
  Germany: 2, Austria: 2, Netherlands: 2, Liechtenstein: 2,
  Czechia: 3, Hungary: 3, Poland: 3,
  Spain: 4, Portugal: 4,
  Greece: 5,
  Italy: 6, "Vatican City": 6, "San Marino": 6,
  Denmark: 7, Finland: 7, Norway: 7, Sweden: 7, Iceland: 7,
  "United Kingdom": 8,
  Ireland: 10,
};
const SCOTLAND_GROUP = 9;
const SCOTLAND = new Set(["Edinburgh", "Edinburg", "Glasgow", "Inverness", "Stirling", "Aberdeen", "Dundee", "Scottish Highlands"]);

/** Places that stand for a whole country rather than a city in it. */
const COUNTRY_LEVEL = new Set([
  "France", "Switzerland", "Luxembourg", "Belgium", "Germany", "Austria", "Netherlands",
  "Linchestine", "Czech", "Hungery", "Poland", "Spain", "Portugal",
  "Denmark", "Norway", "Sweden", "Finland", "Iceland",
]);

type Marker = {
  name: string; lat: number; lng: number; type: "city" | "poi"; group?: number;
  country?: string; countryLevel?: boolean;
};

const dest = JSON.parse(readFileSync(FILE, "utf8"));
const existing: Marker[] = dest.map.markers;
const cities = loadCities(CITIES_DIR);

const ideal = new Map<string, number>();
if (existsSync(CORE)) {
  const core = JSON.parse(readFileSync(CORE, "utf8"));
  const nameById = new Map<string, string>(core.places.map((p: { id: string; name: string }) => [p.id, p.name]));
  for (const s of core.placeSummaries) {
    const n = nameById.get(s.placeId);
    if (n) ideal.set(normalise(n), s.idealNights * 10 + s.clusterCount);
  }
}

const ALIAS: Record<string, string> = { edinburgh: "edinburg", crete: "creteheraklion" };
const key = (n: string) => ALIAS[normalise(n)] ?? normalise(n);

const merged = new Map<string, Marker & { weight: number }>();
for (const m of existing) {
  merged.set(key(m.name), { ...m, countryLevel: COUNTRY_LEVEL.has(m.name) || undefined, weight: ideal.get(key(m.name)) ?? 20 });
}
for (const c of cities) {
  const k = key(c.name);
  const prior = merged.get(k);
  const group = SCOTLAND.has(c.name) ? SCOTLAND_GROUP : GROUP_BY_COUNTRY[c.country];
  const weight = c.nights[1] * 10 + c.clusters.length;
  if (prior) {
    merged.set(k, { ...prior, weight: Math.max(prior.weight, weight) });
    continue;
  }
  merged.set(k, {
    name: c.name, lat: c.lat, lng: c.lng, type: "city", group, country: c.country, weight,
  });
}

const markers: Marker[] = [...merged.values()]
  .sort((a, b) => {
    if (a.country !== b.country) return String(a.country).localeCompare(String(b.country));
    // The country-level place leads; its cities follow by importance.
    if (!!a.countryLevel !== !!b.countryLevel) return a.countryLevel ? -1 : 1;
    return b.weight - a.weight || a.name.localeCompare(b.name);
  })
  .map(({ weight: _weight, ...m }) => {
    void _weight;
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as Marker;
  });

dest.map.markers = markers;
writeFileSync(FILE, `${JSON.stringify(dest, null, 2)}\n`);
console.log(`europe.json: ${markers.length} markers (${cities.length} supplement cities)`);
