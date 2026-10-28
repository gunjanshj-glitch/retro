/**
 * Shared plumbing for the quote workflow: row types, the event timeline,
 * guarded status changes and quote expiry. Both the traveller routes
 * (requests.ts) and the agency routes (request-admin.ts) build on this so the
 * rules in lib/quote-workflow.ts are enforced in exactly one place.
 */
import type { Env } from "./http";
import { canTransition, isRequestStatus, type EventType, type RequestEvent, type RequestStatus } from "../../../lib/quote-workflow";

export type RequestRow = {
  id: string;
  created_at: string;
  updated_at: string | null;
  user_id: string;
  user_name: string;
  user_email: string;
  contact_email: string | null;
  contact_phone: string | null;
  traveller_note: string | null;
  status: string;
  destination_summary: string;
  nights: number;
  start_date: string;
  total_inr: number;
  per_person_inr: number;
  snapshot: string;
  quoted_total_inr: number | null;
  quote_valid_until: string | null;
  accepted_revision_id: string | null;
  accepted_option_ids: string | null;
  accepted_total_inr: number | null;
  accepted_at: string | null;
  paid_inr: number;
};

export type RevisionRow = {
  id: string;
  request_id: string;
  version: number;
  status: "draft" | "sent" | "superseded";
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  created_by: string | null;
  payload: string;
  public_view: string | null;
  adjustments: string;
  engine_total_inr: number;
  package_inr: number;
  total_inr: number;
  deposit_inr: number | null;
  valid_until: string | null;
  note: string | null;
};

export const REQUEST_COLUMNS = `id, created_at, updated_at, user_id, user_name, user_email, contact_email,
  contact_phone, traveller_note, status, destination_summary, nights, start_date, total_inr, per_person_inr,
  snapshot, quoted_total_inr, quote_valid_until, accepted_revision_id, accepted_option_ids,
  accepted_total_inr, accepted_at, paid_inr`;

/** Same columns without the (large) snapshot, for lists. `snapshot` comes back empty. */
export const REQUEST_LIST_COLUMNS = REQUEST_COLUMNS.replace("snapshot,", "'' AS snapshot,");

export const REVISION_COLUMNS = `id, request_id, version, status, created_at, updated_at, sent_at, created_by,
  payload, public_view, adjustments, engine_total_inr, package_inr, total_inr, deposit_inr, valid_until, note`;

/** Rows from before the workflow, or a corrupted value, read as closed rather than crashing. */
export function statusOf(row: { status: string }): RequestStatus {
  return isRequestStatus(row.status) ? row.status : "closed";
}

export async function loadRequest(env: Env, id: string): Promise<RequestRow | null> {
  return env.DB.prepare(`SELECT ${REQUEST_COLUMNS} FROM quotation_request WHERE id = ?`).bind(id).first<RequestRow>();
}

export async function loadRevision(env: Env, id: string): Promise<RevisionRow | null> {
  return env.DB.prepare(`SELECT ${REVISION_COLUMNS} FROM quote_revision WHERE id = ?`).bind(id).first<RevisionRow>();
}

/** The quote the traveller currently sees: the newest revision that was sent. */
export async function loadLatestSent(env: Env, requestId: string): Promise<RevisionRow | null> {
  return env.DB.prepare(
    `SELECT ${REVISION_COLUMNS} FROM quote_revision WHERE request_id = ? AND status = 'sent' ORDER BY version DESC LIMIT 1`,
  )
    .bind(requestId)
    .first<RevisionRow>();
}

export async function loadDraft(env: Env, requestId: string): Promise<RevisionRow | null> {
  return env.DB.prepare(
    `SELECT ${REVISION_COLUMNS} FROM quote_revision WHERE request_id = ? AND status = 'draft' LIMIT 1`,
  )
    .bind(requestId)
    .first<RevisionRow>();
}

export async function addEvent(
  env: Env,
  requestId: string,
  event: { actor: "traveller" | "agency" | "system"; actorName?: string | null; type: EventType; summary: string; internal?: boolean },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO request_event (id, request_id, created_at, actor, actor_name, type, internal, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), requestId, new Date().toISOString(), event.actor, event.actorName ?? null, event.type, event.internal ? 1 : 0, event.summary.slice(0, 1200))
    .run();
}

export async function listEvents(env: Env, requestId: string, includeInternal: boolean): Promise<RequestEvent[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, actor, type, internal, summary FROM request_event
      WHERE request_id = ? ${includeInternal ? "" : "AND internal = 0"} ORDER BY created_at ASC`,
  )
    .bind(requestId)
    .all<{ id: string; created_at: string; actor: RequestEvent["actor"]; type: RequestEvent["type"]; internal: number; summary: string }>();
  return results.map((e) => ({
    id: e.id,
    createdAt: e.created_at,
    actor: e.actor,
    type: e.type,
    summary: e.summary,
    ...(includeInternal ? { internal: e.internal === 1 } : {}),
  }));
}

/**
 * Moves a request to a new status, but only if it is still in `from`. The
 * `WHERE status = ?` makes it a compare-and-swap, so two simultaneous clicks
 * (accept twice, accept while the agency re-sends) cannot both win.
 */
export async function transition(
  env: Env,
  id: string,
  from: RequestStatus,
  to: RequestStatus,
  extraSet: Record<string, string | number | null> = {},
): Promise<boolean> {
  if (!canTransition(from, to)) return false;
  const columns = Object.keys(extraSet);
  const set = ["status = ?", "updated_at = ?", ...columns.map((c) => `${c} = ?`)].join(", ");
  const result = await env.DB.prepare(`UPDATE quotation_request SET ${set} WHERE id = ? AND status = ?`)
    .bind(to, new Date().toISOString(), ...columns.map((c) => extraSet[c]), id, from)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

/**
 * A sent quote is valid until a date. Rather than a scheduled job, the lapse is
 * applied whenever the request is next read: a stale 'quoted' becomes
 * 'expired' and the timeline records it. Returns the (possibly updated) row.
 */
export async function refreshExpiry(env: Env, row: RequestRow): Promise<RequestRow> {
  if (row.status !== "quoted" || !row.quote_valid_until) return row;
  if (new Date(row.quote_valid_until).getTime() > Date.now()) return row;
  if (await transition(env, row.id, "quoted", "expired")) {
    await addEvent(env, row.id, { actor: "system", type: "expired", summary: "The quote passed its validity date." });
    return { ...row, status: "expired" };
  }
  const fresh = await loadRequest(env, row.id);
  return fresh ?? row;
}

/** A quote's validity runs to the end of its last day, India time. */
export function endOfDayIst(date: string): string {
  return new Date(`${date}T23:59:59+05:30`).toISOString();
}

export function istDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
