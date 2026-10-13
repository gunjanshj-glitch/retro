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

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  password_salt: string | null;
  avatar_url: string | null;
};

async function createSession(env: Env, userId: string): Promise<string> {
  const id = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await env.DB.prepare(`INSERT INTO session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, userId, now.toISOString(), expires.toISOString())
    .run();
  return id;
}

/** Resolves the signed-in user from the request's session cookie, or null. */
export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.id as id, u.name as name, u.email as email, u.avatar_url as avatar_url
       FROM session s JOIN user u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(token, new Date().toISOString())
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

  // An unverified sign-up must never be able to claim an admin address; its
  // owner sets a password through the emailed link instead.
  if (adminEmails(env).includes(email)) {
    return badRequest("This address is reserved. Use \"Forgot password\" to set a password by email.");
  }

  const existing = await env.DB.prepare(`SELECT id FROM user WHERE email = ?`).bind(email).first();
  if (existing) return badRequest("An account with that email already exists. Try signing in instead.");

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user (id, created_at, name, email, password_hash, password_salt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, new Date().toISOString(), name, email, hash, salt)
    .run();

  const token = await createSession(env, id);
  return json(
    { user: { id, name, email, avatarUrl: null } },
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

  const row = await env.DB.prepare(
    `SELECT id, name, email, password_hash, password_salt, avatar_url FROM user WHERE email = ?`,
  )
    .bind(email)
    .first<UserRow>();

  // Same message whether the email is unknown or the password is wrong, so a
  // failed attempt never confirms which account exists.
  const invalid = () => badRequest("Incorrect email or password.");

  if (!row || !row.password_hash || !row.password_salt) return invalid();

  const { hash } = await hashPassword(password, row.password_salt);
  if (!timingSafeEqual(hash, row.password_hash)) return invalid();

  const token = await createSession(env, row.id);
  return json(
    { user: { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url } },
    { headers: { "Set-Cookie": sessionCookie(token, SESSION_TTL_SECONDS) } },
  );
}

// ---------------------------------------------------------------------------
// Logout / me
// ---------------------------------------------------------------------------

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare(`DELETE FROM session WHERE id = ?`).bind(token).run();
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ user: null });
  return json({ user });
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

  const session = await createSession(env, user.id);
  return json(
    {
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url },
      admin: adminEmails(env).includes(user.email),
    },
    { headers: { "Set-Cookie": sessionCookie(session, SESSION_TTL_SECONDS) } },
  );
}
