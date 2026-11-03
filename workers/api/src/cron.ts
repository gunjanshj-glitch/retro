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

export async function runScheduled(env: Env, now = new Date()): Promise<{ purged: Record<string, number>; expired: number }> {
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
    if (next.status === "expired") expired += 1;
  }
  return { purged, expired };
}
