/**
 * Quote requests — the traveller's side of the workflow.
 *
 * A quotation is generated and recomputed entirely client-side (the engine is
 * pure — see quotes.ts), which is what keeps the planner instant. Sending it
 * for final approval is the one point it stops being a live thing and becomes
 * a tracked case: the snapshot the traveller saw is captured exactly as shown
 * and never touched again, and from there a person at the agency drafts a
 * final quote (request-admin.ts) that the traveller accepts, queries or
 * declines here, and then pays for (payments.ts).
 *
 * Every state change goes through `transition` in request-core.ts, so the
 * rules in lib/quote-workflow.ts hold no matter which route is called.
 */
import type { Env } from "./http";
import { badRequest, field, json, notFound, readJson } from "./http";
import { getSessionUser, requireAuth, type SessionUser } from "./auth";
import { agencyInbox, formatInr, sendNotice, sendReviewEmail, siteUrl } from "./email";
import {
  addEvent,
  listEvents,
  loadLatestSent,
  loadRequest,
  loadRevision,
  refreshExpiry,
  REQUEST_LIST_COLUMNS,
  statusOf,
  transition,
  type RequestRow,
} from "./request-core";
import { razorpayConfigured } from "./razorpay";
import { isValidEmail, normalisePhone, TRAVELLER_TURN, type RequestStatus } from "../../../lib/quote-workflow";
import { nextPaymentInr, parseAdjustments, priceQuote, type PublicQuote } from "../../../lib/quote-pricing";

/** A full quotation snapshot is itinerary-sized; generous but still bounded. */
const MAX_BODY_BYTES = 256 * 1024;
/** Bounds how fast one account can add rows; a real traveller never gets near it. */
const MAX_PER_HOUR = 10;

type CreateRequestBody = {
  request?: unknown;
  quotation?: unknown;
  destinationSummary?: unknown;
  totals?: { total?: unknown; perPerson?: unknown };
  contact?: { email?: unknown; phone?: unknown };
  note?: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function handleCreateRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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

  // How the agency reaches them. Email defaults to the account's; phone is
  // optional, but when given it has to be a real number or the agency would
  // be dialling nonsense.
  const contactEmail = (field(body.contact?.email, 254) ?? user!.email).toLowerCase();
  if (!isValidEmail(contactEmail)) return badRequest("Enter a valid email address.");
  const rawPhone = field(body.contact?.phone, 40);
  const contactPhone = rawPhone ? normalisePhone(rawPhone) : null;
  if (rawPhone && !contactPhone) return badRequest("Enter a valid phone number, or leave it blank.");
  const travellerNote = field(body.note, 1000);

  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM quotation_request WHERE user_id = ? AND created_at > ?`)
    .bind(user!.id, new Date(Date.now() - 3600_000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PER_HOUR) {
    return json({ error: "You have sent several requests in the last hour. Please wait a little before sending another." }, { status: 429 });
  }

  const destinationSummary = field(body.destinationSummary, 300) ?? placeIds.join(", ");

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const snapshot = {
    submittedAt: createdAt,
    user: { id: user!.id, name: user!.name, email: user!.email },
    contact: { email: contactEmail, phone: contactPhone, note: travellerNote },
    request: body.request,
    quotation: body.quotation,
  };
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  await env.DB.prepare(
    `INSERT INTO quotation_request (
       id, created_at, updated_at, user_id, user_name, user_email, contact_email, contact_phone, traveller_note,
       status, destination_summary, nights, start_date, total_inr, per_person_inr, snapshot, email_sent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      id, createdAt, createdAt, user!.id, user!.name, user!.email, contactEmail, contactPhone, travellerNote,
      destinationSummary, nights, startDate, total, perPerson, snapshotJson,
    )
    .run();

  await addEvent(env, id, {
    actor: "traveller",
    actorName: user!.name,
    type: "submitted",
    summary: "You sent your trip for a final quote.",
  });

  // Best-effort: a mail provider hiccup must never lose the request itself —
  // it is already durably recorded above, and still visible in the
  // traveller's dashboard and in the admin list.
  const emailSent = await sendReviewEmail(env, {
    requestId: id,
    userName: user!.name,
    userEmail: user!.email,
    contactEmail,
    contactPhone,
    travellerNote,
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

  const ack = sendNotice(env, {
    to: contactEmail,
    subject: `We have your quote request — ${destinationSummary}`,
    intro: `Hi ${user!.name.split(" ")[0]}, thanks for sending your trip. A travel expert will check every rate and send you a final quote${contactPhone ? ", and may call you to confirm a few details" : ""}.`,
    lines: [
      `Trip: ${destinationSummary}`,
      `Nights: ${nights} · Starting ${startDate}`,
      `Estimate you saw: ${formatInr(total)}`,
      ``,
      `What happens next: 1) we review and finalise the quote, 2) we email you when it is ready, 3) you accept it and pay securely online.`,
    ],
    cta: { label: "Track your request", url: `${siteUrl(env)}/my-requests/view?id=${encodeURIComponent(id)}` },
    replyTo: { email: agencyInbox(env) },
  });
  if (ctx) ctx.waitUntil(ack);
  else await ack;

  return json({ ok: true, id, emailSent }, { status: 201 });
}

export async function handleListRequests(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const { results } = await env.DB.prepare(
    `SELECT ${REQUEST_LIST_COLUMNS}
       FROM quotation_request WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC`,
  )
    .bind(user!.id)
    .all<RequestRow>();

  const rows = await Promise.all(results.map((r) => refreshExpiry(env, r)));
  return json({
    requests: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
      status: statusOf(r),
      needsAction: TRAVELLER_TURN.includes(statusOf(r)),
      destinationSummary: r.destination_summary,
      nights: r.nights,
      startDate: r.start_date,
      totalInr: r.total_inr,
      perPersonInr: r.per_person_inr,
      quotedTotalInr: r.quoted_total_inr,
      quoteValidUntil: r.quote_valid_until,
      acceptedTotalInr: r.accepted_total_inr,
      paidInr: r.paid_inr,
    })),
  });
}

