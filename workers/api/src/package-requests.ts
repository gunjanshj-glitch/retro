/**
 * Package quote requests.
 *
 * The "Request a quote" form on a package page lands here. It only records
 * the request — someone at the agency prices it by hand and writes the quote
 * back onto the same row (`quoted_amount_inr`, `quote_note`), which the
 * traveller then sees on their dashboard.
 */
import type { Env } from "./http";
import { badRequest, field, json, readJson } from "./http";
import { getSessionUser, requireAuth } from "./auth";

const TRIP_TYPES = ["family", "couple", "friends", "stags", "business", "pilgrimage", "solo"] as const;
const HOTEL_STARS = ["3 Star", "4 Star", "5 Star", "Luxury 5 Star"] as const;
const FOOD = ["no-preference", "veg", "non-veg", "vegan", "jain", "halal"] as const;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IATA_RE = /^[A-Z]{3}$/;

/** Bounds how fast one account can add rows; a real traveller never gets near it. */
const MAX_PER_HOUR = 10;

type Body = Record<string, unknown>;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function intInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export async function handleCreatePackageRequest(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const body = await readJson<Body>(request, 16 * 1024);
  if (!body || typeof body !== "object") return badRequest("Malformed or oversized request body.");

  const destinationSlug = field(body.destinationSlug, 80);
  const packageSlug = field(body.packageSlug, 80);
  const destinationName = field(body.destinationName, 120);
  const packageName = field(body.packageName, 160);
  if (!destinationSlug || !packageSlug || !SLUG_RE.test(destinationSlug) || !SLUG_RE.test(packageSlug)) {
    return badRequest("Which package is this request for?");
  }
  if (!destinationName || !packageName) return badRequest("Package details are missing.");

  const tripType = oneOf(body.tripType, TRIP_TYPES);
  if (!tripType) return badRequest("Choose the type of trip.");

  const adults = intInRange(body.adults, 1, 40);
  if (adults == null) return badRequest("Number of adults must be between 1 and 40.");
  const children = intInRange(body.children ?? 0, 0, 20);
  if (children == null) return badRequest("Number of children must be between 0 and 20.");

  let startDate: string | null = null;
  if (body.startDate != null && body.startDate !== "") {
    if (typeof body.startDate !== "string" || !DATE_RE.test(body.startDate) || Number.isNaN(Date.parse(body.startDate))) {
      return badRequest("Travel date must be a valid date.");
    }
    startDate = body.startDate;
  }

  const departureCity = typeof body.departureCity === "string" && IATA_RE.test(body.departureCity) ? body.departureCity : null;
  if (!departureCity) return badRequest("Choose where you are departing from.");

  const hotelStar = oneOf(body.hotelStar, HOTEL_STARS);
  if (!hotelStar) return badRequest("Choose a hotel category.");
  const food = oneOf(body.food, FOOD);
  if (!food) return badRequest("Choose a food preference.");

  const includeFlights = body.includeFlights === true ? 1 : 0;
  const notes = field(body.notes, 1000);

  // The package as the traveller saw it. Capped and re-serialised so nothing
  // arbitrary is stored, whatever the client sent.
  const snap = (typeof body.package === "object" && body.package ? body.package : {}) as Body;
  const packageSnapshot = JSON.stringify({
    places: Array.isArray(snap.places)
      ? snap.places.filter((p): p is string => typeof p === "string").slice(0, 40).map((p) => p.slice(0, 80))
      : [],
    days: typeof snap.days === "number" && Number.isFinite(snap.days) ? snap.days : null,
    priceFromInr: typeof snap.priceFromInr === "number" && Number.isFinite(snap.priceFromInr) ? snap.priceFromInr : null,
  });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM package_request WHERE user_id = ? AND created_at > ?`,
  )
    .bind(user!.id, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PER_HOUR) {
    return json({ error: "You've sent several requests in a short time. Please try again a little later." }, { status: 429 });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO package_request (
       id, created_at, user_id, user_name, user_email, status,
       destination_slug, destination_name, package_slug, package_name,
       trip_type, adults, children, start_date, departure_city, hotel_star,
       include_flights, food, notes, package_snapshot
     ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, new Date().toISOString(), user!.id, user!.name, user!.email,
      destinationSlug, destinationName, packageSlug, packageName,
      tripType, adults, children, startDate, departureCity, hotelStar,
      includeFlights, food, notes, packageSnapshot,
    )
    .run();

  return json({ ok: true, id }, { status: 201 });
}

type Row = {
  id: string;
  created_at: string;
  status: string;
  destination_name: string;
  destination_slug: string;
  package_name: string;
  package_slug: string;
  trip_type: string;
  adults: number;
  children: number;
  start_date: string | null;
  departure_city: string;
  hotel_star: string;
  include_flights: number;
  quoted_amount_inr: number | null;
  quote_note: string | null;
  quoted_at: string | null;
};

export async function handleListPackageRequests(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, status, destination_name, destination_slug, package_name, package_slug,
            trip_type, adults, children, start_date, departure_city, hotel_star, include_flights,
            quoted_amount_inr, quote_note, quoted_at
       FROM package_request WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(user!.id)
    .all<Row>();

  return json({
    requests: results.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      destinationName: r.destination_name,
      destinationSlug: r.destination_slug,
      packageName: r.package_name,
      packageSlug: r.package_slug,
      tripType: r.trip_type,
      adults: r.adults,
      children: r.children,
      startDate: r.start_date,
      departureCity: r.departure_city,
      hotelStar: r.hotel_star,
      includeFlights: r.include_flights === 1,
      quote:
        r.quoted_amount_inr != null
          ? { amountInr: r.quoted_amount_inr, note: r.quote_note, quotedAt: r.quoted_at }
          : null,
    })),
  });
}
