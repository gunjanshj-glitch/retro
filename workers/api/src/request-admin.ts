/**
 * Quote requests — the agency's side of the workflow.
 *
 * An admin opens a request, works the quote in the same planner engine the
 * traveller used (changing any trip parameter re-prices it), layers commercial
 * adjustments on top (a pinned package price, charges, discounts, optional
 * extras, a deposit), saves drafts as they go, and finally sends it. Each send
 * is a new numbered revision; earlier ones are kept. The traveller only ever
 * receives the `PublicQuote` derived at send time — never the engine payload.
 *
 * Admin identity and its extra requirements are in admin.ts (`getAdminUser`).
 */
import type { Env } from "./http";
import { badRequest, field, json, notFound, readJson } from "./http";
import { getAdminUser } from "./admin";
import { formatInr, sendNotice, siteUrl } from "./email";
import {
  addEvent,
  endOfDayIst,
  istDateOf,
  listEvents,
  loadDraft,
  loadLatestSent,
  loadRequest,
  REQUEST_LIST_COLUMNS,
  refreshExpiry,
  statusOf,
  transition,
  type RequestRow,
  type RevisionRow,
} from "./request-core";
import { canTransition, DEFAULT_QUOTE_VALIDITY_DAYS, isQuotable, type RequestStatus } from "../../../lib/quote-workflow";
import { buildPublicQuote, parseAdjustments, priceQuote, type QuoteAdjustments } from "../../../lib/quote-pricing";
import type { Quotation } from "../../../lib/atlas/engine/types";

/** A quotation payload is itinerary-sized; admins send it back whole. */
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_VALIDITY_DAYS = 120;

const forbidden = () => notFound();
const conflict = (message: string) => json({ error: message }, { status: 409 });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function todayIst(): string {
  return istDateOf(new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Lists and detail
// ---------------------------------------------------------------------------

export async function handleAdminListRequests(request: Request, env: Env): Promise<Response> {
  if (!(await getAdminUser(request, env))) return forbidden();

  const { results } = await env.DB.prepare(
    `SELECT ${REQUEST_LIST_COLUMNS} FROM quotation_request
      ORDER BY CASE status
                 WHEN 'pending' THEN 0 WHEN 'changes_requested' THEN 1 WHEN 'in_review' THEN 2
                 WHEN 'expired' THEN 3 WHEN 'accepted' THEN 4 WHEN 'part_paid' THEN 4 WHEN 'quoted' THEN 5
                 ELSE 6 END,
               COALESCE(updated_at, created_at) DESC
      LIMIT 300`,
  ).all<RequestRow>();

  const rows = await Promise.all(results.map((r) => refreshExpiry(env, r)));
  return json({
    requests: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
      status: statusOf(r),
      userName: r.user_name,
      contactEmail: r.contact_email ?? r.user_email,
      contactPhone: r.contact_phone,
      destinationSummary: r.destination_summary,
      nights: r.nights,
      startDate: r.start_date,
      estimateInr: r.total_inr,
      quotedTotalInr: r.quoted_total_inr,
      quoteValidUntil: r.quote_valid_until,
      acceptedTotalInr: r.accepted_total_inr,
      paidInr: r.paid_inr,
    })),
  });
}

/** The editor's starting point: the draft if one exists, else the last sent quote. */
function workingCopyOf(draft: RevisionRow | null, sent: RevisionRow | null) {
  const rev = draft ?? sent;
  if (!rev) return null;
  let payload: { request?: unknown };
  try {
    payload = JSON.parse(rev.payload) as { request?: unknown };
  } catch {
    return null;
  }
  const adjustments = parseAdjustments(JSON.parse(rev.adjustments));
  return {
    kind: draft ? ("draft" as const) : ("sent" as const),
    version: rev.version,
    request: payload.request ?? null,
    adjustments: adjustments.ok ? adjustments.value : null,
    validUntil: rev.valid_until ? istDateOf(rev.valid_until) : null,
    note: rev.note,
  };
}

