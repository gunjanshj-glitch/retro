/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and DB rows are untyped JSON in these tests */
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";
import { settlePayment } from "@/workers/api/src/payments";
import { runScheduled } from "@/workers/api/src/cron";
import { resetAppleKeyCache } from "@/workers/api/src/apple";
import { sessionTtlFor } from "@/workers/api/src/auth";
import { signPayToken, verifyPayToken } from "@/workers/api/src/pay-page";
import { hmacSha256Hex } from "@/workers/api/src/razorpay";
import { createTestDb } from "../helpers/d1";
import { fakeQuotation } from "../helpers/quotation";

// Like the platform, keep background work (pushes, emails) alive until it finishes; tests drain it after each call.
const pending: Promise<unknown>[] = [];
const ctx: ExecutionContext = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as ExecutionContext;
let mailCount: () => number;

function fakeKv() {
  const m = new Map<string, string>();
  return {
    get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null),
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

function setup(withKv = true, extraEnv: Partial<Env> = {}) {
  const mails: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (mails.push(String(url)), new Response(null, { status: 202 }))));
  mailCount = () => mails.length;
  const { db, database } = createTestDb();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86400_000).toISOString();
  db.prepare(`INSERT INTO user (id, created_at, name, email) VALUES ('u1', ?, 'Asha Rao', 'asha@example.com')`).run(now);
  db.prepare(`INSERT INTO user (id, created_at, name, email, auth_provider, provider_id) VALUES ('a1', ?, 'Admin', 'info@retroholidays.in', 'google', 'g-1')`).run(now);
  db.prepare(`INSERT INTO user (id, created_at, name, email, auth_provider, provider_id) VALUES ('a2', ?, 'Admin Two', 'info@retroholidays.in', 'google', 'g-2')`.replace("'info@retroholidays.in'", "'two@retroholidays.in'")).run(now);
  for (const [tok, uid] of [["asha", "u1"], ["admin", "a1"], ["admin2", "a2"]]) {
    db.prepare(`INSERT INTO session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(tok, uid, now, later);
  }
  const kv = fakeKv();
  const env = { DB: database, ENVIRONMENT: "test", PUBLIC_SITE_URL: "https://retroholidays.in", ADMIN_EMAILS: "info@retroholidays.in,two@retroholidays.in", ...extraEnv, ...(withKv ? { RATE_CACHE: kv as unknown as KVNamespace } : {}) } as Env;
  async function call(as: "asha" | "admin" | "admin2" | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await worker.fetch(
      new Request(`https://example.com/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ctx,
    );
    return { status: res.status, json: (await res.json().catch(() => null)) as any, headers: res.headers };
  }
  return { db, call, kv, env, database };
}



