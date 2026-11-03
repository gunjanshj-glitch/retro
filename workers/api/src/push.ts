/**
 * Push notifications (mobile plan B6).
 *
 * The quote negotiation passes the move between two people; without a push each side only learns it is their turn
 * when they next open the app or read an email. Email stays as the fallback and the only channel before a phone
 * registers.
 *
 * Rules (docs/mobile/01):
 *  - GENERIC text plus an id. A lock screen, Expo and Apple/Google all see the payload, so it never carries a name,
 *    an amount, a destination or message text. The app fetches the detail after the user taps.
 *  - At most one push per recipient per request per 2 minutes (bursts coalesce).
 *  - Dead tokens are removed: immediately when Expo says so, and from receipts a few minutes later.
 *  - Staff recipients are chosen at send time from ADMIN_EMAILS, not at registration, so removing an address from
 *    that list stops its pushes at once.
 * Nothing here ever throws into a request: a failed push must not fail a payment or a quote.
 */
import type { Env } from "./http";
import { badRequest, json, notFound, readJson } from "./http";
import { adminEmails } from "./admin";
import { getSessionUser, requireAuth } from "./auth";
import { overLimit, tooManyRequests } from "./rate-limit";

const EXPO_SEND = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts";
const TOKEN_RE = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$/;
const MAX_DEVICES_PER_USER = 10;

export type PushKind =
  | "quote_ready" | "quote_expiring" | "quote_expired" | "message" | "payment" | "closed"
  | "request_new" | "changes_requested" | "accepted" | "declined" | "withdrawn" | "lead" | "waiting";

/** Deliberately bland. Detail lives behind the tap. */
const COPY: Record<PushKind, string> = {
  quote_ready: "Your quote is ready to review.",
  quote_expiring: "Your quote expires soon.",
  quote_expired: "Your quote has expired. Message us to refresh it.",
  message: "You have a new message.",
  payment: "We have an update on your payment.",
  closed: "There is an update on your request.",
  request_new: "A new quote request has arrived.",
  changes_requested: "A traveller asked for changes.",
  accepted: "A traveller accepted a quote.",
  declined: "A traveller declined a quote.",
  withdrawn: "A traveller withdrew a request.",
  lead: "A new enquiry has arrived.",
  waiting: "Requests are waiting for a reply.",
};

type Target = { token: string; userId: string };

async function sendToExpo(env: Env, targets: Target[], kind: PushKind, requestId: string | null): Promise<void> {
  if (!targets.length) return;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;

  for (let i = 0; i < targets.length; i += 100) {
    const chunk = targets.slice(i, i + 100);
    const res = await fetch(EXPO_SEND, {
      method: "POST",
      headers,
      body: JSON.stringify(
        chunk.map((t) => ({ to: t.token, title: "Retro Holidays", body: COPY[kind], sound: "default", priority: "high", data: { kind, requestId } })),
      ),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("Expo push rejected", res.status);
      continue;
    }
    const tickets = ((await res.json()) as { data?: { status: string; id?: string; details?: { error?: string } }[] }).data ?? [];
    const now = new Date().toISOString();
    for (let j = 0; j < chunk.length; j += 1) {
      const ticket = tickets[j];
      if (!ticket) continue;
      if (ticket.status === "ok" && ticket.id) {
        await env.DB.prepare(`INSERT OR IGNORE INTO push_ticket (id, token, created_at) VALUES (?, ?, ?)`).bind(ticket.id, chunk[j].token, now).run();
      } else if (ticket.details?.error === "DeviceNotRegistered") {
        await env.DB.prepare(`DELETE FROM device WHERE expo_push_token = ?`).bind(chunk[j].token).run();
      }
    }
  }
}

async function guarded(env: Env, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error("Push failed", error);
  }
}

/** Pushes to every device of one traveller. */
export function notifyUser(env: Env, userId: string, kind: PushKind, requestId: string | null = null): Promise<void> {
  return guarded(env, async () => {
    if (await overLimit(env, "push", `${userId}:${requestId ?? kind}`, 1, 120)) return;
    const { results } = await env.DB.prepare(`SELECT expo_push_token AS token, user_id AS userId FROM device WHERE user_id = ?`).bind(userId).all<Target>();
    await sendToExpo(env, results, kind, requestId);
  });
}

