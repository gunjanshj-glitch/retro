/**
 * Live-rate proxy — the second-level check over the compiled rate card.
 *
 * Moved here from `functions/api/live-rates.ts` when the deployment split into
 * a frontend and a backend Worker; the logic is unchanged. It runs server-side
 * so API keys stay off the client, and both upstreams stay optional: with no
 * keys configured this returns an empty result and the quotation falls back to
 * the compiled baseline, so the site works identically without any integration.
 *
 * Responses are cached (KV when bound) because both providers ask callers to
 * cache rather than hammer them, and because it keeps the free tiers
 * comfortable.
 */
import type { Env } from "./http";
import { json } from "./http";

export type LiveRate = {
  component: "flight" | "hotel";
  key: string;
  inr: number;
  fetchedAt: string;
};

const CACHE_SECONDS = 6 * 60 * 60;

/** Carriers that price as low-cost, so the engine can honour the LCC/FSC choice. */
const LCC_CARRIERS = new Set([
  "6E", "SG", "QP", "IX", "G8", "AK", "D7", "FD", "TR", "JT", "QZ", "VJ",
  "5J", "Z2", "PQ", "U2", "FR", "W6", "VY", "PC", "XY", "J9", "G9", "3L",
]);

async function fromCache(env: Env, key: string): Promise<LiveRate[] | null> {
  if (env.RATE_CACHE) {
    const hit = await env.RATE_CACHE.get(key, "json");
    return (hit as LiveRate[] | null) ?? null;
  }
  return null;
}

async function toCache(env: Env, key: string, rates: LiveRate[]): Promise<void> {
  if (env.RATE_CACHE) {
    await env.RATE_CACHE.put(key, JSON.stringify(rates), { expirationTtl: CACHE_SECONDS });
  }
}

/**
 * Cheapest cached round-trip fare for a month. Travelpayouts returns prices
 * already converted when `currency=inr` is passed.
 */
async function fetchFlight(
  env: Env,
  origin: string,
  destination: string,
  month: string,
  carrier: "LCC" | "FSC",
): Promise<LiveRate | null> {
  if (!env.TRAVELPAYOUTS_TOKEN) return null;

  const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("departure_at", month);
  url.searchParams.set("one_way", "false");
  url.searchParams.set("currency", "inr");
  url.searchParams.set("sorting", "price");
  url.searchParams.set("limit", "30");

  const res = await fetch(url.toString(), {
    headers: { "X-Access-Token": env.TRAVELPAYOUTS_TOKEN },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    data?: { price?: number; airline?: string }[];
  };
  const offers = (body.data ?? []).filter((o) => typeof o.price === "number" && o.price > 0);
  if (!offers.length) return null;

  // Honour the traveller's carrier preference where the data supports it.
  const matching = offers.filter((o) => {
    const isLcc = LCC_CARRIERS.has((o.airline ?? "").toUpperCase());
    return carrier === "LCC" ? isLcc : !isLcc;
  });
  const pool = matching.length ? matching : offers;
  const cheapest = Math.min(...pool.map((o) => o.price!));

  return {
    component: "flight",
    key: `${origin}:${destination}:${carrier}`,
    inr: cheapest,
    fetchedAt: new Date().toISOString(),
  };
}

export type Party = { adults: number; childAges: number[]; rooms: number };

type Occupancy = { adults: number; children?: number[] };

/**
 * Spreads the party over the rooms the traveller asked for, one adult in every
 * room first (a child cannot hold a room alone), then the rest round-robin.
 * Rooms are clamped to what the party can fill, so a bad query degrades to a
 * sensible search rather than an upstream error.
 */
export function occupanciesFor({ adults, childAges, rooms }: Party): Occupancy[] {
  const count = Math.max(1, Math.min(Math.floor(rooms) || 1, adults));
  const out: { adults: number; children: number[] }[] = Array.from({ length: count }, () => ({
    adults: 1,
    children: [],
  }));
  for (let i = count; i < adults; i++) out[i % count].adults++;
  childAges.forEach((age, i) => out[i % count].children.push(age));
  return out.map((o) => (o.children.length ? o : { adults: o.adults }));
}

/** Reads the party from the query, defaulting to a couple in one room. */
export function partyFromQuery(params: URLSearchParams): Party {
  const adults = Math.max(1, Math.min(40, parseInt(params.get("adults") ?? "", 10) || 2));
  const childAges = (params.get("childAges") ?? "")
    .split(",")
    .map((a) => parseInt(a, 10))
    .filter((a) => Number.isFinite(a) && a >= 0 && a <= 17)
    .slice(0, 10);
  const requested = parseInt(params.get("rooms") ?? "", 10);
  const rooms = Number.isFinite(requested) && requested > 0 ? requested : Math.ceil(adults / 2);
  return { adults, childAges, rooms: Math.min(rooms, adults) };
}

/**
 * Median per-room, per-night rate for a city, used to sanity-check the
 * compiled hotel card. Searched for the traveller's actual party and rooms.
 */
async function fetchHotel(
  env: Env,
  cityName: string,
  countryCode: string,
  checkin: string,
  checkout: string,
  party: Party,
  key: string,
  stars: number | null,
): Promise<LiveRate | null> {
  if (!env.LITEAPI_KEY) return null;

  const nights = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000);
  if (!Number.isFinite(nights) || nights < 1) return null;
  const occupancies = occupanciesFor(party);

  const res = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
    method: "POST",
    headers: {
      "X-API-Key": env.LITEAPI_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cityName,
      countryCode,
      checkin,
      checkout,
      occupancies,
      currency: "INR",
      guestNationality: "IN",
      // Needed to know each hotel's category so the median can be taken over
      // the star rating the traveller chose.
      includeHotelData: true,
      limit: 25,
    }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    hotels?: { id?: string; starRating?: number }[];
    data?: {
      hotelId?: string;
      roomTypes?: { rates?: { retailRate?: { total?: { amount?: number }[] } }[] }[];
    }[];
  };

  // Restrict to the chosen category where the response says what each hotel
  // is. If it carries no ratings, or none match, searching all categories is
  // better than no live figure at all — the engine clamps the result anyway.
  const starOf = new Map((body.hotels ?? []).map((h) => [h.id, h.starRating]));
  const all = body.data ?? [];
  const inCategory =
    stars == null
      ? all
      : all.filter((h) => {
          const rating = starOf.get(h.hotelId);
          return typeof rating === "number" && Math.round(rating) === stars;
        });

  const amounts: number[] = [];
  for (const hotel of inCategory.length ? inCategory : all) {
    for (const room of hotel.roomTypes ?? []) {
      for (const rate of room.rates ?? []) {
        for (const total of rate.retailRate?.total ?? []) {
          if (typeof total.amount === "number" && total.amount > 0) amounts.push(total.amount);
        }
      }
    }
  }
  if (!amounts.length) return null;

  // Median rather than minimum: the cheapest listing is rarely comparable to a
  // contracted category rate. Upstream totals cover every room for the whole
  // stay; the engine prices a room-night, so normalise to that.
  amounts.sort((a, b) => a - b);
  const median = amounts[amounts.length >> 1] / (nights * occupancies.length);

  return {
    component: "hotel",
    key,
    inr: median,
    fetchedAt: new Date().toISOString(),
  };
}