const submit = () => ({
  request: { placeIds: ["paris", "rome"], nights: 5, startDate: "2030-01-10", adults: 2 },
  quotation: fakeQuotation(),
  destinationSummary: "Paris, Rome",
  totals: { total: 100_000, perPerson: 50_000 },
  contact: { email: "asha.work@example.com", phone: "+91 98765 43210" },
  note: "We are celebrating our anniversary",
});
const GOOGLE = { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec" };
const RAZOR = { RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sekret", RAZORPAY_WEBHOOK_SECRET: "wh" };

type S = ReturnType<typeof setup>;
async function api(s: S, method: string, path: string, o: { as?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await worker.fetch(
    new Request(`https://example.com/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(o.as ? { Authorization: `Bearer ${o.as}` } : {}), ...(o.headers ?? {}) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    }),
    s.env,
    ctx,
  );
  const text = await res.text();
  await Promise.allSettled(pending.splice(0));
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(40)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/** Google sign-in from the app: start, provider consent (stubbed), callback. */
async function mobileGoogle(s: S, profile: { sub: string; email: string; email_verified: boolean }, challenge: string, redirect = "retro://auth", opts: { cancel?: boolean } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("oauth2.googleapis.com") ? new Response(JSON.stringify({ access_token: "t" })) : new Response(JSON.stringify({ ...profile, name: "Mo Bile" })),
  ));
  const start = await api(s, "GET", `/auth/google/start?client=mobile&redirect=${encodeURIComponent(redirect)}&code_challenge=${challenge}`);
  if (start.status !== 302) return { start, cb: null as Response | null, location: null as string | null };
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const q = opts.cancel ? `error=access_denied&state=${state}` : `code=c&state=${state}`;
  const cb = await worker.fetch(new Request(`https://example.com/api/auth/google/callback?${q}`, { headers: { Cookie: `atlas_oauth_state=${state}` } }), s.env, ctx);
  await Promise.allSettled(pending.splice(0));
  return { start, cb, location: cb.headers.get("Location") };
}

beforeEach(() => { vi.unstubAllGlobals(); resetAppleKeyCache(); });

describe("B2 social sign-in return for the app", () => {
  it.each([
    ["an unknown scheme", "retro://evil"],
    ["a web URL", "https://evil.example/auth"],
    ["a lookalike with extra path", "retro://auth/../x"],
    ["Expo Go without the flag", "exp://192.168.1.5:8081/--/auth"],
  ])("refuses a return link that is %s", async (_n, redirect) => {
    const s = setup(true, GOOGLE);
    const { challenge } = await pkce();
    expect((await mobileGoogle(s, { sub: "g", email: "a@b.com", email_verified: true }, challenge, redirect)).start.status).toBe(400);
  });

  it("accepts Expo Go return links only where the dev flag is set", async () => {
    const s = setup(true, { ...GOOGLE, ALLOW_EXPO_GO_REDIRECTS: "1" });
    const { challenge } = await pkce();
    expect((await mobileGoogle(s, { sub: "g", email: "a@b.com", email_verified: true }, challenge, "exp://192.168.1.5:8081/--/auth")).start.status).toBe(302);
  });

  it("requires a PKCE challenge", async () => {
    const s = setup(true, GOOGLE);
    expect((await mobileGoogle(s, { sub: "g", email: "a@b.com", email_verified: true }, "short")).start.status).toBe(400);
  });

  it("hands the app a one-time code (never a session), and the code redeems once for a bearer token", async () => {
    const s = setup(true, GOOGLE);
    const { verifier, challenge } = await pkce();
    const { cb, location } = await mobileGoogle(s, { sub: "g1", email: "mo@example.com", email_verified: true }, challenge);
    expect(cb!.status).toBe(302);
    expect(location!.startsWith("retro://auth?code=")).toBe(true);
    expect(cb!.headers.get("Set-Cookie") ?? "").not.toContain("atlas_session");
    expect((s.db.prepare(`SELECT COUNT(*) n FROM session s JOIN user u ON u.id=s.user_id WHERE u.email='mo@example.com'`).get() as any).n).toBe(0);
    const code = new URL(location!.replace("retro://auth", "https://x.test/")).searchParams.get("code")!;
    expect((s.db.prepare(`SELECT code_hash FROM auth_code`).get() as any).code_hash).not.toBe(code);

    const ex = await api(s, "POST", "/auth/mobile/exchange", { body: { code, code_verifier: verifier } });
    expect(ex.status).toBe(200);
    expect(ex.json.user.email).toBe("mo@example.com");
    expect((await api(s, "GET", "/auth/me", { as: ex.json.token })).json.user.email).toBe("mo@example.com");

    expect((await api(s, "POST", "/auth/mobile/exchange", { body: { code, code_verifier: verifier } })).status).toBe(400);
  });

  it("a code intercepted by another app is useless without the verifier", async () => {
    const s = setup(true, GOOGLE);
    const { challenge } = await pkce();
    const { location } = await mobileGoogle(s, { sub: "g1", email: "mo@example.com", email_verified: true }, challenge);
    const code = new URL(location!.replace("retro://auth", "https://x.test/")).searchParams.get("code")!;
    const attacker = await pkce();
    expect((await api(s, "POST", "/auth/mobile/exchange", { body: { code, code_verifier: attacker.verifier } })).status).toBe(400);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM session`).get() as any).n).toBe(3); // only the seeded sessions
  });

  it("an expired code is refused", async () => {
    const s = setup(true, GOOGLE);
    const { verifier, challenge } = await pkce();
    const { location } = await mobileGoogle(s, { sub: "g1", email: "mo@example.com", email_verified: true }, challenge);
    const code = new URL(location!.replace("retro://auth", "https://x.test/")).searchParams.get("code")!;
    s.db.prepare(`UPDATE auth_code SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    expect((await api(s, "POST", "/auth/mobile/exchange", { body: { code, code_verifier: verifier } })).status).toBe(400);
  });

  it("cancelling on the provider screen returns to the app with an error, not a web error page", async () => {
    const s = setup(true, GOOGLE);
    const { challenge } = await pkce();
    const { location } = await mobileGoogle(s, { sub: "g1", email: "mo@example.com", email_verified: true }, challenge, "retro://auth", { cancel: true });
    expect(location).toBe("retro://auth?error=cancelled");
  });

  it("an unverified provider email still can't take over an existing account via the app", async () => {
    const s = setup(true, GOOGLE);
    await api(s, "POST", "/auth/register", { body: { name: "Real", email: "mo@example.com", password: "real-pass-123" } });
    const { challenge } = await pkce();
    const { location } = await mobileGoogle(s, { sub: "g9", email: "mo@example.com", email_verified: false }, challenge);
    expect(location).toBe("retro://auth?error=failed");
  });

  it("staff sessions last 7 days, everyone else 30", () => {
    const env = { ADMIN_EMAILS: "info@retroholidays.in" } as Env;
    expect(sessionTtlFor(env, "INFO@retroholidays.in")).toBe(7 * 86400);
    expect(sessionTtlFor(env, "asha@example.com")).toBe(30 * 86400);
  });
});

describe("B2 Sign in with Apple", () => {
  async function appleKit(kid = "kid1") {
    const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256", use: "sig" };
    async function token(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
      const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid, ...header })));
      const p = b64url(new TextEncoder().encode(JSON.stringify({ iss: "https://appleid.apple.com", aud: "in.retro.app", exp: Math.floor(Date.now() / 1000) + 600, sub: "apple-1", email: "ap@example.com", email_verified: "true", ...claims })));
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64url(sig)}`;
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
    return { token };
  }

  it("is off (503) until the app's bundle id is configured", async () => {
    const s = setup();
    expect((await api(s, "POST", "/auth/apple", { body: { identityToken: "x" } })).status).toBe(503);
    expect((await api(s, "GET", "/auth/providers")).json.apple).toBe(false);
    expect((await api(s, "GET", "/app-config?version=1.0.0")).json.flags.appleSignIn).toBe(false);
  });

  it("signs in a valid token, creating the account, and returns a bearer token", async () => {
    const s = setup(true, { APPLE_BUNDLE_ID: "in.retro.app" });
    const { token } = await appleKit();
    const r = await api(s, "POST", "/auth/apple", { body: { identityToken: await token({}), name: "Ana Pple" } });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ email: "ap@example.com", name: "Ana Pple" });
    expect((await api(s, "GET", "/auth/me", { as: r.json.token })).json.user.email).toBe("ap@example.com");
    expect((await api(s, "GET", "/auth/providers")).json.apple).toBe(true);
  });

  it.each([
    ["wrong audience", { aud: "com.other.app" }, {}],
    ["wrong issuer", { iss: "https://evil.example" }, {}],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 10 }, {}],
    ["unknown key id", {}, { kid: "nope" }],
    ["wrong algorithm", {}, { alg: "none" }],
  ])("rejects a token with %s", async (_n, claims, header) => {
    const s = setup(true, { APPLE_BUNDLE_ID: "in.retro.app" });
    const { token } = await appleKit();
    expect((await api(s, "POST", "/auth/apple", { body: { identityToken: await token(claims, header) } })).status).toBe(401);
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const s = setup(true, { APPLE_BUNDLE_ID: "in.retro.app" });
    const { token } = await appleKit();
    const [h, , sig] = (await token({})).split(".");
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ iss: "https://appleid.apple.com", aud: "in.retro.app", exp: Math.floor(Date.now() / 1000) + 600, sub: "apple-1", email: "victim@example.com", email_verified: "true" })));
    expect((await api(s, "POST", "/auth/apple", { body: { identityToken: `${h}.${forged}.${sig}` } })).status).toBe(401);
  });

  it("takes over a squatter's unverified password account only because Apple verified the email", async () => {
    const s = setup(true, { APPLE_BUNDLE_ID: "in.retro.app" });
    await api(s, "POST", "/auth/register", { body: { name: "Squatter", email: "ap@example.com", password: "squatter-pass-1" } });
    const { token } = await appleKit();
    expect((await api(s, "POST", "/auth/apple", { body: { identityToken: await token({}) } })).status).toBe(200);
    expect((await api(s, "POST", "/auth/login", { body: { email: "ap@example.com", password: "squatter-pass-1" } })).status).toBe(400);
  });
});

describe("B3 delete account", () => {
  async function traveller(s: S) {
    const r = await api(s, "POST", "/auth/register", { headers: { "X-Client": "mobile" }, body: { name: "Dee Lete", email: "dee@example.com", password: "delete-me-123" } });
    const created = await api(s, "POST", "/requests", { as: r.json.token, body: submit() });
    await api(s, "POST", `/requests/${created.json.id}/messages`, { as: r.json.token, body: { text: "My number is 98765 43210" } });
    await api(s, "POST", "/enquiries", { body: { name: "Dee", email: "dee@example.com", notes: "hello" } });
    return { token: r.json.token as string, userId: r.json.user.id as string, requestId: created.json.id as string };
  }

  it("needs a session", async () => {
    expect((await api(setup(), "DELETE", "/auth/account")).status).toBe(401);
  });

  it("a password account must re-enter its password", async () => {
    const s = setup();
    const t = await traveller(s);
    expect((await api(s, "DELETE", "/auth/account", { as: t.token })).json.code).toBe("REAUTH_FAILED");
    expect((await api(s, "DELETE", "/auth/account", { as: t.token, body: { password: "wrong-wrong-1" } })).status).toBe(403);
    expect((s.db.prepare(`SELECT email FROM user WHERE id=?`).get(t.userId) as any).email).toBe("dee@example.com");
  });

  it("erases the person but keeps the business record", async () => {
    const s = setup();
    const t = await traveller(s);
    s.db.prepare(`INSERT INTO payment (id, request_id, revision_id, created_at, amount_paise, currency, status, kind, razorpay_order_id) VALUES ('p1', ?, 'r', ?, 5000000, 'INR', 'paid', 'deposit', 'o1')`).run(t.requestId, new Date().toISOString());
    s.db.prepare(`UPDATE quotation_request SET status='paid', paid_inr=50000, accepted_total_inr=50000 WHERE id=?`).run(t.requestId);
    s.db.prepare(`INSERT INTO device (id, user_id, platform, expo_push_token, created_at, last_seen) VALUES ('d1', ?, 'ios', 'ExponentPushToken[abcdefgh12]', 'x', 'x')`).run(t.userId);

    const r = await api(s, "DELETE", "/auth/account", { as: t.token, body: { password: "delete-me-123" } });
    expect(r.status).toBe(200);

    // the person is gone
    expect((await api(s, "GET", "/auth/me", { as: t.token })).json.user).toBeNull();
    expect((await api(s, "POST", "/auth/login", { body: { email: "dee@example.com", password: "delete-me-123" } })).status).toBe(400);
    const u = s.db.prepare(`SELECT * FROM user WHERE id=?`).get(t.userId) as any;
    expect(u).toMatchObject({ name: "Deleted traveller", password_hash: null, auth_provider: null, avatar_url: null });
    expect(u.email).toContain("@deleted.invalid");
    expect((s.db.prepare(`SELECT COUNT(*) n FROM device WHERE user_id=?`).get(t.userId) as any).n).toBe(0);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM enquiry WHERE lower(email)='dee@example.com'`).get() as any).n).toBe(0);

    // the request keeps its money trail but not the person
    const q = s.db.prepare(`SELECT * FROM quotation_request WHERE id=?`).get(t.requestId) as any;
    expect(q).toMatchObject({ user_name: "Deleted traveller", contact_email: null, contact_phone: null, traveller_note: null, total_inr: 100000, paid_inr: 50000 });
    expect(q.user_email).toContain("@deleted.invalid");
    expect(q.snapshot).not.toContain("dee@example.com");
    expect(q.snapshot).not.toContain("asha.work@example.com");
    expect(q.snapshot).not.toContain("anniversary");
    expect((s.db.prepare(`SELECT COUNT(*) n FROM payment WHERE request_id=?`).get(t.requestId) as any).n).toBe(1);
    const events = s.db.prepare(`SELECT type, summary, actor_name, internal FROM request_event WHERE request_id=?`).all(t.requestId) as any[];
    expect(events.find((e) => e.type === "message").summary).toBe("[message removed]");
    expect(events.every((e) => e.actor_name === null || e.actor !== "traveller")).toBe(true);
    expect(events.some((e) => e.internal === 1 && e.summary.includes("deleted their account"))).toBe(true);
  });

  it("a social-only account must have signed in within the last 10 minutes", async () => {
    const s = setup();
    s.db.prepare(`UPDATE session SET created_at = ? WHERE id = 'asha'`).run(new Date(Date.now() - 3600_000).toISOString());
    expect((await api(s, "DELETE", "/auth/account", { as: "asha" })).json.code).toBe("REAUTH_REQUIRED");
    s.db.prepare(`UPDATE session SET created_at = ? WHERE id = 'asha'`).run(new Date().toISOString());
    expect((await api(s, "DELETE", "/auth/account", { as: "asha" })).status).toBe(200);
  });

  it("staff accounts can't be deleted from the app", async () => {
    const s = setup();
    const r = await api(s, "DELETE", "/auth/account", { as: "admin" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("STAFF_ACCOUNT");
  });

  it("a booking in progress blocks deletion", async () => {
    const s = setup();
    const t = await traveller(s);
    s.db.prepare(`UPDATE quotation_request SET status='part_paid' WHERE id=?`).run(t.requestId);
    const r = await api(s, "DELETE", "/auth/account", { as: t.token, body: { password: "delete-me-123" } });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("OPEN_BOOKING");
    expect((s.db.prepare(`SELECT email FROM user WHERE id=?`).get(t.userId) as any).email).toBe("dee@example.com");
  });
});

