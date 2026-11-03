/**
 * Scheduled maintenance (mobile plan B9, first half).
 *
 * Runs on the Cron Trigger in wrangler.toml. Two jobs, both idempotent and safe to
 * run twice:
 *  1. Purge rows that can never be used again. Nothing deleted sessions, OAuth
 *     states, reset tokens or rate counters before, so those tables only grew.
 *  2. Apply quote expiry in the background. Expiry used to be applied only when
 *     someone read the request, so a lapsed quote looked live in the staff list
 *     until it was opened, and nothing could ever notify on it.
 * Reminder pushes ("expires tomorrow") are added here with B6.
 */
import type { Env } from "./http";
import { loadRequest, refreshExpiry, type RequestRow } from "./request-core";
import { checkPushReceipts, notifyStaff, notifyUser } from "./push";
import { overLimit } from "./rate-limit";

export async function runScheduled(env: Env, now = new Date()): Promise<{ purged: Record<string, number>; expired: number; reminded: number; waiting: number; receipts: { checked: number; removed: number } }> {
  const iso = now.toISOString();
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  const hour = new Date(now.getTime() - 3_600_000).toISOString();

  const purged: Record<string, number> = {};
  const run = async (name: string, sql: string, ...binds: (string | number)[]) => {
    const res = await env.DB.prepare(sql).bind(...binds).run();
    purged[name] = Number(res.meta?.changes ?? 0);
  };
  await run("session", `DELETE FROM session WHERE expires_at < ?`, iso);
  await run("oauth_state", `DELETE FROM oauth_state WHERE created_at < ?`, hour);
  await run("password_reset", `DELETE FROM password_reset WHERE expires_at < ?`, day);
  await run("auth_code", `DELETE FROM auth_code WHERE expires_at < ?`, iso);
  await run("rate_limit", `DELETE FROM rate_limit WHERE exp < ?`, Math.floor(now.getTime() / 1000));

  const { results } = await env.DB.prepare(
    `SELECT id FROM quotation_request WHERE status = 'quoted' AND quote_valid_until IS NOT NULL AND quote_valid_until < ? LIMIT 200`,
  )
    .bind(iso)
    .all<{ id: string }>();
  let expired = 0;
  for (const { id } of results) {
    const row = await loadRequest(env, id);
    if (!row) continue;
    const next: RequestRow = await refreshExpiry(env, row);
    if (next.status === "expired") {
      expired += 1;
      await notifyUser(env, row.user_id, "quote_expired", row.id);
    }
  }

  // "Expires tomorrow": one reminder per sent quote, for quotes that lapse within the next 24 hours.
  const soon = new Date(now.getTime() + 86_400_000).toISOString();
  const due = await env.DB.prepare(
    `SELECT id, user_id FROM quotation_request WHERE status = 'quoted' AND reminder_sent_at IS NULL AND quote_valid_until IS NOT NULL AND quote_valid_until > ? AND quote_valid_until <= ? LIMIT 200`,
  ).bind(iso, soon).all<{ id: string; user_id: string }>();
  let reminded = 0;
  for (const r of due.results) {
    // Claim first so two overlapping runs can't both remind.
    const claim = await env.DB.prepare(`UPDATE quotation_request SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL`).bind(iso, r.id).run();
    if (!Number(claim.meta?.changes ?? 0)) continue;
    reminded += 1;
    await notifyUser(env, r.user_id, "quote_expiring", r.id);
  }

  // Staff nudge, at most once a day: requests the agency has owed a reply on for over 24 hours.
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const stale = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM quotation_request WHERE status IN ('pending', 'changes_requested', 'in_review') AND COALESCE(updated_at, created_at) < ?`,
  ).bind(dayAgo).first<{ n: number }>();
  const waiting = stale?.n ?? 0;
  if (waiting > 0 && !(await overLimit(env, "staff-waiting", "all", 1, 86_400))) await notifyStaff(env, "waiting", null);

  const receipts = await checkPushReceipts(env, now).catch(() => ({ checked: 0, removed: 0 }));
  return { purged, expired, reminded, waiting, receipts };
}
