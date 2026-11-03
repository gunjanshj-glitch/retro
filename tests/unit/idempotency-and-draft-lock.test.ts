/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and DB rows are untyped JSON in these tests */
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";
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

const submit = (extra: Record<string, unknown> = {}) => ({
  request: { placeIds: ["paris", "rome"], nights: 5, startDate: "2030-01-10", adults: 2 },
  quotation: fakeQuotation(),
  destinationSummary: "Paris, Rome",
  totals: { total: 100_000, perPerson: 50_000 },
  contact: { email: "asha.work@example.com" },
  ...extra,
});
const sendBody = (over: Record<string, unknown> = {}) => ({
  request: { placeIds: ["paris", "rome"], nights: 5, startDate: "2030-01-10", adults: 2 },
  quotation: fakeQuotation(),
  adjustments: { lines: [], depositInr: null, fixedPackageInr: null },
  validUntil: null,
  note: null,
  ...over,
});
const count = (s: ReturnType<typeof setup>, table: string) => (s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n as number;

beforeEach(() => vi.unstubAllGlobals());

describe("B7 Idempotency-Key", () => {
  const K = { "Idempotency-Key": "key-0001-abcdef" };

  it("replays a retried submit: one request, one set of emails, same id", async () => {
    const s = setup();
    const a = await s.call("asha", "POST", "/requests", submit(), K);
    const mailsAfterFirst = mailCount();
    const b = await s.call("asha", "POST", "/requests", submit(), K);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.id).toBe(a.json.id);
    expect(b.headers.get("Idempotency-Replayed")).toBe("true");
    expect(count(s, "quotation_request")).toBe(1);
    expect(mailCount()).toBe(mailsAfterFirst);
  });

  it("without a key behaviour is unchanged (two submits, two requests)", async () => {
    const s = setup();
    await s.call("asha", "POST", "/requests", submit());
    await s.call("asha", "POST", "/requests", submit());
    expect(count(s, "quotation_request")).toBe(2);
  });

  it("same key with a different body is refused with 422", async () => {
    const s = setup();
    await s.call("asha", "POST", "/requests", submit(), K);
    const r = await s.call("asha", "POST", "/requests", submit({ note: "different" }), K);
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(count(s, "quotation_request")).toBe(1);
  });

  it("a failed attempt does not burn the key", async () => {
    const s = setup();
    const bad = await s.call("asha", "POST", "/requests", submit({ contact: { email: "nope" } }), K);
    expect(bad.status).toBe(400);
    const ok = await s.call("asha", "POST", "/requests", submit(), K);
    expect(ok.status).toBe(201);
    expect(count(s, "quotation_request")).toBe(1);
  });

  it("keys are per caller: another user's identical key is not a replay", async () => {
    const s = setup();
    const a = await s.call("asha", "POST", "/enquiries", { name: "A", email: "a@example.com", message: "hello there", source: "contact" }, K);
    const anon = await s.call(null, "POST", "/enquiries", { name: "A", email: "a@example.com", message: "hello there", source: "contact" }, K);
    expect(a.headers.get("Idempotency-Replayed")).toBeNull();
    expect(anon.headers.get("Idempotency-Replayed")).toBeNull();
  });

  it("a retried admin send does not create a second revision or email", async () => {
    const s = setup();
    const { json: created } = await s.call("asha", "POST", "/requests", submit());
    const id = created.id;
    const first = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody(), K);
    const mailsAfter = mailCount();
    const retry = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody(), K);
    expect(first.json.version).toBe(1);
    expect(retry.json.version).toBe(1);
    expect(count(s, "quote_revision")).toBe(1);
    expect(mailCount()).toBe(mailsAfter);
    // and the same send with a NEW key is a deliberate second revision
    const again = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody(), { "Idempotency-Key": "key-0002-abcdef" });
    expect(again.json.version).toBe(2);
  });

  it("rejects a malformed key, and is inert without KV", async () => {
    const s = setup();
    expect((await s.call("asha", "POST", "/requests", submit(), { "Idempotency-Key": "short" })).status).toBe(400);
    const noKv = setup(false);
    await noKv.call("asha", "POST", "/requests", submit(), K);
    await noKv.call("asha", "POST", "/requests", submit(), K);
    expect(count(noKv, "quotation_request")).toBe(2);
  });
});

describe("B8 draft optimistic lock", () => {
  async function withRequest() {
    const s = setup();
    const { json } = await s.call("asha", "POST", "/requests", submit());
    return { s, id: json.id as string };
  }
  const stamp = async (s: ReturnType<typeof setup>, id: string) => (await s.call("admin", "GET", `/admin/requests/${id}`)).json.workingCopy?.updatedAt as string | null;

  it("a stale draft save is refused and the colleague's work survives", async () => {
    const { s, id } = await withRequest();
    const first = await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: null, note: "A's version" }));
    expect(first.status).toBe(200);
    const aStamp = first.json.savedAt;
    // B saves on top of A's stamp
    const second = await s.call("admin2", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: aStamp, note: "B's version" }));
    expect(second.status).toBe(200);
    // A (still holding the old stamp) tries again
    const stale = await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: aStamp, note: "A overwrites" }));
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("DRAFT_CHANGED");
    expect(stale.json.draft.savedBy).toBe("two@retroholidays.in");
    const detail = await s.call("admin", "GET", `/admin/requests/${id}`);
    expect(detail.json.workingCopy.note).toBe("B's version");
  });

  it("retrying with the stamp from the 409 succeeds (the Overwrite path)", async () => {
    const { s, id } = await withRequest();
    await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: null }));
    const stale = await s.call("admin2", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: null, note: "late" }));
    expect(stale.status).toBe(409);
    const ok = await s.call("admin2", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: stale.json.draft.updatedAt, note: "late" }));
    expect(ok.status).toBe(200);
  });

  it("omitting baseUpdatedAt keeps the web editor's behaviour", async () => {
    const { s, id } = await withRequest();
    await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody());
    expect((await s.call("admin2", "POST", `/admin/requests/${id}/draft`, sendBody({ note: "x" }))).status).toBe(200);
  });

  it("send with a stale stamp is refused; with the current stamp it goes and consumes the draft", async () => {
    const { s, id } = await withRequest();
    await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: null }));
    const current = await stamp(s, id);
    expect((await s.call("admin2", "POST", `/admin/requests/${id}/send`, sendBody({ baseUpdatedAt: "2000-01-01T00:00:00.000Z" }))).status).toBe(409);
    const sent = await s.call("admin2", "POST", `/admin/requests/${id}/send`, sendBody({ baseUpdatedAt: current }));
    expect(sent.status).toBe(200);
    // a colleague still holding the old stamp can no longer send it again
    const dup = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody({ baseUpdatedAt: current }));
    expect(dup.status).toBe(409);
    expect(dup.json.draft).toBeNull();
    expect(count(s, "quote_revision")).toBe(1);
  });

  it("rejects a malformed stamp", async () => {
    const { s, id } = await withRequest();
    expect((await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody({ baseUpdatedAt: 5 }))).status).toBe(400);
  });
});