describe("B4 hosted payment page", () => {
  async function accepted(s: S) {
    const created = await api(s, "POST", "/requests", { as: "asha", body: { ...submit(), destinationSummary: "Paris </script><script>alert(1)</script>" } });
    const id = created.json.id as string;
    s.db.prepare(`UPDATE quotation_request SET status='accepted', accepted_total_inr=100000, accepted_revision_id='rev1' WHERE id=?`).run(id);
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("api.razorpay.com/v1/orders") ? new Response(JSON.stringify({ id: "order_1", amount: 10000000, currency: "INR", status: "created" })) : new Response(null, { status: 202 }),
    ));
    return id;
  }
  const mobile = { "X-Client": "mobile" };

  it("the website's response is unchanged; the app also gets a pay link", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    expect((await api(s, "POST", `/requests/${id}/pay`, { as: "asha" })).json.payUrl).toBeUndefined();
    const r = await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile });
    expect(r.json.orderId).toBe("order_1");
    expect(r.json.payUrl).toMatch(new RegExp(`^https://retroholidays.in/api/pay/${id}\\?t=`));
  });

  it("refuses a return link outside the allow-list", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    expect((await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile, body: { returnUrl: "https://evil.example" } })).status).toBe(400);
    expect((await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile, body: { returnUrl: "retro://pay-result" } })).status).toBe(200);
  });

  it("serves a locked-down page for a valid link, with nothing from the session in it", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    const { json } = await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile });
    const page = await api(s, "GET", `/pay/${id}?t=${new URL(json.payUrl).searchParams.get("t")}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(page.text).toContain("checkout.razorpay.com/v1/checkout.js");
    expect(page.text).toContain("order_1");
    expect(page.text).not.toMatch(/atlas_session|Bearer|"asha"/); // nothing from the session
    // hostile data in the trip name can't break out of the embedded JSON
    expect(page.text).not.toContain("</script><script>alert(1)");
  });

  it("rejects a tampered, foreign or expired link", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    const t = new URL((await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile })).json.payUrl).searchParams.get("t")!;
    expect((await api(s, "GET", `/pay/${id}?t=${t.slice(0, -2)}xx`)).status).toBe(403);
    expect((await api(s, "GET", `/pay/${id}?t=`)).status).toBe(403);
    expect((await api(s, "GET", `/pay/other-id?t=${t}`)).status).toBe(403);
    const old = (await signPayToken(s.env, { r: id, u: "u1", o: "order_1", b: "retro://pay-result" }, Date.now() - 20 * 60_000))!;
    expect((await api(s, "GET", `/pay/${id}?t=${old}`)).status).toBe(403);
  });

  it("the pay token is worthless as a session", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    const t = new URL((await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile })).json.payUrl).searchParams.get("t")!;
    expect((await api(s, "GET", "/requests", { as: t })).status).toBe(401);
    expect(await verifyPayToken({ ...s.env, RAZORPAY_KEY_SECRET: "different" } as Env, t)).toBeNull();
  });

  it("settles through the page's verify route with a valid signature, and only that", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    const t = new URL((await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile })).json.payUrl).searchParams.get("t")!;
    const bad = await api(s, "POST", `/pay/${id}/verify?t=${t}`, { body: { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: "00" } });
    expect(bad.status).toBe(400);
    expect((s.db.prepare(`SELECT paid_inr FROM quotation_request WHERE id=?`).get(id) as any).paid_inr).toBe(0);

    const other = await api(s, "POST", `/pay/${id}/verify?t=${t}`, { body: { razorpay_order_id: "order_999", razorpay_payment_id: "pay_1", razorpay_signature: await hmacSha256Hex("sekret", "order_999|pay_1") } });
    expect(other.status).toBe(404); // the token names order_1 only

    const sig = await hmacSha256Hex("sekret", "order_1|pay_1");
    const ok = await api(s, "POST", `/pay/${id}/verify?t=${t}`, { body: { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: sig } });
    expect(ok.status).toBe(200);
    expect((s.db.prepare(`SELECT paid_inr, status FROM quotation_request WHERE id=?`).get(id) as any)).toMatchObject({ paid_inr: 100000, status: "paid" });
    // the app sees it by reading the request, which is how it confirms
    expect((await api(s, "GET", `/requests/${id}`, { as: "asha" })).json.payment.paidInr).toBe(100000);
  });

  it("verify still works up to an hour after the page opened (UPI app switches are slow), but the page itself does not reopen", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile });
    const t = (await signPayToken(s.env, { r: id, u: "u1", o: "order_1", b: "retro://pay-result" }, Date.now() - 30 * 60_000))!;
    expect((await api(s, "GET", `/pay/${id}?t=${t}`)).status).toBe(403);
    const sig = await hmacSha256Hex("sekret", "order_1|pay_1");
    expect((await api(s, "POST", `/pay/${id}/verify?t=${t}`, { body: { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: sig } })).status).toBe(200);
  });

  it("is unavailable, not broken, when Razorpay isn't configured", async () => {
    const s = setup(true, RAZOR);
    const id = await accepted(s);
    const t = new URL((await api(s, "POST", `/requests/${id}/pay`, { as: "asha", headers: mobile })).json.payUrl).searchParams.get("t")!;
    delete (s.env as any).RAZORPAY_KEY_SECRET;
    expect((await api(s, "GET", `/pay/${id}?t=${t}`)).status).toBe(403);
  });
});

describe("B6 push notifications", () => {
  const TOKEN = "ExponentPushToken[abcdefghij123]";
  const pushes: any[] = [];
  function expo(opts: { tickets?: any[]; receipts?: Record<string, any>; fail?: boolean } = {}) {
    pushes.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.includes("push/send")) {
        if (opts.fail) throw new Error("expo down");
        const batch = JSON.parse(String(init.body)) as any[];
        pushes.push(...batch);
        return new Response(JSON.stringify({ data: opts.tickets ?? batch.map((_, i) => ({ status: "ok", id: `t${pushes.length}-${i}` })) }));
      }
      if (u.includes("getReceipts")) return new Response(JSON.stringify({ data: opts.receipts ?? {} }));
      return new Response(null, { status: 202 });
    }));
  }
  const register = (s: S, as: string, token = TOKEN) => api(s, "POST", "/devices", { as, body: { expoPushToken: token, platform: "ios", appVersion: "1.0.0" } });
  const sendQuote = (s: S, id: string) => api(s, "POST", `/admin/requests/${id}/send`, { as: "admin", body: { request: { placeIds: ["paris"], nights: 5, startDate: "2030-01-10" }, quotation: fakeQuotation(), adjustments: { lines: [], depositInr: null, fixedPackageInr: null } } });

  it("registers a device for the signed-in user only, and validates the token", async () => {
    const s = setup();
    expo();
    expect((await api(s, "POST", "/devices", { body: { expoPushToken: TOKEN, platform: "ios" } })).status).toBe(401);
    expect((await register(s, "asha", "not-a-token")).status).toBe(400);
    expect((await api(s, "POST", "/devices", { as: "asha", body: { expoPushToken: TOKEN, platform: "windows" } })).status).toBe(400);
    const ok = await register(s, "asha");
    expect(ok.status).toBe(201);
    expect((s.db.prepare(`SELECT user_id FROM device WHERE id=?`).get(ok.json.id) as any).user_id).toBe("u1");
  });

  it("a phone that changes hands follows its new signed-in user", async () => {
    const s = setup();
    expo();
    await register(s, "asha");
    await register(s, "admin");
    expect(s.db.prepare(`SELECT user_id FROM device`).all()).toEqual([{ user_id: "a1" }]);
  });

  it("keeps at most 10 devices per person", async () => {
    const s = setup();
    expo();
    for (let i = 0; i < 12; i += 1) await register(s, "asha", `ExponentPushToken[device${String(i).padStart(4, "0")}xx]`);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM device WHERE user_id='u1'`).get() as any).n).toBe(10);
  });

  it("only the owner can remove a device", async () => {
    const s = setup();
    expo();
    const { json } = await register(s, "asha");
    expect((await api(s, "DELETE", `/devices/${json.id}`, { as: "admin" })).status).toBe(404);
    expect((await api(s, "DELETE", `/devices/${json.id}`, { as: "asha" })).status).toBe(200);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM device`).get() as any).n).toBe(0);
  });

  it("a quote sent to the traveller pushes a GENERIC message: no name, place, amount or text", async () => {
    const s = setup();
    expo();
    await register(s, "asha");
    const created = await api(s, "POST", "/requests", { as: "asha", body: submit() });
    pushes.length = 0;
    expect((await sendQuote(s, created.json.id)).status).toBe(200);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ to: TOKEN, title: "Retro Holidays", body: "Your quote is ready to review.", data: { kind: "quote_ready", requestId: created.json.id } });
    const wire = JSON.stringify(pushes[0]);
    for (const secret of ["Asha", "Paris", "Rome", "100", "asha@", "anniversary"]) expect(wire).not.toContain(secret);
  });

  it("two events on one request within two minutes coalesce into one push", async () => {
    const s = setup();
    expo();
    await register(s, "asha");
    const created = await api(s, "POST", "/requests", { as: "asha", body: submit() });
    pushes.length = 0;
    await api(s, "POST", `/admin/requests/${created.json.id}/messages`, { as: "admin", body: { text: "one" } });
    await api(s, "POST", `/admin/requests/${created.json.id}/messages`, { as: "admin", body: { text: "two" } });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body).toBe("You have a new message.");
  });

  it("staff are chosen at send time: a non-staff phone never gets staff pushes", async () => {
    const s = setup();
    expo();
    await register(s, "asha", "ExponentPushToken[travellerphone1]");
    await register(s, "admin", "ExponentPushToken[staffphone0001x]");
    pushes.length = 0;
    await api(s, "POST", "/requests", { as: "asha", body: submit() });
    expect(pushes.map((p) => p.to)).toEqual(["ExponentPushToken[staffphone0001x]"]);
    expect(pushes[0].body).toBe("A new quote request has arrived.");
  });

  it("a traveller's message pushes staff, and a payment pushes both sides", async () => {
    const s = setup();
    expo();
    await register(s, "admin", "ExponentPushToken[staffphone0001x]");
    await register(s, "asha");
    const created = await api(s, "POST", "/requests", { as: "asha", body: submit() });
    const id = created.json.id as string;
    const twoMinutesLater = () => s.db.exec("DELETE FROM rate_limit WHERE k LIKE '%'");

    twoMinutesLater();
    pushes.length = 0;
    await api(s, "POST", `/requests/${id}/messages`, { as: "asha", body: { text: "hello" } });
    expect(pushes.map((p) => [p.data.kind, p.to])).toEqual([["message", "ExponentPushToken[staffphone0001x]"]]);

    twoMinutesLater();
    pushes.length = 0;
    s.db.prepare(`UPDATE quotation_request SET status='accepted', accepted_total_inr=100000 WHERE id=?`).run(id);
    s.db.prepare(`INSERT INTO payment (id, request_id, revision_id, created_at, amount_paise, currency, status, kind, razorpay_order_id) VALUES ('p1', ?, 'r1', ?, 10000000, 'INR', 'created', 'full', 'order_1')`).run(id, new Date().toISOString());
    await settlePayment(s.env, ctx, { orderId: "order_1", paymentId: "pay_1" });
    await Promise.allSettled(pending.splice(0));
    expect(pushes.map((p) => p.data.kind)).toEqual(["payment", "payment"]);
    expect(pushes.map((p) => p.to).sort()).toEqual([TOKEN, "ExponentPushToken[staffphone0001x]"].sort());
    expect(JSON.stringify(pushes)).not.toContain("100000");
  });

  it("removes a token Expo says is dead, at once and again from receipts", async () => {
    const s = setup();
    expo({ tickets: [{ status: "error", details: { error: "DeviceNotRegistered" } }] });
    await register(s, "asha");
    await api(s, "POST", "/requests", { as: "asha", body: submit() });
    const created = (s.db.prepare(`SELECT id FROM quotation_request`).get() as any).id;
    await sendQuote(s, created);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM device`).get() as any).n).toBe(0);

    // via receipts
    expo();
    await register(s, "asha");
    s.db.prepare(`INSERT INTO push_ticket (id, token, created_at) VALUES ('tk1', ?, ?)`).run(TOKEN, new Date(Date.now() - 30 * 60_000).toISOString());
    expo({ receipts: { tk1: { status: "error", details: { error: "DeviceNotRegistered" } } } });
    const out = await runScheduled(s.env);
    expect(out.receipts.removed).toBe(1);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM device`).get() as any).n).toBe(0);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM push_ticket WHERE id='tk1'`).get() as any).n).toBe(0);
  });

  it("a push outage never fails the request it rode on", async () => {
    const s = setup();
    expo({ fail: true });
    await register(s, "asha");
    const created = await api(s, "POST", "/requests", { as: "asha", body: submit() });
    expect(created.status).toBe(201);
    expect((await sendQuote(s, created.json.id)).status).toBe(200);
  });

  it("cron reminds once before expiry, tells the traveller when it lapses, and nudges staff once a day", async () => {
    const s = setup();
    expo();
    await register(s, "asha");
    await register(s, "admin", "ExponentPushToken[staffphone0001x]");
    const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
    const a = await api(s, "POST", "/requests", { as: "asha", body: submit() });
    s.db.prepare(`UPDATE quotation_request SET status='quoted', quote_valid_until=? WHERE id=?`).run(soon, a.json.id);
    // an old request the agency hasn't answered
    const b = await api(s, "POST", "/requests", { as: "asha", body: submit() });
    s.db.prepare(`UPDATE quotation_request SET created_at=?, updated_at=? WHERE id=?`).run(new Date(Date.now() - 3 * 86400_000).toISOString(), new Date(Date.now() - 3 * 86400_000).toISOString(), b.json.id);

    pushes.length = 0;
    const first = await runScheduled(s.env);
    expect(first.reminded).toBe(1);
    expect(first.waiting).toBeGreaterThan(0);
    expect(pushes.map((p) => p.data.kind).sort()).toEqual(["quote_expiring", "waiting"]);

    s.db.exec("DELETE FROM rate_limit WHERE k LIKE 'push:%'"); // pretend two minutes passed
    pushes.length = 0;
    const second = await runScheduled(s.env);
    expect(second.reminded).toBe(0);
    expect(pushes).toHaveLength(0); // no second reminder, and the staff nudge is once a day

    s.db.prepare(`UPDATE quotation_request SET quote_valid_until=? WHERE id=?`).run(new Date(Date.now() - 1000).toISOString(), a.json.id);
    s.db.exec("DELETE FROM rate_limit WHERE k LIKE 'push:%'");
    const third = await runScheduled(s.env);
    expect(third.expired).toBe(1);
    expect(pushes.map((p) => p.data.kind)).toContain("quote_expired");
  });
});
