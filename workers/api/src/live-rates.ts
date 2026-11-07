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
import { limitByIp } from "./rate-limit";

export type LiveRate = {
  component: "flight" | "hotel";
  key: string;
  inr: number;
  fetchedAt: string;
  /** `google-flights` is exact for the traveller's dates and cabin; `travelpayouts` is a cached monthly minimum. */
  provider?: "google-flights" | "travelpayouts";
};

const CACHE_SECONDS = 6 * 60 * 60;
/** An empty answer is remembered briefly, so a route with no data does not hit the paid upstream on every keystroke. */
const EMPTY_CACHE_SECONDS = 15 * 60;
const UPSTREAM_TIMEOUT_MS = 8000;
/** A flight is worth waiting for: Google Flights searches routinely take 5 to 10 seconds. */
const FLIGHT_TIMEOUT_MS = 20_000;
/**
 * Fares move through the day and a SerpApi search is billed, so a fare is
 * reused for a couple of hours: fresh enough to be what anyone sees, cheap
 * enough that the same route does not cost a search per visitor.
 */
const FLIGHT_CACHE_SECONDS = 2 * 60 * 60;
/** Google Flights sells about eleven months ahead. */
const MAX_DAYS_AHEAD = 330;

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
    const ttl = rates.length ? (rates.some((r) => r.component === "flight") ? FLIGHT_CACHE_SECONDS : CACHE_SECONDS) : EMPTY_CACHE_SECONDS;
    await env.RATE_CACHE.put(key, JSON.stringify(rates), { expirationTtl: ttl });
  }
}

export type Cabin = "Economy" | "Premium Economy" | "Business";
/** Google Flights `travel_class`: 1 economy, 2 premium economy, 3 business. */
const TRAVEL_CLASS: Record<Cabin, number> = { Economy: 1, "Premium Economy": 2, Business: 3 };

type SerpOffer = { price?: number; flights?: { flight_number?: string }[] };

/**
 * Cheapest offer in the traveller's carrier class. An offer is low-cost only if
 * every leg is on a low-cost carrier (the IATA code leads the flight number).
 * With none in the class the cheapest of all is used, as the Aviasales path
 * does, so a route nobody flies low-cost still gets a fare.
 */
export function cheapestOffer(offers: SerpOffer[], carrier: "LCC" | "FSC"): number | null {
  const priced = offers.filter((o) => typeof o.price === "number" && o.price > 0);
  if (!priced.length) return null;
  const inClass = priced.filter((o) => {
    const legs = o.flights ?? [];
    if (!legs.length) return false;
    const allLcc = legs.every((l) => LCC_CARRIERS.has((l.flight_number ?? "").split(" ")[0].toUpperCase()));
    return carrier === "LCC" ? allLcc : !allLcc;
  });
  return Math.min(...(inClass.length ? inClass : priced).map((o) => o.price!));
}

/**
 * The fare Google Flights shows for this route on these dates, via SerpApi.
 * One adult is searched: `price` is the total for everyone searched, and the
 * engine scales a per-person fare to the party (children and infants pay less).
 */
async function fetchGoogleFlight(
  env: Env,
  origin: string,
  destination: string,
  outbound: string,
  inbound: string,
  cabin: Cabin,
  carrier: "LCC" | "FSC",
  fareKey: string,
): Promise<LiveRate | null> {
  if (!env.SERP_API) return null;

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", outbound);
  url.searchParams.set("return_date", inbound);
  url.searchParams.set("type", "1"); // round trip
  url.searchParams.set("travel_class", String(TRAVEL_CLASS[cabin]));
  url.searchParams.set("adults", "1");
  url.searchParams.set("currency", "INR");
  url.searchParams.set("gl", "in");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", env.SERP_API);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FLIGHT_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = (await res.json()) as { error?: string; best_flights?: SerpOffer[]; other_flights?: SerpOffer[] };
  if (body.error) return null;

  const cheapest = cheapestOffer([...(body.best_flights ?? []), ...(body.other_flights ?? [])], carrier);
  if (cheapest == null) return null;

  return {
    component: "flight",
    key: `${origin}:${fareKey}:${carrier}`,
    inr: cheapest,
    fetchedAt: new Date().toISOString(),
    provider: "google-flights",
  };
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
  fareKey: string,
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
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
    // The engine looks a fare up by the destination country's id, which the
    // caller passes as `fareKey`; the airport code only drives the search.
    key: `${origin}:${fareKey}:${carrier}`,
    inr: cheapest,
    fetchedAt: new Date().toISOString(),
    provider: "travelpayouts",
  };
}