/** What is owed next, and whether online payment is available. */
async function paymentState(env: Env, row: RequestRow, status: RequestStatus) {
  const { results } = await env.DB.prepare(
    `SELECT id, amount_paise, status, paid_at, method, kind FROM payment WHERE request_id = ? AND status = 'paid' ORDER BY paid_at ASC`,
  )
    .bind(row.id)
    .all<{ id: string; amount_paise: number; status: string; paid_at: string | null; method: string | null; kind: string }>();

  let nextInr = 0;
  let balanceInr = 0;
  if ((status === "accepted" || status === "part_paid") && row.accepted_total_inr != null) {
    const revision = row.accepted_revision_id ? await loadRevision(env, row.accepted_revision_id) : null;
    nextInr = nextPaymentInr(row.accepted_total_inr, row.paid_inr, revision?.deposit_inr ?? null);
    balanceInr = Math.max(0, row.accepted_total_inr - row.paid_inr);
  }
  return {
    configured: razorpayConfigured(env),
    totalInr: row.accepted_total_inr,
    paidInr: row.paid_inr,
    balanceInr,
    nextInr,
    payments: results.map((p) => ({
      id: p.id,
      amountInr: p.amount_paise / 100,
      paidAt: p.paid_at,
      method: p.method,
      kind: p.kind,
    })),
  };
}

