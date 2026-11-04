/**
 * Email/password accounts and sessions.
 *
 * The site is free to browse and quote without an account — this only comes
 * into play at the very last step of the planner, asking the agency to turn
 * a quotation into a confirmed, human-checked offer. Passwords are hashed
 * with PBKDF2-SHA256 (Web Crypto, available natively in the Workers runtime —
 * no bcrypt/argon2 native dependency to bundle), never stored or logged in
 * the clear.
 */
import type { Env } from "./http";
import { adminEmails } from "./admin";
import { sendPasswordResetEmail } from "./email";
import { badRequest, field, json, readJson, parseCookies, sessionCookie, clearSessionCookie, SESSION_COOKIE } from "./http";
import { limitByIp, overLimit, tooManyRequests } from "./rate-limit";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
/** Staff sessions are shorter: they can see every traveller's details. */
const STAFF_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** How long a session for this address lasts. */
export function sessionTtlFor(env: Env, email: string): number {
  return adminEmails(env).includes(email.trim().toLowerCase()) ? STAFF_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
}
/** PBKDF2 cost grows with input length; nobody needs a longer password, and a megabyte of one is an attack. */
const MAX_PASSWORD_LENGTH = 200;
// Workers' Web Crypto rejects PBKDF2 above 100,000 iterations (NotSupportedError),
// which made registration and login return a 500. 100,000 is the ceiling.
const PBKDF2_ITERATIONS = 100_000;

export type SessionUser = { id: string; name: string; email: string; avatarUrl: string | null };

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  // Copied into a fresh, plain ArrayBuffer-backed view: the lib.dom.d.ts
  // `BufferSource` types are fussy about `Uint8Array<ArrayBufferLike>` vs.
  // `Uint8Array<ArrayBuffer>`, which `crypto.getRandomValues`/`fromHex` don't
  // reliably produce depending on the TS lib version.
  const salt = new Uint8Array(saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return { hash: toHex(bits), salt: toHex(salt.buffer) };
}

/** Constant-time-ish comparison — hex strings of equal, fixed length, so a
 *  naive compare does not leak meaningfully more than a real one would. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  password_salt: string | null;
  avatar_url: string | null;
};

async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "h:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stored session ids to try for a presented token: the hash (current rows),
 * then the token itself (legacy plaintext rows, which age out within the 30-day
 * TTL). A token that already looks like a stored hash is never tried as
 * plaintext, so a leaked `session` table cannot be replayed as logins.
 */
export async function sessionIdCandidates(token: string): Promise<[string, string]> {
  const hashed = await hashToken(token);
  return [hashed, token.startsWith("h:") ? hashed : token];
}

export async function createSession(env: Env, userId: string, ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const id = await hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);
  await env.DB.prepare(`INSERT INTO session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, userId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

/**
 * The ONLY place a request's session credential is read. Everything that needs
 * to know who is calling (travellers, staff, logout) goes through here, so a
 * new way of presenting a session (bearer token for the mobile app) is added
 * once. A test greps the Worker source to keep it that way.
 */
export function readSessionToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  return parseCookies(request)[SESSION_COOKIE] || null;
}

/** The mobile app opts in to receiving its session token in the JSON body. */
export function isMobileClient(request: Request): boolean {
  return request.headers.get("X-Client") === "mobile";
}

/** `{ token }` for the mobile app, nothing for the web (which uses the cookie). */
function tokenFor(request: Request, token: string): { token?: string } {
  return isMobileClient(request) ? { token } : {};
}

/** Resolves the signed-in user from the request's session, or null. */
export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.id as id, u.name as name, u.email as email, u.avatar_url as avatar_url
       FROM session s JOIN user u ON u.id = s.user_id
      WHERE s.id IN (?, ?) AND s.expires_at > ?`,
  )
    .bind(...(await sessionIdCandidates(token)), new Date().toISOString())
    .first<{ id: string; name: string; email: string; avatar_url: string | null }>();

  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url };
}