/** Currencies the rate card quotes in. Anything else has no rows to rescale. */
const FX_CURRENCIES = ["USD", "EUR"] as const;

export type FxResult = { rates: Record<string, number>; fetchedAt: string };

/**
 * Rupees per unit of each card currency, from the ECB's reference rates via
 * Frankfurter (free, no key), with a second public provider as the fallback.
 * Both are daily rates, so a six-hour cache loses nothing.
 */
async function fetchFx(): Promise<FxResult | null> {
  const rates: Record<string, number> = {};
  await Promise.all(
    FX_CURRENCIES.map(async (ccy) => {
      try {
        const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${ccy}&symbols=INR`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        if (!res.ok) return;
        const inr = ((await res.json()) as { rates?: { INR?: number } }).rates?.INR;
        if (typeof inr === "number" && inr > 0) rates[ccy] = inr;
      } catch {
        /* try the fallback below */
      }
    }),
  );
  if (Object.keys(rates).length < FX_CURRENCIES.length) {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (res.ok) {
        const body = (await res.json()) as { rates?: Record<string, number> };
        const usdInr = body.rates?.INR;
        const eur = body.rates?.EUR;
        if (usdInr && usdInr > 0) rates.USD ??= usdInr;
        if (usdInr && eur && eur > 0) rates.EUR ??= usdInr / eur;
      }
    } catch {
      /* no rate is better than a bad one */
    }
  }
  return Object.keys(rates).length ? { rates, fetchedAt: new Date().toISOString() } : null;
}

async function handleFx(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const headers = { "Cache-Control": `public, max-age=${CACHE_SECONDS}` };
  const key = "fx:inr";
  if (env.RATE_CACHE) {
    const hit = (await env.RATE_CACHE.get(key, "json")) as FxResult | null;
    if (hit) return json({ rates: [], fx: hit, cached: true }, { headers });
  }
  // Only a cache miss reaches the upstream, so only a miss counts against the caller.
  if (await limitByIp(request, env, "live-fx", 30, 600)) return json({ rates: [], fx: null, cached: false }, { headers: { "Cache-Control": "public, max-age=300" } });
  const fx = await fetchFx();
  if (fx && env.RATE_CACHE) ctx.waitUntil(env.RATE_CACHE.put(key, JSON.stringify(fx), { expirationTtl: CACHE_SECONDS }));
  return json({ rates: [], fx, cached: false }, { headers: fx ? headers : { "Cache-Control": "public, max-age=300" } });
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
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
  if (url.searchParams.get("fx") === "1") return handleFx(request, env, ctx);
  const origin = url.searchParams.get("origin") ?? "";
  const fareKey = url.searchParams.get("fareKey") ?? "";
  const destinationIata = url.searchParams.get("destinationIata") ?? "";
  const month = url.searchParams.get("month") ?? "";
  const carrier = (url.searchParams.get("carrier") ?? "FSC") as "LCC" | "FSC";
  const outbound = url.searchParams.get("outbound") ?? "";
  const inbound = url.searchParams.get("inbound") ?? "";
  const cabin = (url.searchParams.get("cabin") ?? "Economy") as Cabin;
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

  // This is public and every distinct query is a billable upstream call plus a cache row, so anything
  // that is not the shape of a real query gets the same answer as "no data": an empty result.
  const none = () => json({ rates: [], cached: false }, { headers: { "Cache-Control": "public, max-age=300" } });
  const wantsFlight = Boolean(origin && destinationIata && month);
  const wantsHotel = Boolean(cityName && countryCode && checkin && checkout);
  if (wantsFlight && fareKey && !/^[a-z0-9-]{1,60}$/.test(fareKey)) return none();
  if (wantsFlight && !(/^[A-Z]{3}$/.test(origin) && /^[A-Z]{3}$/.test(destinationIata) && /^\d{4}-\d{2}$/.test(month) && (carrier === "LCC" || carrier === "FSC"))) return none();
  // Exact dates are optional (the month search still works without them), but when given they must be a real, bookable trip.
  const wantsExact = wantsFlight && Boolean(outbound && inbound);
  if (wantsExact) {
    const ahead = (Date.parse(outbound) - Date.now()) / 86_400_000;
    const length = (Date.parse(inbound) - Date.parse(outbound)) / 86_400_000;
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(outbound) && /^\d{4}-\d{2}-\d{2}$/.test(inbound) &&
      ahead >= 0 && ahead <= MAX_DAYS_AHEAD && length >= 1 && length <= 60 && cabin in TRAVEL_CLASS;
    if (!valid || outbound.slice(0, 7) !== month) return none();
  }
  if (wantsHotel) {
    const stay = (Date.parse(checkout) - Date.parse(checkin)) / 86_400_000;
    const validStay = /^\d{4}-\d{2}-\d{2}$/.test(checkin) && /^\d{4}-\d{2}-\d{2}$/.test(checkout) && stay >= 1 && stay <= 30;
    if (!validStay || !/^[A-Za-z]{2}$/.test(countryCode) || cityName.length > 60 || placeId.length > 80 || star.length > 20) return none();
  }

  // Everything that changes the upstream answer belongs in the key; the party
  // in particular, or one traveller's room count is served to the next.
  const partyKey = `${party.adults}:${party.childAges.join(",")}:${party.rooms}`;
  const cacheKey =
    `live:${origin}:${destinationIata}:${fareKey}:${month}:${carrier}:${outbound}:${inbound}:${cabin}:` +
    `${cityName}:${countryCode}:${checkin}:${checkout}:${partyKey}:${hotelStars ?? ""}:${placeId}:${star}`;

  const respond = (rates: LiveRate[], cached: boolean) =>
    json({ rates, cached }, {
      headers: { "Cache-Control": `public, max-age=${rates.some((r) => r.component === "flight") ? FLIGHT_CACHE_SECONDS : CACHE_SECONDS}` },
    });

  const cached = await fromCache(env, cacheKey);
  if (cached) return respond(cached, true);

  // Only upstream-bound misses count against the caller, so ordinary browsing is never limited.
  if (wantsFlight || wantsHotel) {
    if (await limitByIp(request, env, "live-rates", 90, 600)) return none();
  }

  // The traveller's own dates and cabin first; the monthly minimum only when that finds nothing.
  const flightFare = async (): Promise<LiveRate | null> => {
    if (!wantsFlight) return null;
    const key = fareKey || destinationIata;
    if (wantsExact) {
      try {
        const exact = await fetchGoogleFlight(env, origin, destinationIata, outbound, inbound, cabin, carrier, key);
        if (exact) return exact;
      } catch {
        /* fall through to the approximate fare */
      }
    }
    return fetchFlight(env, origin, destinationIata, month, carrier, key);
  };

  const results = await Promise.allSettled([
    flightFare(),
    cityName && countryCode && checkin && checkout
      ? fetchHotel(env, cityName, countryCode, checkin, checkout, party, `${placeId}:${star}`, hotelStars)
      : Promise.resolve(null),
  ]);

  const rates = results
    .filter((r): r is PromiseFulfilledResult<LiveRate | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is LiveRate => r != null);

  // Remember "nothing" only when an upstream was actually asked; with no keys configured it would just burn KV writes.
  if (rates.length || env.SERP_API || env.TRAVELPAYOUTS_TOKEN || env.LITEAPI_KEY) ctx.waitUntil(toCache(env, cacheKey, rates));

  return respond(rates, false);
}