export async function handleGetRequest(id: string, request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const found = await loadRequest(env, id);
  // Not found (rather than forbidden) when it belongs to someone else, so the
  // response never confirms another traveller's request even exists.
  if (!found || found.user_id !== user!.id) return notFound("No request with that id.");
  const row = await refreshExpiry(env, found);
  const status = statusOf(row);

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot);
  } catch {
    return json({ error: "Stored request is unreadable." }, { status: 500 });
  }

  // The traveller only ever receives the public view of a quote — never the
  // engine payload, which carries margins and internal notes.
  const revision = row.accepted_revision_id ? await loadRevision(env, row.accepted_revision_id) : await loadLatestSent(env, row.id);
  let quote: unknown = null;
  if (revision?.public_view) {
    const view = JSON.parse(revision.public_view) as PublicQuote;
    const adjustments = parseAdjustments(JSON.parse(revision.adjustments));
    quote = {
      revisionId: revision.id,
      version: revision.version,
      sentAt: revision.sent_at,
      view,
      // Priced with nothing optional ticked — the page re-prices live with
      // `priceQuote`; this is the floor and what the list shows.
      baseTotalInr: adjustments.ok ? priceQuote(revision.engine_total_inr, adjustments.value).totalInr : revision.total_inr,
      current: revision.status === "sent",
    };
  }

  return json({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status,
    destinationSummary: row.destination_summary,
    nights: row.nights,
    startDate: row.start_date,
    totalInr: row.total_inr,
    perPersonInr: row.per_person_inr,
    snapshot,
    contact: { name: row.user_name, email: row.contact_email ?? row.user_email, phone: row.contact_phone, note: row.traveller_note },
    events: await listEvents(env, row.id, false),
    quote,
    acceptance: row.accepted_at
      ? {
          acceptedAt: row.accepted_at,
          optionIds: JSON.parse(row.accepted_option_ids ?? "[]") as string[],
          totalInr: row.accepted_total_inr,
        }
      : null,
    payment: await paymentState(env, row, status),
  });
}

// ---------------------------------------------------------------------------
// Traveller decisions on a sent quote
// ---------------------------------------------------------------------------

type Owned = { response: Response } | { response?: undefined; user: SessionUser; row: RequestRow };

async function ownedRequest(request: Request, env: Env, id: string): Promise<Owned> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return { response: unauthorised };
  const found = await loadRequest(env, id);
  if (!found || found.user_id !== user!.id) return { response: notFound("No request with that id.") };
  return { user: user!, row: await refreshExpiry(env, found) };
}

function conflict(message: string): Response {
  return json({ error: message }, { status: 409 });
}

function notifyAgency(env: Env, ctx: ExecutionContext | undefined, row: RequestRow, subject: string, intro: string, lines: string[] = []) {
  const send = sendNotice(env, {
    to: agencyInbox(env),
    subject,
    intro,
    lines: [`Traveller: ${row.user_name} <${row.contact_email ?? row.user_email}>${row.contact_phone ? ` · ${row.contact_phone}` : ""}`, `Trip: ${row.destination_summary}`, ...lines],
    cta: { label: "Open request", url: `${siteUrl(env)}/admin/request?id=${encodeURIComponent(row.id)}` },
    replyTo: { email: row.contact_email ?? row.user_email, name: row.user_name },
    fromName: "Retro Holidays — Website",
  });
  if (ctx) ctx.waitUntil(send);
  return send;
}

export async function handleAcceptQuote(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const owned = await ownedRequest(request, env, id);
  if (owned.response) return owned.response;
  const { user, row } = owned;

  const body = await readJson<{ revisionId?: unknown; optionIds?: unknown; agreed?: unknown }>(request, 8 * 1024);
  if (!body) return badRequest("Malformed request body.");
  if (body.agreed !== true) return badRequest("Please confirm you have read and accept the quote.");

  const status = statusOf(row);
  if (status === "expired") return conflict("This quote has expired. Message us and we will refresh it.");
  if (status !== "quoted") return conflict("This quote can no longer be accepted.");

  const revision = await loadLatestSent(env, row.id);
  if (!revision) return conflict("There is no quote to accept yet.");
  if (body.revisionId !== revision.id) return conflict("A newer version of this quote has been sent. Please reload the page.");

  const adjustments = parseAdjustments(JSON.parse(revision.adjustments));
  if (!adjustments.ok) return json({ error: "Stored quote is unreadable." }, { status: 500 });

  const optionIds = Array.isArray(body.optionIds) ? body.optionIds.filter((v): v is string => typeof v === "string") : [];
  const offered = new Set(adjustments.value.lines.filter((l) => l.optional).map((l) => l.id));
  if (optionIds.some((o) => !offered.has(o))) return badRequest("One of the selected extras is not part of this quote.");

  const priced = priceQuote(revision.engine_total_inr, adjustments.value, optionIds);
  if (priced.totalInr <= 0) return conflict("This quote has no payable amount. Please contact us.");

  const moved = await transition(env, row.id, "quoted", "accepted", {
    accepted_revision_id: revision.id,
    accepted_option_ids: JSON.stringify([...new Set(optionIds)]),
    accepted_total_inr: priced.totalInr,
    accepted_at: new Date().toISOString(),
  });
  if (!moved) return conflict("This quote was just updated. Please reload the page.");

  await addEvent(env, row.id, {
    actor: "traveller",
    actorName: user.name,
    type: "accepted",
    summary: `You accepted quote v${revision.version} for ${formatInr(priced.totalInr)}.`,
  });
  const agency = notifyAgency(env, ctx, row, `Quote accepted — ${row.destination_summary} (${formatInr(priced.totalInr)})`, "The traveller accepted the final quote and is moving to payment.", [
    `Quote version: v${revision.version}`,
    `Agreed total: ${formatInr(priced.totalInr)}`,
  ]);
  if (!ctx) await agency;

  return json({ ok: true, status: "accepted", totalInr: priced.totalInr, dueNowInr: nextPaymentInr(priced.totalInr, 0, revision.deposit_inr) });
}