/** 401 helper for routes that require a session. */
export function requireAuth(user: SessionUser | null): Response | null {
  if (user) return null;
  return json({ error: "Sign in required." }, { status: 401 });
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

type RegisterBody = { name?: unknown; email?: unknown; password?: unknown };

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await readJson<RegisterBody>(request);
  if (!body) return badRequest("Malformed request body.");

  const name = field(body.name, 120);
  if (!name) return badRequest("Your name is required.");

  const emailRaw = field(body.email, 200);
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) return badRequest("A valid email address is required.");
  const email = normaliseEmail(emailRaw);

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return badRequest("Password must be at least 8 characters.");
  if (password.length > MAX_PASSWORD_LENGTH) return badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);

  const limited = await limitByIp(request, env, "register", 10, 3600);
  if (limited) return limited;

  // An unverified sign-up must never be able to claim an admin address; its
  // owner sets a password through the emailed link instead.
  if (adminEmails(env).includes(email)) {
    return badRequest("This address is reserved. Use \"Forgot password\" to set a password by email.");
  }

  const existing = await env.DB.prepare(`SELECT id FROM user WHERE email = ?`).bind(email).first();
  if (existing) return badRequest("An account with that email already exists. Try signing in instead.");

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO user (id, created_at, name, email, password_hash, password_salt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, new Date().toISOString(), name, email, hash, salt)
      .run();
  } catch {
    // Two sign-ups for one address in the same instant: the unique index decides, the loser is told so.
    return badRequest("An account with that email already exists. Try signing in instead.");
  }

  const token = await createSession(env, id);
  return json(
    { user: { id, name, email, avatarUrl: null }, ...tokenFor(request, token) },
    { status: 201, headers: { "Set-Cookie": sessionCookie(token, SESSION_TTL_SECONDS) } },
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

type LoginBody = { email?: unknown; password?: unknown };

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson<LoginBody>(request);
  if (!body) return badRequest("Malformed request body.");

  const emailRaw = field(body.email, 200);
  const password = typeof body.password === "string" ? body.password : "";
  if (!emailRaw || !password) return badRequest("Email and password are required.");
  const email = normaliseEmail(emailRaw);

  // Per address as well as per network: a guessing run against one account is stopped even when it is spread over many IPs.
  const limited = (await limitByIp(request, env, "login-ip", 60, 900)) ?? ((await overLimit(env, "login-email", email, 10, 900)) ? tooManyRequests(900) : null);
  if (limited) return limited;

  const row = await env.DB.prepare(
    `SELECT id, name, email, password_hash, password_salt, avatar_url FROM user WHERE email = ?`,
  )
    .bind(email)
    .first<UserRow>();

  // Same message whether the email is unknown or the password is wrong, so a
  // failed attempt never confirms which account exists.
  const invalid = () => badRequest("Incorrect email or password.");

  if (!row || !row.password_hash || !row.password_salt) {
    // Do the same work as a real check, so response time does not reveal whether the address has an account.
    await hashPassword(password.slice(0, MAX_PASSWORD_LENGTH), DUMMY_SALT);
    return invalid();
  }

  const { hash } = await hashPassword(password.slice(0, MAX_PASSWORD_LENGTH), row.password_salt);
  if (!timingSafeEqual(hash, row.password_hash)) return invalid();

  const ttl = sessionTtlFor(env, row.email);
  const token = await createSession(env, row.id, ttl);
  return json(
    { user: { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url }, ...tokenFor(request, token) },
    { headers: { "Set-Cookie": sessionCookie(token, ttl) } },
  );
}

// ---------------------------------------------------------------------------
// Logout / me
// ---------------------------------------------------------------------------

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = readSessionToken(request);
  if (token) {
    await env.DB.prepare(`DELETE FROM session WHERE id IN (?, ?)`).bind(...(await sessionIdCandidates(token))).run();
  }
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ user: null });
  // Lets the app show staff screens without probing an admin route. The server still enforces access on every /admin call.
  return json({ user, isStaff: adminEmails(env).includes(user.email.toLowerCase()) });
}

// ---------------------------------------------------------------------------
// Forgot / reset password
// ---------------------------------------------------------------------------

