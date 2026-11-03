/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and DB rows are untyped JSON in these tests */
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";
import { settlePayment } from "@/workers/api/src/payments";
import { runScheduled } from "@/workers/api/src/cron";
import { safeRedirect } from "@/workers/api/src/oauth";
import { createTestDb } from "../helpers/d1";
import { fakeQuotation } from "../helpers/quotation";

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
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


const submit = (extra: Record<string, unknown> = {}) => ({
  request: { placeIds: ["paris", "rome"], nights: 5, startDate: "2030-01-10", adults: 2 },
  quotation: fakeQuotation(),
  destinationSummary: "Paris, Rome",
  totals: { total: 100_000, perPerson: 50_000 },
  contact: { email: "asha.work@example.com" },
  ...extra,
});

beforeEach(() => vi.unstubAllGlobals());

const GOOGLE = { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec" };

/** Runs a Google callback end to end against the real DB. */
async function googleSignIn(s: ReturnType<typeof setup>, profile: { sub: string; email: string; email_verified: boolean }, opts: { cookie?: boolean; redirect?: string } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("oauth2.googleapis.com") ? new Response(JSON.stringify({ access_token: "t" })) : new Response(JSON.stringify({ ...profile, name: "Vic Tim" })),
  ));
  const start = await worker.fetch(new Request(`https://example.com/api/auth/google/start?redirect=${encodeURIComponent(opts.redirect ?? "/plan")}`), s.env, ctx);
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const cb = await worker.fetch(
    new Request(`https://example.com/api/auth/google/callback?code=c&state=${state}`, { headers: opts.cookie === false ? {} : { Cookie: `atlas_oauth_state=${state}` } }),
    s.env,
    ctx,
  );
  return { start, cb, state };
}

