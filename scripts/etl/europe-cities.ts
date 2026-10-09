/**
 * Europe city supplement.
 *
 * The master catalogue models most European countries as a single place
 * ("France", "Switzerland"), so a traveller could not pick Paris, Lyon or
 * Interlaken on their own. `content/europe-cities/*.json` lists the cities the
 * agency supports; this module turns them into first-class places with
 * everything the quotation engine needs to plan and price a stay:
 *
 *  - a place row and a coordinate, so the router can measure every leg;
 *  - destination content (clusters, attractions, nights, seasons) so days fill;
 *  - an activity rate per cluster, so sightseeing is charged;
 *  - an island marker where the place has no road or rail link.
 *
 * Hotel, meal and transfer rates are deliberately not written here: places
 * with none are estimated from their country's priced peers and the cost level
 * given for the city, exactly as every other unpriced place is.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  Activity,
  ActivityRate,
  Area,
  Attraction,
  Cluster,
  Country,
  Place,
  WalkingIntensity,
} from "../../lib/atlas/schema";
import type { DestinationContent } from "./parse-destinations";
import { normalise, slugify } from "./normalise";

const EUR_INR = 100;

const CitySchema = z.object({
  name: z.string().min(1),
  country: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  iata: z.string().length(3).nullable(),
  cost: z.enum(["LOW", "LOW-MEDIUM", "MEDIUM", "MEDIUM-HIGH", "HIGH", "VERY HIGH"]),
  nights: z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)]),
  summary: z.string().min(1),
  types: z.array(z.string()).min(1),
  island: z.boolean(),
  best: z.array(z.number().int().min(1).max(12)),
  peak: z.array(z.number().int().min(1).max(12)),
  clusters: z
    .array(
      z.object({
        name: z.string().min(1),
        attractions: z.array(z.string().min(1)).min(1),
        hours: z.number().positive(),
        walk: z.enum(["LOW", "LOW_MEDIUM", "MEDIUM", "MEDIUM_HIGH", "HIGH"]),
        eur: z.number().min(0),
      }),
    )
    .min(1),
});
export type City = z.infer<typeof CitySchema>;

/** The master catalogue's country node each supported country is filed under. */
export const MASTER_COUNTRY: Record<string, string> = {
  France: "France",
  Monaco: "France",
  Switzerland: "Switzerland",
  Luxembourg: "Luxembourg",
  Belgium: "Belgium",
  Germany: "Germany",
  Austria: "Austria",
  Netherlands: "Netherlands",
  Liechtenstein: "Linchestine",
  Czechia: "Czech",
  Hungary: "Hungery",
  Poland: "Poland",
  Denmark: "Scandinivia",
  Finland: "Scandinivia",
  Norway: "Scandinivia",
  Sweden: "Scandinivia",
  Iceland: "Scandinivia",
  "United Kingdom": "United Kingdom",
  Ireland: "Ireland",
  Italy: "Italy",
  "Vatican City": "Italy",
  "San Marino": "Italy",
  Greece: "Greece",
  Spain: "Spain",
  Portugal: "Portugal",
};

/** The master's whole-country place for each country that has one. */
const COUNTRY_WIDE_PLACE: Record<string, string> = {
  France: "France", Switzerland: "Switzerland", Luxembourg: "Luxembourg", Belgium: "Belgium",
  Germany: "Germany", Austria: "Austria", Netherlands: "Netherlands", Liechtenstein: "Linchestine",
  Czechia: "Czech", Hungary: "Hungery", Poland: "Poland", Spain: "Spain", Portugal: "Portugal",
  Denmark: "Denmark", Finland: "Finland", Norway: "Norway", Sweden: "Sweden", Iceland: "Iceland",
};

/** Cities the master files under Scotland rather than the United Kingdom. */
const SCOTLAND = new Set(["Scottish Highlands"]);

/** Island each island place belongs to; two places on one island connect by road. */
const ISLAND_OF: Record<string, string> = {
  Mallorca: "Mallorca", Ibiza: "Ibiza", Tenerife: "Tenerife", "Gran Canaria": "Gran Canaria",
  Funchal: "Madeira", "Ponta Delgada": "Azores", Crete: "Crete", "Crete-Heraklion": "Crete",
  Corfu: "Corfu", Zakynthos: "Zakynthos", Mykonos: "Mykonos", Santorini: "Santorini",
  Capri: "Capri", Palermo: "Sicily", Catania: "Sicily", Taormina: "Sicily", Sicily: "Sicily",
  Lofoten: "Lofoten", Visby: "Gotland",
};