export async function handleAdminGetRequest(id: string, request: Request, env: Env): Promise<Response> {
  if (!(await getAdminUser(request, env))) return forbidden();
  const found = await loadRequest(env, id);
  if (!found) return notFound("No such request.");
  const row = await refreshExpiry(env, found);

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot);
  } catch {
    return json({ error: "Stored request is unreadable." }, { status: 500 });
  }

  const [draft, sent, revisions, payments] = await Promise.all([
    loadDraft(env, id),
    loadLatestSent(env, id),
    env.DB.prepare(
      `SELECT id, version, status, sent_at, total_inr, valid_until, note FROM quote_revision WHERE request_id = ? AND status != 'draft' ORDER BY version DESC`,
    )
      .bind(id)
      .all<{ id: string; version: number; status: string; sent_at: string | null; total_inr: number; valid_until: string | null; note: string | null }>(),
    env.DB.prepare(
      `SELECT id, created_at, amount_paise, status, kind, razorpay_payment_id, method, paid_at, failure_reason FROM payment WHERE request_id = ? ORDER BY created_at DESC`,
    )
      .bind(id)
      .all<{ id: string; created_at: string; amount_paise: number; status: string; kind: string; razorpay_payment_id: string | null; method: string | null; paid_at: string | null; failure_reason: string | null }>(),
  ]);

  return json({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status: statusOf(row),
    destinationSummary: row.destination_summary,
    nights: row.nights,
    startDate: row.start_date,
    estimateInr: row.total_inr,
    perPersonInr: row.per_person_inr,
    contact: {
      name: row.user_name,
      accountEmail: row.user_email,
      email: row.contact_email ?? row.user_email,
      phone: row.contact_phone,
      note: row.traveller_note,
    },
    snapshot,
    events: await listEvents(env, id, true),
    revisions: revisions.results.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      sentAt: r.sent_at,
      totalInr: r.total_inr,
      validUntil: r.valid_until,
      note: r.note,
    })),
    workingCopy: workingCopyOf(draft, sent),
    defaultValidUntil: new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * 86400_000).toISOString().slice(0, 10),
    quotedTotalInr: row.quoted_total_inr,
    quoteValidUntil: row.quote_valid_until,
    acceptance: row.accepted_at
      ? { acceptedAt: row.accepted_at, optionIds: JSON.parse(row.accepted_option_ids ?? "[]") as string[], totalInr: row.accepted_total_inr }
      : null,
    paidInr: row.paid_inr,
    payments: payments.results.map((p) => ({
      id: p.id,
      createdAt: p.created_at,
      amountInr: p.amount_paise / 100,
      status: p.status,
      kind: p.kind,
      reference: p.razorpay_payment_id,
      method: p.method,
      paidAt: p.paid_at,
      failureReason: p.failure_reason,
    })),
  });
}

// ---------------------------------------------------------------------------
// Working the request
// ---------------------------------------------------------------------------

/** Marks a request as picked up. Idempotent: opening it again changes nothing. */
export async function handleAdminStartReview(id: string, request: Request, env: Env): Promise<Response> {
  const admin = await getAdminUser(request, env);
  if (!admin) return forbidden();
  const row = await loadRequest(env, id);
  if (!row) return notFound("No such request.");
  const status = statusOf(row);
  if (status !== "pending" && status !== "changes_requested") return json({ ok: true, status });

  if (!(await transition(env, id, status, "in_review"))) return json({ ok: true, status: statusOf((await loadRequest(env, id)) ?? row) });
  await addEvent(env, id, { actor: "agency", actorName: admin.email, type: "review_started", summary: "A travel expert has started preparing your quote." });
  return json({ ok: true, status: "in_review" });
}

type ParsedQuoteBody = {
  request: Record<string, unknown>;
  quotation: Quotation;
  adjustments: QuoteAdjustments;
  validUntil: string | null;
  note: string | null;
};

/** Structural checks on what the editor sends. The admin is trusted; this
 *  guards against a malformed or truncated body, not a hostile one. */
function parseQuoteBody(body: unknown): { ok: true; value: ParsedQuoteBody } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Malformed request body." };
  const req = body.request;
  const q = body.quotation;
  if (!isRecord(req) || !Array.isArray(req.placeIds) || !req.placeIds.length || typeof req.nights !== "number" || typeof req.startDate !== "string") {
    return { ok: false, error: "The trip details are incomplete." };
  }
  if (
    !isRecord(q) || !isRecord(q.totals) || typeof q.totals.total !== "number" || !Number.isFinite(q.totals.total) ||
    !Array.isArray(q.stays) || !Array.isArray(q.days) || !Array.isArray(q.lineItems) || !isRecord(q.pax) || !isRecord(q.request)
  ) {
    return { ok: false, error: "The priced itinerary is incomplete. Let the editor finish loading and try again." };
  }
  const adjustments = parseAdjustments(body.adjustments);
  if (!adjustments.ok) return adjustments;

  let validUntil: string | null = null;
  if (body.validUntil != null && body.validUntil !== "") {
    if (typeof body.validUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.validUntil) || Number.isNaN(Date.parse(body.validUntil))) {
      return { ok: false, error: "Choose a valid date for the quote to stay open until." };
    }
    validUntil = body.validUntil;
  }
  return {
    ok: true,
    value: { request: req, quotation: q as unknown as Quotation, adjustments: adjustments.value, validUntil, note: field(body.note, 1500) },
  };
}