describe("audit: OAuth", () => {
  it.each([["https://evil.example/x"], ["//evil.example"], ["/\\evil.example"], ["javascript:alert(1)"], ["/ok\nbad"]])("sanitises redirect %s", (raw) => {
    expect(safeRedirect(raw)).toBe("/plan");
  });
  it("keeps a same-site path", () => expect(safeRedirect("/plan?x=1#top")).toBe("/plan?x=1#top"));

  it("never sends the traveller off-site after sign-in", async () => {
    const s = setup(true, GOOGLE);
    const { cb } = await googleSignIn(s, { sub: "g1", email: "vic@example.com", email_verified: true }, { redirect: "https://evil.example/steal" });
    expect(cb.status).toBe(302);
    expect(new URL(cb.headers.get("Location")!).origin).toBe("https://retroholidays.in");
  });

  it("refuses a callback that the starting browser did not make (login CSRF)", async () => {
    const s = setup(true, GOOGLE);
    const { cb } = await googleSignIn(s, { sub: "g1", email: "vic@example.com", email_verified: true }, { cookie: false });
    expect(cb.status).toBe(400);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM user WHERE email='vic@example.com'`).get() as any).n).toBe(0);
  });

  it("stores the OAuth session hashed, like an email login", async () => {
    const s = setup(true, GOOGLE);
    await googleSignIn(s, { sub: "g1", email: "vic@example.com", email_verified: true });
    const ids = (s.db.prepare(`SELECT s.id FROM session s JOIN user u ON u.id = s.user_id WHERE u.email='vic@example.com'`).all() as any[]).map((r) => r.id);
    expect(ids).toHaveLength(1);
    expect(ids[0].startsWith("h:")).toBe(true);
  });

  it("pre-registration takeover: the squatter's password and sessions die when the real owner signs in with Google", async () => {
    const s = setup(true, GOOGLE);
    const reg = await s.call(null, "POST", "/auth/register", { name: "Squatter", email: "vic@example.com", password: "squatter-pass-1" }, { "X-Client": "mobile" });
    expect(reg.status).toBe(201);
    const squatterToken = reg.json.token as string;
    const { cb } = await googleSignIn(s, { sub: "g1", email: "vic@example.com", email_verified: true });
    expect(cb.status).toBe(302);
    expect((await s.call(null, "POST", "/auth/login", { email: "vic@example.com", password: "squatter-pass-1" })).status).toBe(400);
    const me = await worker.fetch(new Request("https://example.com/api/auth/me", { headers: { Authorization: `Bearer ${squatterToken}` } }), s.env, ctx);
    expect(((await me.json()) as any).user).toBeNull();
    expect((s.db.prepare(`SELECT COUNT(*) n FROM user WHERE email='vic@example.com'`).get() as any).n).toBe(1);
  });

  it("an unverified provider email is never merged into an existing account", async () => {
    const s = setup(true, GOOGLE);
    await s.call(null, "POST", "/auth/register", { name: "Real", email: "vic@example.com", password: "real-pass-123" });
    const { cb } = await googleSignIn(s, { sub: "g9", email: "vic@example.com", email_verified: false });
    expect(cb.status).toBe(400);
    expect((await s.call(null, "POST", "/auth/login", { email: "vic@example.com", password: "real-pass-123" })).status).toBe(200);
  });

  it("a verified password account (reset by email) keeps its password when Google links", async () => {
    const s = setup(true, GOOGLE);
    await s.call(null, "POST", "/auth/register", { name: "Real", email: "vic@example.com", password: "real-pass-123" });
    s.db.prepare(`UPDATE user SET password_verified_at = ? WHERE email='vic@example.com'`).run(new Date().toISOString());
    await googleSignIn(s, { sub: "g1", email: "vic@example.com", email_verified: true });
    expect((await s.call(null, "POST", "/auth/login", { email: "vic@example.com", password: "real-pass-123" })).status).toBe(200);
  });

  it("pressing Cancel on the provider screen returns to the site, not to a JSON error", async () => {
    const s = setup(true, GOOGLE);
    const start = await worker.fetch(new Request("https://example.com/api/auth/google/start"), s.env, ctx);
    const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
    const cb = await worker.fetch(new Request(`https://example.com/api/auth/google/callback?error=access_denied&state=${state}`), s.env, ctx);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("Location")).toContain("/plan?signin=cancelled");
  });

  it("a provider outage is a clean 400, not a 500", async () => {
    const s = setup(true, GOOGLE);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const start = await worker.fetch(new Request("https://example.com/api/auth/google/start"), s.env, ctx);
    const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
    const cb = await worker.fetch(new Request(`https://example.com/api/auth/google/callback?code=c&state=${state}`, { headers: { Cookie: `atlas_oauth_state=${state}` } }), s.env, ctx);
    expect(cb.status).toBe(400);
  });
});

