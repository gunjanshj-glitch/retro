/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and DB rows are untyped JSON in these tests */
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";
import { compareVersions, handleAppConfig } from "@/workers/api/src/app-config";
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

function setup(withKv = true) {
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
  const env = { DB: database, ENVIRONMENT: "test", PUBLIC_SITE_URL: "https://retroholidays.in", ADMIN_EMAILS: "info@retroholidays.in,two@retroholidays.in", ...(withKv ? { RATE_CACHE: kv as unknown as KVNamespace } : {}) } as Env;
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
  return { db, call, kv };
}

const submit = () => ({
  request: { placeIds: ["paris", "rome"], nights: 5, startDate: "2030-01-10", adults: 2 },
  quotation: fakeQuotation(),
  destinationSummary: "Paris, Rome",
  totals: { total: 100_000, perPerson: 50_000 },
  contact: { email: "asha.work@example.com" },
});

beforeEach(() => vi.unstubAllGlobals());

async function withRequest() {
  const s = setup();
  const created = await s.call("asha", "POST", "/requests", submit());
  return { s, id: created.json.id as string };
}
const cfg = (query: string, env: Partial<Env> = {}) =>
  handleAppConfig(new Request(`https://example.com/api/app-config?${query}`), env as Env).json() as Promise<any>;