async function nextVersion(env: Env, requestId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM quote_revision WHERE request_id = ?`).bind(requestId).first<{ v: number }>();
  return (row?.v ?? 0) + 1;
}

/** Saves work in progress. At most one draft per request; saving replaces it. */
export async function handleAdminSaveDraft(id: string, request: Request, env: Env): Promise<Response> {
  const admin = await getAdminUser(request, env);
  if (!admin) return forbidden();
  const row = await loadRequest(env, id);
  if (!row) return notFound("No such request.");
  if (!isQuotable(statusOf(row))) return conflict("This request can no longer be edited.");

  const parsed = parseQuoteBody(await readJson<unknown>(request, MAX_BODY_BYTES));
  if (!parsed.ok) return badRequest(parsed.error);
  const { request: req, quotation, adjustments, validUntil, note } = parsed.value;

  const priced = priceQuote(quotation.totals.total, adjustments);
  const now = new Date().toISOString();
  const payload = JSON.stringify({ request: req, quotation, adjustments });
  const validIso = validUntil ? endOfDayIst(validUntil) : null;

  const draft = await loadDraft(env, id);
  if (draft) {
    await env.DB.prepare(
      `UPDATE quote_revision SET updated_at = ?, created_by = ?, payload = ?, adjustments = ?, engine_total_inr = ?, package_inr = ?,
              total_inr = ?, deposit_inr = ?, valid_until = ?, note = ? WHERE id = ?`,
    )
      .bind(now, admin.email, payload, JSON.stringify(adjustments), quotation.totals.total, priced.packageInr, priced.totalInr, adjustments.depositInr, validIso, note, draft.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO quote_revision (id, request_id, version, status, created_at, updated_at, created_by, payload, adjustments,
                                   engine_total_inr, package_inr, total_inr, deposit_inr, valid_until, note)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), id, await nextVersion(env, id), now, now, admin.email, payload, JSON.stringify(adjustments), quotation.totals.total, priced.packageInr, priced.totalInr, adjustments.depositInr, validIso, note)
      .run();
  }

  // Saving a draft is also the agency picking the request up.
  const status = statusOf(row);
  if (status === "pending" || status === "changes_requested") {
    if (await transition(env, id, status, "in_review")) {
      await addEvent(env, id, { actor: "agency", actorName: admin.email, type: "review_started", summary: "A travel expert has started preparing your quote." });
    }
  }
  return json({ ok: true, savedAt: now });
}

/** Finalises the quote: new numbered revision, status → quoted, traveller emailed. */
export async function handleAdminSendQuote(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const admin = await getAdminUser(request, env);
  if (!admin) return forbidden();
  const row = await loadRequest(env, id);
  if (!row) return notFound("No such request.");
  const from = statusOf(row);
  if (!isQuotable(from)) return conflict("A quote cannot be sent for this request in its current state.");

  const parsed = parseQuoteBody(await readJson<unknown>(request, MAX_BODY_BYTES));
  if (!parsed.ok) return badRequest(parsed.error);
  const { request: req, quotation, adjustments, validUntil, note } = parsed.value;

  const validDate = validUntil ?? new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * 86400_000).toISOString().slice(0, 10);
  if (validDate < todayIst()) return badRequest("The quote's validity date is in the past.");
  if (Date.parse(validDate) - Date.now() > MAX_VALIDITY_DAYS * 86400_000) return badRequest(`A quote cannot stay open for more than ${MAX_VALIDITY_DAYS} days.`);
  const validIso = endOfDayIst(validDate);

  const priced = priceQuote(quotation.totals.total, adjustments);
  if (priced.totalInr <= 0) return badRequest("The quote total must be more than zero.");
  if (adjustments.depositInr != null && adjustments.depositInr >= priced.totalInr) {
    return badRequest("The deposit must be less than the total — leave it blank to take the full amount up front.");
  }

  let publicView: string;
  try {
    publicView = JSON.stringify(buildPublicQuote(quotation, adjustments, { validUntil: validIso, note }));
  } catch (error) {
    console.error("Could not build public quote", error);
    return badRequest("The priced itinerary could not be read. Let the editor finish loading and try again.");
  }

  // Compare-and-swap first: if the traveller accepts, withdraws or the agency
  // double-clicks in the same moment, only one of them wins.
  const moved = await transition(env, id, from, "quoted", {
    quoted_total_inr: priced.totalInr,
    quote_valid_until: validIso,
    accepted_revision_id: null,
    accepted_option_ids: null,
    accepted_total_inr: null,
    accepted_at: null,
  });
  if (!moved) return conflict("This request just changed. Reload it and try again.");

  const draft = await loadDraft(env, id);
  const version = draft?.version ?? (await nextVersion(env, id));
  const now = new Date().toISOString();
  const payload = JSON.stringify({ request: req, quotation, adjustments });
  const revisionId = draft?.id ?? crypto.randomUUID();

  const supersede = env.DB.prepare(`UPDATE quote_revision SET status = 'superseded' WHERE request_id = ? AND status = 'sent'`).bind(id);
  const write = draft
    ? env.DB.prepare(
        `UPDATE quote_revision SET status = 'sent', updated_at = ?, sent_at = ?, created_by = ?, payload = ?, public_view = ?, adjustments = ?,
                engine_total_inr = ?, package_inr = ?, total_inr = ?, deposit_inr = ?, valid_until = ?, note = ? WHERE id = ?`,
      ).bind(now, now, admin.email, payload, publicView, JSON.stringify(adjustments), quotation.totals.total, priced.packageInr, priced.totalInr, adjustments.depositInr, validIso, note, revisionId)
    : env.DB.prepare(
        `INSERT INTO quote_revision (id, request_id, version, status, created_at, updated_at, sent_at, created_by, payload, public_view, adjustments,
                                     engine_total_inr, package_inr, total_inr, deposit_inr, valid_until, note)
         VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(revisionId, id, version, now, now, now, admin.email, payload, publicView, JSON.stringify(adjustments), quotation.totals.total, priced.packageInr, priced.totalInr, adjustments.depositInr, validIso, note);
  await env.DB.batch([supersede, write]);

  const reopened = from === "accepted";
  await addEvent(env, id, {
    actor: "agency",
    actorName: admin.email,
    type: "quote_sent",
    summary: `Your ${version > 1 ? `revised quote (v${version})` : "final quote"} is ready: ${formatInr(priced.totalInr)}, open until ${validDate}.${reopened ? " Your earlier acceptance was cleared because the quote changed." : ""}`,
  });

  const email = sendNotice(env, {
    to: row.contact_email ?? row.user_email,
    subject: `${version > 1 ? "Your revised quote is ready" : "Your final quote is ready"} — ${row.destination_summary}`,
    intro: `Hi ${row.user_name.split(" ")[0]}, ${note ? note : "we have finalised your quote."} Review it, choose any optional extras and accept it to pay securely online.`,
    lines: [
      `Trip: ${row.destination_summary}`,
      `Total: ${formatInr(priced.totalInr)}`,
      ...(adjustments.depositInr ? [`To confirm your booking now: ${formatInr(adjustments.depositInr)} (balance later)`] : []),
      ...(adjustments.lines.some((l) => l.optional) ? ["Optional extras are available on the quote page."] : []),
      `Quote valid until: ${validDate}`,
    ],
    cta: { label: "Review and accept your quote", url: `${siteUrl(env)}/my-requests/view?id=${encodeURIComponent(id)}` },
  });
  if (ctx) ctx.waitUntil(email);
  else await email;

  return json({ ok: true, version, totalInr: priced.totalInr, validUntil: validDate });
}