describe("audit: rate limits", () => {
  it("login: the 11th try on one address in 15 minutes is refused, even from different networks", async () => {
    const s = setup();
    await s.call(null, "POST", "/auth/register", { name: "A", email: "a@example.com", password: "correct-horse-1" });
    let last = 0;
    for (let i = 0; i < 11; i += 1) last = (await s.call(null, "POST", "/auth/login", { email: "a@example.com", password: "wrong-wrong-1" }, { "CF-Connecting-IP": `203.0.113.${i + 1}` })).status;
    expect(last).toBe(429);
    const blocked = await s.call(null, "POST", "/auth/login", { email: "a@example.com", password: "correct-horse-1" });
    expect(blocked.status).toBe(429);
    expect(blocked.json.code).toBe("RATE_LIMITED");
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("login: a different address is not affected", async () => {
    const s = setup();
    for (let i = 0; i < 11; i += 1) await s.call(null, "POST", "/auth/login", { email: "a@example.com", password: "wrong-wrong-1" });
    expect((await s.call(null, "POST", "/auth/login", { email: "b@example.com", password: "wrong-wrong-1" })).status).toBe(400);
  });

  it("register: 11th sign-up from one network in an hour is refused; no header means no IP limit", async () => {
    const s = setup();
    const ip = { "CF-Connecting-IP": "198.51.100.7" };
    let last = 0;
    for (let i = 0; i < 11; i += 1) last = (await s.call(null, "POST", "/auth/register", { name: "N", email: `n${i}@example.com`, password: "password-123" }, ip)).status;
    expect(last).toBe(429);
    const s2 = setup();
    for (let i = 0; i < 12; i += 1) expect((await s2.call(null, "POST", "/auth/register", { name: "N", email: `m${i}@example.com`, password: "password-123" })).status).toBe(201);
  });

  it("enquiries and saved quotes are bounded per network", async () => {
    const s = setup();
    const ip = { "CF-Connecting-IP": "198.51.100.9" };
    let e = 0;
    for (let i = 0; i < 11; i += 1) e = (await s.call(null, "POST", "/enquiries", { name: "X", phone: "+91 98765 43210" }, ip)).status;
    expect(e).toBe(429);
    let q = 0;
    for (let i = 0; i < 31; i += 1) q = (await s.call(null, "POST", "/quotes", { request: { placeIds: ["a"], nights: 3, startDate: "2030-01-01" }, totals: { total: 1, perPerson: 1 } }, ip)).status;
    expect(q).toBe(429);
  });

  it("the limiter failing open: a broken counter never blocks a request", async () => {
    const s = setup();
    s.db.exec("DROP TABLE rate_limit");
    expect((await s.call(null, "POST", "/auth/register", { name: "N", email: "z@example.com", password: "password-123" }, { "CF-Connecting-IP": "198.51.100.1" })).status).toBe(201);
  });

  it("rejects an absurd password length instead of hashing it", async () => {
    const s = setup();
    expect((await s.call(null, "POST", "/auth/register", { name: "N", email: "y@example.com", password: "x".repeat(5000) })).status).toBe(400);
  });
});

describe("audit: request validation", () => {
  it.each([
    ["negative nights", { request: { placeIds: ["a"], nights: -5, startDate: "2030-01-10" } }],
    ["fractional nights", { request: { placeIds: ["a"], nights: 2.5, startDate: "2030-01-10" } }],
    ["junk date", { request: { placeIds: ["a"], nights: 3, startDate: "tomorrow" } }],
    ["non-string place", { request: { placeIds: [123], nights: 3, startDate: "2030-01-10" } }],
    ["negative total", { totals: { total: -1, perPerson: 1 } }],
  ])("create request rejects %s", async (_n, over) => {
    const s = setup();
    expect((await s.call("asha", "POST", "/requests", submit(over))).status).toBe(400);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM quotation_request`).get() as any).n).toBe(0);
  });

  it("a corrupt stored quote does not turn the traveller's page into a 500", async () => {
    const s = setup();
    const c = await s.call("asha", "POST", "/requests", submit());
    await s.call("admin", "POST", `/admin/requests/${c.json.id}/send`, { request: { placeIds: ["paris"], nights: 5, startDate: "2030-01-10" }, quotation: fakeQuotation(), adjustments: { lines: [], depositInr: null, fixedPackageInr: null } });
    s.db.prepare(`UPDATE quote_revision SET public_view = '{not json'`).run();
    const r = await s.call("asha", "GET", `/requests/${c.json.id}`);
    expect(r.status).toBe(200);
    expect(r.json.quote).toBeNull();
  });
});

describe("audit: sending a quote is all-or-nothing", () => {
  it("if writing the revision fails, the request goes back to where it was and nothing is emailed", async () => {
    const s = setup();
    const c = await s.call("asha", "POST", "/requests", submit());
    const before = mailCount();
    const real = s.database.batch.bind(s.database);
    (s.database as any).batch = async () => { throw new Error("D1 unavailable"); };
    const r = await s.call("admin", "POST", `/admin/requests/${c.json.id}/send`, { request: { placeIds: ["paris"], nights: 5, startDate: "2030-01-10" }, quotation: fakeQuotation(), adjustments: { lines: [], depositInr: null, fixedPackageInr: null } });
    (s.database as any).batch = real;
    expect(r.status).toBe(500);
    expect((s.db.prepare(`SELECT status FROM quotation_request WHERE id=?`).get(c.json.id) as any).status).toBe("pending");
    expect(mailCount()).toBe(before);
  });
});

describe("audit: money arriving on a request that is no longer payable", () => {
  it("is recorded and escalated to the agency, and the traveller is not told the booking is confirmed", async () => {
    const s = setup();
    const c = await s.call("asha", "POST", "/requests", submit());
    const id = c.json.id as string;
    s.db.prepare(`UPDATE quotation_request SET status='accepted', accepted_total_inr=100000 WHERE id=?`).run(id);
    s.db.prepare(`INSERT INTO payment (id, request_id, revision_id, created_at, amount_paise, currency, status, kind, razorpay_order_id) VALUES ('p1', ?, 'r1', ?, 10000000, 'INR', 'created', 'full', 'order_1')`).run(id, new Date().toISOString());
    // The agency re-quotes while the traveller is still in Checkout.
    s.db.prepare(`UPDATE quotation_request SET status='quoted' WHERE id=?`).run(id);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => (calls.push(String(init.body)), new Response(null, { status: 202 }))));
    const out = await settlePayment(s.env, undefined, { orderId: "order_1", paymentId: "pay_1" });
    expect(out?.status).toBe("quoted");
    expect((s.db.prepare(`SELECT status, paid_inr FROM quotation_request WHERE id=?`).get(id) as any)).toMatchObject({ status: "quoted", paid_inr: 0 });
    expect((s.db.prepare(`SELECT status FROM payment WHERE id='p1'`).get() as any).status).toBe("paid");
    expect(calls.some((b) => b.includes("ATTENTION"))).toBe(true);
    expect(calls.some((b) => b.includes("booking is confirmed"))).toBe(false);
  });
});

describe("audit: live rates cannot be used to burn the upstream quota", () => {
  it("malformed queries never reach the upstream API", async () => {
    const s = setup(true, { TRAVELPAYOUTS_TOKEN: "t", LITEAPI_KEY: "k" });
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    for (const q of ["origin=../x&destinationIata=PAR&month=2030-01", "origin=DEL&destinationIata=PAR&month=soon", "cityName=Paris&countryCode=FRANCE&checkin=2030-01-01&checkout=2030-01-03", "cityName=Paris&countryCode=FR&checkin=2030-01-01&checkout=2031-01-03"]) {
      const r = await s.call(null, "GET", `/live-rates?${q}`);
      expect(r.status).toBe(200);
      expect(r.json.rates).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a well-formed query is allowed through and an empty answer is remembered", async () => {
    const s = setup(true, { TRAVELPAYOUTS_TOKEN: "t" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await s.call(null, "GET", "/live-rates?origin=DEL&destinationIata=CDG&month=2030-01");
    await s.call(null, "GET", "/live-rates?origin=DEL&destinationIata=CDG&month=2030-01");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("scheduled maintenance", () => {
  it("purges dead rows, keeps live ones, and expires lapsed quotes in the background", async () => {
    const s = setup();
    const past = new Date(Date.now() - 86400_000 * 3).toISOString();
    const now = new Date().toISOString();
    s.db.prepare(`INSERT INTO session (id, user_id, created_at, expires_at) VALUES ('dead', 'u1', ?, ?)`).run(past, past);
    s.db.prepare(`INSERT INTO oauth_state (state, provider, created_at) VALUES ('old', 'google', ?)`).run(past);
    s.db.prepare(`INSERT INTO oauth_state (state, provider, created_at) VALUES ('fresh', 'google', ?)`).run(now);
    s.db.prepare(`INSERT INTO rate_limit (k, w, n, exp) VALUES ('a', 1, 5, 1)`).run();
    const c = await s.call("asha", "POST", "/requests", submit());
    s.db.prepare(`UPDATE quotation_request SET status='quoted', quote_valid_until=? WHERE id=?`).run(past, c.json.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));

    const out = await runScheduled(s.env);
    expect(out.expired).toBe(1);
    expect((s.db.prepare(`SELECT status FROM quotation_request WHERE id=?`).get(c.json.id) as any).status).toBe("expired");
    expect((s.db.prepare(`SELECT COUNT(*) n FROM session WHERE id='dead'`).get() as any).n).toBe(0);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM session WHERE id='asha'`).get() as any).n).toBe(1);
    expect((s.db.prepare(`SELECT state FROM oauth_state`).all() as any[]).map((r) => r.state)).toEqual(["fresh"]);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM rate_limit WHERE k = 'a'`).get() as any).n).toBe(0);
    // idempotent: a second run changes nothing
    expect((await runScheduled(s.env)).expired).toBe(0);
  });
});