const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_MAX_PER_HOUR = 3;
const FORGOT_REPLY = { ok: true, message: "If that address can sign in here, a reset link is on its way." };

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * Emails a one-hour, single-use link. Always answers identically so it never
 * reveals which addresses have accounts. Existing accounts and admin
 * addresses (whose account is created when the link is used — that is the
 * admin's first-time password setup) get a link; everyone else gets nothing.
 */
export async function handleForgotPassword(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const body = await readJson<{ email?: unknown }>(request);
  if (!body) return badRequest("Malformed request body.");
  const emailRaw = field(body.email, 200);
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) return badRequest("A valid email address is required.");
  const email = normaliseEmail(emailRaw);

  const limited = await limitByIp(request, env, "forgot", 10, 3600);
  if (limited) return limited;

  const existing = await env.DB.prepare(`SELECT id FROM user WHERE email = ?`).bind(email).first();
  if (!existing && !adminEmails(env).includes(email)) return json(FORGOT_REPLY);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM password_reset WHERE email = ? AND created_at > ?`)
    .bind(email, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RESET_MAX_PER_HOUR) return json(FORGOT_REPLY);

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const now = new Date();
  await env.DB.prepare(`INSERT INTO password_reset (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256Hex(token), email, now.toISOString(), new Date(now.getTime() + RESET_TTL_MS).toISOString())
    .run();

  const site = (env.PUBLIC_SITE_URL || "https://retroholidays.in").replace(/\/$/, "");
  const send = sendPasswordResetEmail(env, email, `${site}/reset-password?token=${token}`);
  if (ctx) ctx.waitUntil(send);
  else await send;
  return json(FORGOT_REPLY);
}

