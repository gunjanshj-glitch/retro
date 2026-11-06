/**
 * Live Google rating and review count for the public site.
 *
 * The site is a static export, so numbers baked in at build time go stale the
 * moment someone leaves a review. The browser calls this instead; the Places
 * key stays on the Worker. The answer is cached in KV (and by the edge via
 * Cache-Control), so Google is hit at most once per CACHE_SECONDS regardless of
 * traffic. With no key, or if Google fails, it answers `{ available: false }`
 * and the page keeps the figures it was built with.
 */
import type { Env } from "./http";
import { json } from "./http";

const CACHE_SECONDS = 60 * 60; // refresh at most hourly
const STALE_SECONDS = 24 * 60 * 60; // keep serving the last good value if Google is down
const UPSTREAM_TIMEOUT_MS = 6000;
const DEFAULT_PLACE_ID = "ChIJizsp6p9xAjoRZfxE0TsOFfk";
const KV_KEY = "google-reviews:v1";

export type GoogleReviewsPayload = {
  available: true;
  rating: number;
  total: number;
  reviews: { name: string; date: string; stars: number; text: string; initial: string }[];
  fetchedAt: string;
};

type Places = {
  rating?: number;
  userRatingCount?: number;
  reviews?: {
    rating?: number;
    relativePublishTimeDescription?: string;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
  }[];
};

async function fetchFromGoogle(env: Env): Promise<GoogleReviewsPayload | null> {
  if (!env.GOOGLE_PLACES_API_KEY) return null;
  const placeId = env.GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": "rating,userRatingCount,reviews" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Places;
  if (typeof data.rating !== "number") return null;

  const reviews = (data.reviews ?? [])
    .map((r) => {
      const name = r.authorAttribution?.displayName?.trim() ?? "";
      return {
        name,
        date: r.relativePublishTimeDescription ?? "",
        stars: Math.round(r.rating ?? 0),
        text: (r.text?.text ?? r.originalText?.text ?? "").trim(),
        initial: name.charAt(0).toUpperCase() || "G",
      };
    })
    .filter((r) => r.name && r.text);

  return {
    available: true,
    rating: data.rating,
    total: data.userRatingCount ?? reviews.length,
    reviews,
    fetchedAt: new Date().toISOString(),
  };
}

export async function handleGoogleReviews(_request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const headers = { "Cache-Control": `public, max-age=${CACHE_SECONDS}` };

  const cached = env.RATE_CACHE ? ((await env.RATE_CACHE.get(KV_KEY, "json")) as GoogleReviewsPayload | null) : null;
  const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_SECONDS * 1000;
  if (cached && fresh) return json(cached, { headers });

  let live: GoogleReviewsPayload | null = null;
  try {
    live = await fetchFromGoogle(env);
  } catch {
    live = null;
  }

  if (live) {
    if (env.RATE_CACHE) ctx.waitUntil(env.RATE_CACHE.put(KV_KEY, JSON.stringify(live), { expirationTtl: STALE_SECONDS }));
    return json(live, { headers });
  }
  // Google failed or is unconfigured: last good value if we have one, else "unavailable".
  if (cached) return json(cached, { headers: { "Cache-Control": "public, max-age=300" } });
  return json({ available: false }, { headers: { "Cache-Control": "public, max-age=300" } });
}
