/**
 * Admin routes for package quote requests: list everything, write a quote
 * back onto a request, or close one.
 *
 * Who is an admin: a signed-in account whose email is in `ADMIN_EMAILS`
 * (default info@retroholidays.in) AND which signed in with Google AND has no
 * password. Email/password sign-up never verifies the address, so anyone could
 * register `info@retroholidays.in` with a password of their own and, with an
 * email-only check, become admin. Google vouches for the address; the
 * no-password rule stops a squatter's pre-registered account (which Google
 * sign-in would otherwise link to by email) from keeping a back door.
 */
import type { Env } from "./http";
import { badRequest, field, json, notFound, parseCookies, readJson, SESSION_COOKIE } from "./http";

const DEFAULT_ADMINS = "info@retroholidays.in";

type AdminUser = { id: string; email: string };

export async function getAdminUser(request: Request, env: Env): Promise<AdminUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.auth_provider AS auth_provider, u.password_hash AS password_hash
       FROM session s JOIN user u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(token, new Date().toISOString())
    .first<{ id: string; email: string; auth_provider: string | null; password_hash: string | null }>();
  if (!row) return null;

  const admins = (env.ADMIN_EMAILS || DEFAULT_ADMINS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.includes(row.email.toLowerCase())) return null;
  if (row.auth_provider !== "google" || row.password_hash) return null;
  return { id: row.id, email: row.email };
}

function forbidden(): Response {
  // 404 rather than 403 so the route doesn't advertise itself to everyone else.
  return notFound();
}

type Row = {
  id: string;
  created_at: string;
  status: string;
  user_name: string;
  user_email: string;
  destination_name: string;
  package_name: string;
  package_slug: string;
  destination_slug: string;
  trip_type: string;
  adults: number;
  children: number;
  start_date: string | null;
  departure_city: string;
  hotel_star: string;
  include_flights: number;
  food: string;
  notes: string | null;
  quoted_amount_inr: number | null;
  quote_note: string | null;
  quoted_at: string | null;
};

export async function handleAdminList(request: Request, env: Env): Promise<Response> {
  if (!(await getAdminUser(request, env))) return forbidden();

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, status, user_name, user_email, destination_name, destination_slug,
            package_name, package_slug, trip_type, adults, children, start_date, departure_city,
            hotel_star, include_flights, food, notes, quoted_amount_inr, quote_note, quoted_at
       FROM package_request
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 300`,
  ).all<Row>();

  return json({
    requests: results.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      userName: r.user_name,
      userEmail: r.user_email,
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
      food: r.food,
      notes: r.notes,
      quote:
        r.quoted_amount_inr != null
          ? { amountInr: r.quoted_amount_inr, note: r.quote_note, quotedAt: r.quoted_at }
          : null,
    })),
  });
}

export async function handleAdminQuote(
  id: string,
  action: "quote" | "close",
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await getAdminUser(request, env))) return forbidden();

  let result: D1Result;
  if (action === "close") {
    result = await env.DB.prepare(`UPDATE package_request SET status = 'closed' WHERE id = ?`).bind(id).run();
  } else {
    const body = await readJson<Record<string, unknown>>(request, 8 * 1024);
    if (!body || typeof body !== "object") return badRequest("Malformed request body.");
    const amount = body.amountInr;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      return badRequest("Enter the quote amount in rupees.");
    }
    const note = field(body.note, 1000);
    result = await env.DB.prepare(
      `UPDATE package_request
          SET status = 'quoted', quoted_amount_inr = ?, quote_note = ?, quoted_at = ?
        WHERE id = ?`,
    )
      .bind(Math.round(amount), note, new Date().toISOString(), id)
      .run();
  }

  if (!result.meta?.changes) return notFound("No such request.");
  return json({ ok: true });
}