describe("B5 /app-config", () => {
  it("is public, cacheable, and blocks nothing by default", async () => {
    const s = setup();
    const r = await s.call(null, "GET", "/app-config?platform=ios&version=1.0.3");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ updateRequired: false, maintenance: false, whatsapp: "916290855027", flags: {} });
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("compares versions numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });

  it("requires an update below the minimum and offers one below latest", async () => {
    const env = { APP_MIN_VERSION: "1.2.0", APP_LATEST_VERSION: "1.4.0" };
    expect(await cfg("version=1.1.9", env)).toMatchObject({ updateRequired: true, updateAvailable: true });
    expect(await cfg("version=1.3.0", env)).toMatchObject({ updateRequired: false, updateAvailable: true });
    expect(await cfg("version=1.10.0", env)).toMatchObject({ updateRequired: false, updateAvailable: false });
  });

  it("fails open on an unreadable version rather than locking a working app out", async () => {
    expect(await cfg("version=banana", { APP_MIN_VERSION: "9.0.0" })).toMatchObject({ updateRequired: false });
    expect(await cfg("", { APP_MIN_VERSION: "9.0.0" })).toMatchObject({ updateRequired: false });
  });

  it("ignores a malformed minimum instead of blocking everyone", async () => {
    expect(await cfg("version=1.0.0", { APP_MIN_VERSION: "latest" })).toMatchObject({ minVersion: "1.0.0", updateRequired: false });
  });

  it("reports maintenance with a message, and parses flags", async () => {
    const r = await cfg("version=1.0.0", { APP_MAINTENANCE: "1", APP_MAINTENANCE_MESSAGE: "Back at 6pm", APP_FLAGS: "chat=1, apple=0, bad key=1" });
    expect(r).toMatchObject({ maintenance: true, maintenanceMessage: "Back at 6pm", flags: { chat: true, apple: false } });
  });
});

describe("B10 messages", () => {
  it("traveller message is stored, visible to both sides, and does not move the status", async () => {
    const { s, id } = await withRequest();
    const before = (s.db.prepare(`SELECT status FROM quotation_request WHERE id=?`).get(id) as any).status;
    const r = await s.call("asha", "POST", `/requests/${id}/messages`, { text: "Can we add a day in Lyon?" });
    expect(r.status).toBe(201);
    expect((s.db.prepare(`SELECT status FROM quotation_request WHERE id=?`).get(id) as any).status).toBe(before);
    const mine = await s.call("asha", "GET", `/requests/${id}`);
    expect(mine.json.events.some((e: any) => e.type === "message" && e.actor === "traveller")).toBe(true);
    const staff = await s.call("admin", "GET", `/admin/requests/${id}`);
    expect(staff.json.events.some((e: any) => e.type === "message")).toBe(true);
  });

  it("another traveller cannot post on it, and signed-out is refused", async () => {
    const { s, id } = await withRequest();
    expect((await s.call(null, "POST", `/requests/${id}/messages`, { text: "hi there" })).status).toBe(401);
    expect((await s.call("admin", "POST", `/requests/${id}/messages`, { text: "hi there" })).status).toBe(404);
  });

  it("rejects an empty message and a closed request", async () => {
    const { s, id } = await withRequest();
    expect((await s.call("asha", "POST", `/requests/${id}/messages`, { text: "  " })).status).toBe(400);
    s.db.prepare(`UPDATE quotation_request SET status='closed' WHERE id=?`).run(id);
    expect((await s.call("asha", "POST", `/requests/${id}/messages`, { text: "still there?" })).status).toBe(409);
  });

  it("floods are stopped at 20 an hour", async () => {
    const { s, id } = await withRequest();
    for (let i = 0; i < 20; i += 1) expect((await s.call("asha", "POST", `/requests/${id}/messages`, { text: `m${i}` })).status).toBe(201);
    expect((await s.call("asha", "POST", `/requests/${id}/messages`, { text: "one more" })).status).toBe(429);
  });

  it("a retried message with the same Idempotency-Key is stored once", async () => {
    const { s, id } = await withRequest();
    const K = { "Idempotency-Key": "msg-key-0001-abc" };
    await s.call("asha", "POST", `/requests/${id}/messages`, { text: "hello" }, K);
    await s.call("asha", "POST", `/requests/${id}/messages`, { text: "hello" }, K);
    expect((s.db.prepare(`SELECT COUNT(*) n FROM request_event WHERE type='message'`).get() as any).n).toBe(1);
  });

  it("staff reply is public to the traveller (a note stays private) and emails them", async () => {
    const { s, id } = await withRequest();
    const mailsBefore = mailCount();
    expect((await s.call("admin", "POST", `/admin/requests/${id}/messages`, { text: "Yes, adding Lyon." })).status).toBe(201);
    await s.call("admin", "POST", `/admin/requests/${id}/note`, { text: "margin is thin" });
    const mine = await s.call("asha", "GET", `/requests/${id}`);
    const summaries = mine.json.events.map((e: any) => e.summary);
    expect(summaries).toContain("Yes, adding Lyon.");
    expect(summaries).not.toContain("margin is thin");
    expect(mailCount()).toBeGreaterThan(mailsBefore);
  });

  it("only staff can post a staff reply", async () => {
    const { s, id } = await withRequest();
    expect((await s.call("asha", "POST", `/admin/requests/${id}/messages`, { text: "I am staff" })).status).toBe(404);
  });
});

describe("B10 staff leads", () => {
  it("lists enquiries for staff only, newest first, filtered by status", async () => {
    const s = setup();
    for (const [src, name] of [["app-chat", "Ravi"], ["web-chat", "Meena"], ["bogus", "Tom"]]) {
      await s.call(null, "POST", "/enquiries", { name, phone: "+91 98765 43210", source: src });
    }
    s.db.prepare(`UPDATE enquiry SET status='contacted' WHERE name='Ravi'`).run();
    expect((await s.call("asha", "GET", "/admin/enquiries")).status).toBe(404);
    expect((await s.call(null, "GET", "/admin/enquiries")).status).toBe(404);
    const all = await s.call("admin", "GET", "/admin/enquiries");
    expect(all.status).toBe(200);
    expect(all.json.enquiries.map((e: any) => e.source).sort()).toEqual(["app-chat", "contact-form", "web-chat"]);
    const only = await s.call("admin", "GET", "/admin/enquiries?status=contacted");
    expect(only.json.enquiries.map((e: any) => e.name)).toEqual(["Ravi"]);
  });
});