/** Spends a reset token: sets the password, signs out every other session, signs this one in. */
export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ token?: unknown; password?: unknown }>(request);
  if (!body) return badRequest("Malformed request body.");
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return badRequest("This reset link is invalid or has expired.");
  if (password.length < 8) return badRequest("Password must be at least 8 characters.");
  if (password.length > MAX_PASSWORD_LENGTH) return badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  const limited = await limitByIp(request, env, "reset", 20, 3600);
  if (limited) return limited;

  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT email FROM password_reset WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(tokenHash, nowIso)
    .first<{ email: string }>();
  if (!row) return badRequest("This reset link is invalid or has expired.");

  // Claim the token atomically so two simultaneous submissions can't both win.
  const claim = await env.DB.prepare(`UPDATE password_reset SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`)
    .bind(nowIso, tokenHash)
    .run();
  if (!claim.meta?.changes) return badRequest("This reset link is invalid or has expired.");
  // Any other outstanding links for this address die with it.
  await env.DB.prepare(`UPDATE password_reset SET used_at = ? WHERE email = ? AND used_at IS NULL`).bind(nowIso, row.email).run();

  const { hash, salt } = await hashPassword(password);
  let user = await env.DB.prepare(`SELECT id, name, email, avatar_url FROM user WHERE email = ?`)
    .bind(row.email)
    .first<{ id: string; name: string; email: string; avatar_url: string | null }>();

  if (user) {
    await env.DB.prepare(`UPDATE user SET password_hash = ?, password_salt = ?, password_verified_at = ? WHERE id = ?`)
      .bind(hash, salt, nowIso, user.id)
      .run();
    // A forgotten password may mean a compromised one: end every existing session.
    await env.DB.prepare(`DELETE FROM session WHERE user_id = ?`).bind(user.id).run();
  } else {
    // Only reachable for an admin address (handleForgotPassword gate): first-time setup.
    const id = crypto.randomUUID();
    const name = "Retro Holidays";
    await env.DB.prepare(
      `INSERT INTO user (id, created_at, name, email, password_hash, password_salt, password_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, nowIso, name, row.email, hash, salt, nowIso)
      .run();
    user = { id, name, email: row.email, avatar_url: null };
  }

  const ttl = sessionTtlFor(env, user.email);
  const session = await createSession(env, user.id, ttl);
  return json(
    {
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url },
      admin: adminEmails(env).includes(user.email),
      ...tokenFor(request, session),
    },
    { headers: { "Set-Cookie": sessionCookie(session, ttl) } },
  );
}

// ---------------------------------------------------------------------------
// Delete account (B3)
// ---------------------------------------------------------------------------

/**
 * `DELETE /auth/account { password? }` — App Store 5.1.1(v) and Google Play both require deleting the account
 * from inside the app.
 *
 * What "delete" means here: the person is erased, the business record is kept. The user row can't simply go,
 * because requests, payments and quote revisions reference it and the agency has to keep the money trail, so it
 * becomes a tombstone (no name, email, password, provider or avatar) and every request they made is stripped of
 * contact details and free text. Amounts, dates, destinations and payment rows stay for accounting.
 *
 * Re-authentication: a password account must send its password; a social account (no password) must have signed
 * in within the last 10 minutes, so a stolen but idle session can't erase it. A booking in progress blocks
 * deletion, since erasing the contact for someone who has paid a deposit would strand them.
 */
export async function handleDeleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;
  const me = user!;

  if (adminEmails(env).includes(me.email.toLowerCase())) {
    return json({ error: "Staff accounts are managed by the agency and can't be deleted here.", code: "STAFF_ACCOUNT" }, { status: 403 });
  }
  if (await overLimit(env, "delete-account", me.id, 5, 3600)) return tooManyRequests(3600);

  const row = await env.DB.prepare(`SELECT password_hash, password_salt FROM user WHERE id = ?`).bind(me.id).first<{ password_hash: string | null; password_salt: string | null }>();
  if (row?.password_hash && row.password_salt) {
    const body = await readJson<{ password?: unknown }>(request, 4 * 1024);
    const password = typeof body?.password === "string" ? body.password.slice(0, MAX_PASSWORD_LENGTH) : "";
    const { hash } = await hashPassword(password, row.password_salt);
    if (!password || !timingSafeEqual(hash, row.password_hash)) return json({ error: "That password is not correct.", code: "REAUTH_FAILED" }, { status: 403 });
  } else {
    const token = readSessionToken(request);
    const session = token
      ? await env.DB.prepare(`SELECT created_at FROM session WHERE id IN (?, ?)`).bind(...(await sessionIdCandidates(token))).first<{ created_at: string }>()
      : null;
    if (!session || Date.now() - new Date(session.created_at).getTime() > 10 * 60_000) {
      return json({ error: "Please sign in again, then delete your account.", code: "REAUTH_REQUIRED" }, { status: 403 });
    }
  }

  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM quotation_request WHERE user_id = ? AND status IN ('accepted', 'part_paid')`).bind(me.id).first<{ n: number }>();
  if ((open?.n ?? 0) > 0) {
    return json({ error: "You have a booking in progress. Please contact us to settle it before deleting your account.", code: "OPEN_BOOKING" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const gone = `deleted-${me.id}@deleted.invalid`;
  await env.DB.batch([
    // The traveller's own words and contact details, on every request they made.
    env.DB.prepare(
      `UPDATE quotation_request SET user_name = 'Deleted traveller', user_email = ?, contact_email = NULL, contact_phone = NULL, traveller_note = NULL,
              snapshot = json_remove(json_remove(json_remove(snapshot, '$.user'), '$.contact'), '$.note'), updated_at = ? WHERE user_id = ?`,
    ).bind(gone, now, me.id),
    env.DB.prepare(`UPDATE request_event SET actor_name = NULL, summary = '[message removed]' WHERE type = 'message' AND actor = 'traveller' AND request_id IN (SELECT id FROM quotation_request WHERE user_id = ?)`).bind(me.id),
    env.DB.prepare(`UPDATE request_event SET actor_name = NULL WHERE actor = 'traveller' AND request_id IN (SELECT id FROM quotation_request WHERE user_id = ?)`).bind(me.id),
    env.DB.prepare(`UPDATE package_request SET user_name = 'Deleted traveller', user_email = ?, notes = NULL WHERE user_id = ?`).bind(gone, me.id),
    env.DB.prepare(`DELETE FROM enquiry WHERE lower(email) = ?`).bind(me.email.toLowerCase()),
    env.DB.prepare(`DELETE FROM password_reset WHERE email = ?`).bind(me.email.toLowerCase()),
    env.DB.prepare(`DELETE FROM device WHERE user_id = ?`).bind(me.id),
    env.DB.prepare(`DELETE FROM auth_code WHERE user_id = ?`).bind(me.id),
    env.DB.prepare(`DELETE FROM session WHERE user_id = ?`).bind(me.id),
    env.DB.prepare(
      `UPDATE user SET name = 'Deleted traveller', email = ?, password_hash = NULL, password_salt = NULL, password_verified_at = NULL,
              auth_provider = NULL, provider_id = NULL, avatar_url = NULL WHERE id = ?`,
    ).bind(gone, me.id),
  ]);
  // One internal line per request, so staff opening it later know why the traveller is gone.
  const { results } = await env.DB.prepare(`SELECT id FROM quotation_request WHERE user_id = ?`).bind(me.id).all<{ id: string }>();
  for (const { id } of results) {
    await env.DB.prepare(`INSERT INTO request_event (id, request_id, created_at, actor, actor_name, type, internal, summary) VALUES (?, ?, ?, 'system', NULL, 'note', 1, ?)`)
      .bind(crypto.randomUUID(), id, now, "The traveller deleted their account; their personal details were removed.")
      .run();
  }
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