/** Iceland is one island: its towns are joined by road, every other island stands alone. */
function islandName(city: City): string {
  if (city.country === "Iceland") return "Iceland";
  return ISLAND_OF[city.name] ?? city.name;
}

export type Supplement = {
  cities: { city: City; place: Place; existing: boolean }[];
  newPlaces: Place[];
  islandOf: Map<string, string>;
  /** City place id -> the whole-country place it sits inside. */
  parentOf: Map<string, string>;
  /** Fills in content for supported places that have no destination file. */
  applyContent(byPlaceId: Map<string, DestinationContent>): number;
  /** Adds the priced activities for cities whose content came from here. */
  applyPricing(pricing: { activities: Activity[]; activityRates: ActivityRate[] }): number;
  /** Pins every supplied city to its authored coordinate. */
  applyCoords(points: Map<string, { lat: number; lon: number }>): void;
};

export function loadCities(dir: string): City[] {
  if (!existsSync(dir)) return [];
  const out: City[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { cities: unknown[] };
    raw.cities.forEach((c, i) => {
      const parsed = CitySchema.safeParse(c);
      if (!parsed.success) {
        throw new Error(`${file} city #${i} (${(c as { name?: string }).name}): ${parsed.error.message}`);
      }
      out.push(parsed.data);
    });
  }
  return out;
}

const WALK: Record<string, WalkingIntensity> = {
  LOW: "LOW", LOW_MEDIUM: "LOW_MEDIUM", MEDIUM: "MEDIUM", MEDIUM_HIGH: "MEDIUM_HIGH", HIGH: "HIGH",
};

function costWords(cost: City["cost"]): string {
  if (cost === "LOW-MEDIUM") return "LOW → MEDIUM";
  if (cost === "MEDIUM-HIGH") return "MEDIUM → HIGH";
  return cost;
}