/** Pushes to every device of every staff member (an address in ADMIN_EMAILS). */
export function notifyStaff(env: Env, kind: PushKind, requestId: string | null = null): Promise<void> {
  return guarded(env, async () => {
    const emails = adminEmails(env);
    if (!emails.length) return;
    const { results } = await env.DB.prepare(
      `SELECT d.expo_push_token AS token, d.user_id AS userId FROM device d JOIN user u ON u.id = d.user_id
        WHERE lower(u.email) IN (${emails.map(() => "?").join(",")})`,
    ).bind(...emails).all<Target>();
    const fresh: Target[] = [];
    for (const t of results) {
      if (!(await overLimit(env, "push", `${t.userId}:${requestId ?? kind}`, 1, 120))) fresh.push(t);
    }
    await sendToExpo(env, fresh, kind, requestId);
  });
}

/** Runs a notification after the response is sent when the platform allows, else inline. Never throws. */
export async function after(ctx: ExecutionContext | undefined, work: Promise<unknown>): Promise<void> {
  const safe = work.then(() => undefined, () => undefined);
  if (ctx) ctx.waitUntil(safe);
  else await safe;
}

/**
 * Reads Expo's receipts for pushes sent at least 15 minutes ago and deletes the tokens Expo says are dead.
 * Called from the scheduled job.
 */
export async function checkPushReceipts(env: Env, now = new Date()): Promise<{ checked: number; removed: number }> {
  const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT id, token FROM push_ticket WHERE created_at < ? LIMIT 300`).bind(cutoff).all<{ id: string; token: string }>();
  if (!results.length) return { checked: 0, removed: 0 };

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_RECEIPTS, { method: "POST", headers, body: JSON.stringify({ ids: results.map((r) => r.id) }), signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { checked: 0, removed: 0 };
  const receipts = ((await res.json()) as { data?: Record<string, { status: string; details?: { error?: string } }> }).data ?? {};

  let removed = 0;
  for (const t of results) {
    const receipt = receipts[t.id];
    if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
      await env.DB.prepare(`DELETE FROM device WHERE expo_push_token = ?`).bind(t.token).run();
      removed += 1;
    }
    // A ticket with no receipt yet is retried next run; the sweep below drops it after Expo's ~24h retention.
    if (receipt) {
      await env.DB.prepare(`DELETE FROM push_ticket WHERE id = ?`).bind(t.id).run();
    }
  }
  await env.DB.prepare(`DELETE FROM push_ticket WHERE created_at < ?`).bind(new Date(now.getTime() - 24 * 3_600_000).toISOString()).run();
  return { checked: results.length, removed };
}

// ---------------------------------------------------------------------------
// POST /devices, DELETE /devices/:id
// ---------------------------------------------------------------------------

export async function handleRegisterDevice(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;
  if (await overLimit(env, "device-register", user!.id, 30, 3600)) return tooManyRequests(3600);

  const body = await readJson<{ expoPushToken?: unknown; platform?: unknown; appVersion?: unknown }>(request, 4 * 1024);
  const token = typeof body?.expoPushToken === "string" ? body.expoPushToken : "";
  if (!TOKEN_RE.test(token)) return badRequest("That is not a valid push token.");
  const platform = body?.platform === "android" ? "android" : body?.platform === "ios" ? "ios" : null;
  if (!platform) return badRequest("platform must be ios or android.");
  const appVersion = typeof body?.appVersion === "string" && /^[0-9A-Za-z._+-]{1,20}$/.test(body.appVersion) ? body.appVersion : null;

  const now = new Date().toISOString();
  // A token belongs to one phone. If the phone changed hands (sign out, someone else signs in) it follows the new user.
  await env.DB.prepare(
    `INSERT INTO device (id, user_id, platform, expo_push_token, app_version, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (expo_push_token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, app_version = excluded.app_version, last_seen = excluded.last_seen`,
  )
    .bind(crypto.randomUUID(), user!.id, platform, token, appVersion, now, now)
    .run();
  const row = await env.DB.prepare(`SELECT id FROM device WHERE expo_push_token = ?`).bind(token).first<{ id: string }>();
  // Bound the table per person: keep the most recently seen phones.
  await env.DB.prepare(
    `DELETE FROM device WHERE user_id = ? AND id NOT IN (SELECT id FROM device WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?)`,
  ).bind(user!.id, user!.id, MAX_DEVICES_PER_USER).run();
  return json({ ok: true, id: row?.id }, { status: 201 });
}

export async function handleDeleteDevice(id: string, request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;
  const res = await env.DB.prepare(`DELETE FROM device WHERE id = ? AND user_id = ?`).bind(id, user!.id).run();
  // Someone else's device id answers exactly like one that doesn't exist.
  if (!Number(res.meta?.changes ?? 0)) return notFound("No such device.");
  return json({ ok: true });
}