export async function handleAdminNote(id: string, request: Request, env: Env): Promise<Response> {
  const admin = await getAdminUser(request, env);
  if (!admin) return forbidden();
  if (!(await loadRequest(env, id))) return notFound("No such request.");
  const body = await readJson<{ text?: unknown }>(request, 8 * 1024);
  const text = field(body?.text, 1000);
  if (!text) return badRequest("Write a note first.");
  await addEvent(env, id, { actor: "agency", actorName: admin.email, type: "note", summary: text, internal: true });
  return json({ ok: true });
}

export async function handleAdminClose(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const admin = await getAdminUser(request, env);
  if (!admin) return forbidden();
  const row = await loadRequest(env, id);
  if (!row) return notFound("No such request.");
  const from: RequestStatus = statusOf(row);
  if (!canTransition(from, "closed")) return conflict("This request cannot be closed from its current state.");

  const body = await readJson<{ reason?: unknown }>(request, 8 * 1024);
  const reason = field(body?.reason, 500);
  if (!(await transition(env, id, from, "closed"))) return conflict("This request just changed. Reload it and try again.");
  await addEvent(env, id, { actor: "agency", actorName: admin.email, type: "closed", summary: "Our team closed this request." });
  if (reason) await addEvent(env, id, { actor: "agency", actorName: admin.email, type: "note", summary: `Closed: ${reason}`, internal: true });

  const email = sendNotice(env, {
    to: row.contact_email ?? row.user_email,
    subject: `Your request has been closed — ${row.destination_summary}`,
    intro: "Our team has closed this quote request. If that is a surprise, reply to this email and we will pick it up again.",
    cta: { label: "View the request", url: `${siteUrl(env)}/my-requests/view?id=${encodeURIComponent(id)}` },
  });
  if (ctx) ctx.waitUntil(email);
  else await email;
  return json({ ok: true, status: "closed" });
}