export async function handleRequestChanges(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const owned = await ownedRequest(request, env, id);
  if (owned.response) return owned.response;
  const { user, row } = owned;

  const body = await readJson<{ message?: unknown }>(request, 8 * 1024);
  const message = field(body?.message, 1000);
  if (!message || message.length < 5) return badRequest("Tell us what you would like changed.");

  // Only a live quote can be queried. Once accepted, the agency has to reopen
  // it (request-admin.ts), so a change of mind goes through a person.
  const from = statusOf(row);
  if (from !== "quoted") return conflict("Changes can only be requested on a quote that is waiting for your decision.");

  if (!(await transition(env, row.id, from, "changes_requested"))) return conflict("This request just changed. Please reload the page.");
  await addEvent(env, row.id, {
    actor: "traveller",
    actorName: user.name,
    type: "changes_requested",
    summary: `You asked for changes: “${message}”`,
  });
  const agency = notifyAgency(env, ctx, row, `Changes requested — ${row.destination_summary}`, "The traveller asked for changes to the quote.", [`Their message: “${message}”`]);
  if (!ctx) await agency;
  return json({ ok: true, status: "changes_requested" });
}

export async function handleDeclineQuote(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const owned = await ownedRequest(request, env, id);
  if (owned.response) return owned.response;
  const { user, row } = owned;

  const body = await readJson<{ reason?: unknown }>(request, 8 * 1024);
  const reason = field(body?.reason, 500);

  if (statusOf(row) !== "quoted") return conflict("Only a quote that is waiting for your decision can be declined.");
  if (!(await transition(env, row.id, "quoted", "declined"))) return conflict("This request just changed. Please reload the page.");
  await addEvent(env, row.id, {
    actor: "traveller",
    actorName: user.name,
    type: "declined",
    summary: reason ? `You declined the quote: “${reason}”` : "You declined the quote.",
  });
  const agency = notifyAgency(env, ctx, row, `Quote declined — ${row.destination_summary}`, "The traveller declined the final quote.", reason ? [`Reason: “${reason}”`] : []);
  if (!ctx) await agency;
  return json({ ok: true, status: "declined" });
}

export async function handleCancelRequest(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const owned = await ownedRequest(request, env, id);
  if (owned.response) return owned.response;
  const { user, row } = owned;

  const from = statusOf(row);
  if (!(["pending", "in_review", "changes_requested", "quoted", "accepted"] as RequestStatus[]).includes(from)) {
    return conflict("This request can no longer be withdrawn here. Please contact us.");
  }
  if (!(await transition(env, row.id, from, "cancelled"))) return conflict("This request just changed. Please reload the page.");
  await addEvent(env, row.id, { actor: "traveller", actorName: user.name, type: "withdrawn", summary: "You withdrew this request." });
  const agency = notifyAgency(env, ctx, row, `Request withdrawn — ${row.destination_summary}`, "The traveller withdrew their request.");
  if (!ctx) await agency;
  return json({ ok: true, status: "cancelled" });
}
