/**
 * Final-approval requests.
 *
 * A quotation is generated and recomputed entirely client-side (the engine is
 * pure — see quotes.ts), which is what keeps the planner instant. This is the
 * one point a quotation stops being a live, replayable thing and becomes a
 * fixed record: the traveller has asked a person to check it, so the full
 * snapshot they saw — request, priced itinerary, every optional add-on and
 * its final price — is captured exactly as shown and never touched again,
 * independent of whatever the engine or rate card look like on a later day.
 */
import type { Env } from "./http";
import { badRequest, field, json, notFound, readJson } from "./http";
import { getSessionUser, requireAuth } from "./auth";
import { sendReviewEmail } from "./email";

/** A full quotation snapshot is itinerary-sized; generous but still bounded. */
const MAX_BODY_BYTES = 256 * 1024;

type CreateRequestBody = {
  request?: unknown;
  quotation?: unknown;
  destinationSummary?: unknown;
  totals?: { total?: unknown; perPerson?: unknown };
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function handleCreateRequest(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const body = await readJson<CreateRequestBody>(request, MAX_BODY_BYTES);
  if (!body) return badRequest("Malformed or oversized request body.");

  if (!isPlainObject(body.request) || !isPlainObject(body.quotation)) {
    return badRequest("Both the quote request and the computed quotation are required.");
  }

  const req = body.request as Record<string, unknown>;
  const placeIds = Array.isArray(req.placeIds) ? req.placeIds : [];
  const nights = typeof req.nights === "number" ? req.nights : null;
  const startDate = typeof req.startDate === "string" ? req.startDate : null;
  if (!placeIds.length || nights == null || !startDate) {
    return badRequest("The quote request must carry placeIds, nights and startDate.");
  }

  const total = Number(body.totals?.total ?? 0);
  const perPerson = Number(body.totals?.perPerson ?? 0);
  if (!Number.isFinite(total) || !Number.isFinite(perPerson)) {
    return badRequest("Totals must be numeric.");
  }

  const destinationSummary = field(body.destinationSummary, 300) ?? placeIds.join(", ");

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const snapshot = {
    submittedAt: createdAt,
    user: { id: user!.id, name: user!.name, email: user!.email },
    request: body.request,
    quotation: body.quotation,
  };
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  await env.DB.prepare(
    `INSERT INTO quotation_request (
       id, created_at, user_id, user_name, user_email, status,
       destination_summary, nights, start_date, total_inr, per_person_inr,
       snapshot, email_sent
     ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(id, createdAt, user!.id, user!.name, user!.email, destinationSummary, nights, startDate, total, perPerson, snapshotJson)
    .run();

  // Best-effort: a mail provider hiccup must never lose the request itself —
  // it is already durably recorded above, and still visible in the
  // traveller's dashboard and to whoever triages `email_sent = 0` manually.
  const emailSent = await sendReviewEmail(env, {
    requestId: id,
    userName: user!.name,
    userEmail: user!.email,
    destinationSummary,
    nights,
    startDate,
    totalInr: total,
    perPersonInr: perPerson,
    snapshotJson,
  });
  if (emailSent) {
    await env.DB.prepare(`UPDATE quotation_request SET email_sent = 1 WHERE id = ?`).bind(id).run();
  }

  return json({ ok: true, id, emailSent }, { status: 201 });
}

export async function handleListRequests(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, status, destination_summary, nights, start_date, total_inr, per_person_inr
       FROM quotation_request WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(user!.id)
    .all<{
      id: string;
      created_at: string;
      status: string;
      destination_summary: string;
      nights: number;
      start_date: string;
      total_inr: number;
      per_person_inr: number;
    }>();

  return json({
    requests: results.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      destinationSummary: r.destination_summary,
      nights: r.nights,
      startDate: r.start_date,
      totalInr: r.total_inr,
      perPersonInr: r.per_person_inr,
    })),
  });
}

export async function handleGetRequest(id: string, request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const row = await env.DB.prepare(
    `SELECT id, created_at, user_id, status, destination_summary, nights, start_date,
            total_inr, per_person_inr, snapshot
       FROM quotation_request WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      created_at: string;
      user_id: string;
      status: string;
      destination_summary: string;
      nights: number;
      start_date: string;
      total_inr: number;
      per_person_inr: number;
      snapshot: string;
    }>();

  // Not found (rather than forbidden) when it belongs to someone else, so the
  // response never confirms another traveller's request even exists.
  if (!row || row.user_id !== user!.id) return notFound("No request with that id.");

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot);
  } catch {
    return json({ error: "Stored request is unreadable." }, { status: 500 });
  }

  return json({
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    destinationSummary: row.destination_summary,
    nights: row.nights,
    startDate: row.start_date,
    totalInr: row.total_inr,
    perPersonInr: row.per_person_inr,
    snapshot,
  });
}