export async function handleLiveRates(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.searchParams.get("origin") ?? "";
  const destinationIata = url.searchParams.get("destinationIata") ?? "";
  const month = url.searchParams.get("month") ?? "";
  const carrier = (url.searchParams.get("carrier") ?? "FSC") as "LCC" | "FSC";
  const cityName = url.searchParams.get("cityName") ?? "";
  const countryCode = url.searchParams.get("countryCode") ?? "";
  const checkin = url.searchParams.get("checkin") ?? "";
  const checkout = url.searchParams.get("checkout") ?? "";
  const party = partyFromQuery(url.searchParams);
  // The engine looks hotel rates up as `${placeId}:${star}`, so echo the pair
  // back as the key; the star number filters the search.
  const placeId = url.searchParams.get("placeId") ?? "";
  const star = url.searchParams.get("star") ?? "";
  const stars = parseInt(star.match(/\d/)?.[0] ?? "", 10);
  const hotelStars = Number.isFinite(stars) && stars >= 1 && stars <= 5 ? stars : null;

  // Everything that changes the upstream answer belongs in the key; the party
  // in particular, or one traveller's room count is served to the next.
  const partyKey = `${party.adults}:${party.childAges.join(",")}:${party.rooms}`;
  const cacheKey =
    `live:${origin}:${destinationIata}:${month}:${carrier}:` +
    `${cityName}:${countryCode}:${checkin}:${checkout}:${partyKey}:${hotelStars ?? ""}:${placeId}:${star}`;

  const respond = (rates: LiveRate[], cached: boolean) =>
    json({ rates, cached }, {
      headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
    });

  const cached = await fromCache(env, cacheKey);
  if (cached) return respond(cached, true);

  const results = await Promise.allSettled([
    origin && destinationIata && month
      ? fetchFlight(env, origin, destinationIata, month, carrier)
      : Promise.resolve(null),
    cityName && countryCode && checkin && checkout
      ? fetchHotel(env, cityName, countryCode, checkin, checkout, party, `${placeId}:${star}`, hotelStars)
      : Promise.resolve(null),
  ]);

  const rates = results
    .filter((r): r is PromiseFulfilledResult<LiveRate | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is LiveRate => r != null);

  if (rates.length) ctx.waitUntil(toCache(env, cacheKey, rates));

  return respond(rates, false);
}