export function buildSupplement(
  dir: string,
  places: Place[],
  countries: Country[],
  aliases: Record<string, string>,
): Supplement {
  const cities = loadCities(dir);
  const byKey = new Map(places.map((p) => [normalise(p.name), p]));
  const countryByName = new Map(countries.map((c) => [normalise(c.name), c]));
  const usedIds = new Set(places.map((p) => p.id));

  const resolved: Supplement["cities"] = [];
  const newPlaces: Place[] = [];
  const islandOf = new Map<string, string>();
  const parentOf = new Map<string, string>();
  const seen = new Set<string>();

  for (const city of cities) {
    const alias = aliases[city.name];
    const hit = byKey.get(normalise(city.name)) ?? (alias ? byKey.get(normalise(alias)) : undefined);
    if (hit) {
      resolved.push({ city, place: hit, existing: true });
      if (city.island) islandOf.set(hit.id, islandName(city));
      continue;
    }

    const nodeName = SCOTLAND.has(city.name) ? "Scotland" : MASTER_COUNTRY[city.country];
    const node = nodeName ? countryByName.get(normalise(nodeName)) : undefined;
    if (!node) throw new Error(`No master country for ${city.name} (${city.country})`);

    let id = slugify(city.name);
    if (usedIds.has(id)) id = `${id}-${slugify(city.country)}`;
    if (usedIds.has(id)) throw new Error(`Duplicate place id ${id}`);
    if (seen.has(normalise(city.name))) throw new Error(`Duplicate city ${city.name}`);
    seen.add(normalise(city.name));
    usedIds.add(id);

    const place: Place = {
      id,
      name: city.name,
      slug: id,
      countryId: node.id,
      stateId: null,
      hasRates: false,
      hasContent: false,
      lat: null,
      lon: null,
      island: null,
      parentPlaceId: null,
    };
    newPlaces.push(place);
    byKey.set(normalise(city.name), place);
    resolved.push({ city, place, existing: false });
    if (city.island) islandOf.set(id, islandName(city));
  }

  for (const r of resolved) {
    const parentName = COUNTRY_WIDE_PLACE[r.city.country];
    const parent = parentName ? byKey.get(normalise(parentName)) : undefined;
    if (parent && parent.id !== r.place.id) parentOf.set(r.place.id, parent.id);
  }

  const codeOf = (place: Place) => place.id.replace(/[^a-z0-9]/gi, "").toUpperCase();

  function contentFor(city: City, place: Place): DestinationContent {
    const attractions: Attraction[] = [];
    const clusters: Cluster[] = [];
    const activities: Activity[] = [];
    city.clusters.forEach((c, ci) => {
      clusters.push({
        id: `${place.id}-c${ci + 1}`,
        placeId: place.id,
        name: c.name,
        attractions: c.attractions,
        recommendedDuration: `${c.hours} hours`,
        durationHours: c.hours,
        walkingIntensity: WALK[c.walk],
      });
      activities.push({
        id: `${place.id}-act${ci + 1}`,
        placeId: place.id,
        code: `${codeOf(place)}_A_${c.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`,
        name: c.name,
      });
      c.attractions.forEach((a, ai) => {
        attractions.push({
          id: `${place.id}-a${ci + 1}-${ai + 1}`,
          placeId: place.id,
          name: a,
          priority: Math.max(40, 95 - ci * 8 - ai * 3),
        });
      });
    });

    const area: Area = {
      id: `${place.id}-centre`,
      placeId: place.id,
      name: "Central area",
      priceLevel: null,
      transportConvenience: null,
      bestFor: [],
      advantages: [],
      disadvantages: [],
      recommendedFor: [],
      zone: "Central",
    };

    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const best = city.best.includes(month);
      const peak = city.peak.includes(month);
      const weather = best ? 90 : 62;
      const price = peak ? 90 : best ? 72 : 55;
      return {
        placeId: place.id,
        month,
        weather,
        crowd: peak ? 88 : best ? 70 : 50,
        price,
        overall: Math.round((weather + (100 - price) + 60) / 3 + (best ? 12 : 0)),
        recommendation: null,
      };
    });

    const [minN, idealN, maxN] = city.nights;
    return {
      destination: {
        placeId: place.id,
        destinationCode: city.iata,
        shortDescription: city.summary,
        agentSummary: city.summary,
        destinationTypes: city.types,
        currency: null,
        timezone: null,
        minNights: minN,
        idealNights: Math.max(minN, idealN),
        maxNights: Math.max(minN, idealN, maxN),
        gettingAround: [],
        primaryAirports: city.iata ? [city.iata] : [],
        overallCostLevel: costWords(city.cost),
      },
      suitability: [],
      tags: [],
      months,
      areas: [area],
      attractions,
      activities,
      purposeActivities: [],
      clusters,
      guidance: [],
      decisionRules: [],
    };
  }

  const ownContent = new Set<string>();

  return {
    cities: resolved,
    newPlaces,
    islandOf,
    parentOf,
    applyContent(byPlaceId) {
      let n = 0;
      for (const { city, place } of resolved) {
        if (byPlaceId.has(place.id)) continue;
        byPlaceId.set(place.id, contentFor(city, place));
        ownContent.add(place.id);
        n++;
      }
      return n;
    },
    applyPricing(pricing) {
      let n = 0;
      const priced = new Set(pricing.activityRates.map((r) => r.placeId));
      for (const { city, place } of resolved) {
        if (!ownContent.has(place.id) || priced.has(place.id)) continue;
        const content = contentFor(city, place);
        pricing.activities.push(...content.activities);
        city.clusters.forEach((c, i) => {
          pricing.activityRates.push({
            placeId: place.id,
            code: content.activities[i].code,
            unit: "Person",
            inr: Math.round(c.eur * EUR_INR),
            baseline: c.eur,
            baselineCurrency: "EUR",
            source: "estimated",
          });
        });
        n++;
      }
      return n;
    },
    applyCoords(points) {
      for (const { city, place } of resolved) points.set(place.id, { lat: city.lat, lon: city.lng });
      // A whole-country place used to sit on the capital, which is now a city of
      // its own. Re-centre it on its cities so no two places share a coordinate.
      const children = new Map<string, { lat: number; lon: number }[]>();
      for (const { city, place } of resolved) {
        const parent = parentOf.get(place.id);
        if (!parent) continue;
        const list = children.get(parent) ?? [];
        list.push({ lat: city.lat, lon: city.lng });
        children.set(parent, list);
      }
      for (const [parent, list] of children) {
        points.set(parent, {
          lat: list.reduce((s, p) => s + p.lat, 0) / list.length,
          lon: list.reduce((s, p) => s + p.lon, 0) / list.length,
        });
      }
    },
  };
}
