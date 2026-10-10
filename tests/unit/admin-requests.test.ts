import { describe, expect, it } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";

type User = { email: string; auth_provider: string | null; password_hash: string | null };

function fakeDb(user: User | null, changes = 1) {
  const executed: { sql: string; values: unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const st = {
        bind(...v: unknown[]) {
          bound = v;
          return st;
        },
        async first() {
          executed.push({ sql, values: bound });
          return user ? { id: "a1", ...user } : null;
        },
        async run() {
          executed.push({ sql, values: bound });
          return { success: true, meta: { changes }, results: [] };
        },
        async all() {
          executed.push({ sql, values: bound });
          return { results: [], success: true, meta: {} };
        },
      };
      return st;
    },
  };
  return { database: database as unknown as D1Database, executed };
}

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
const google: User = { email: "info@retroholidays.in", auth_provider: "google", password_hash: null };

function call(method: string, path: string, db: ReturnType<typeof fakeDb>, body?: unknown, env: Partial<Env> = {}) {
  return worker.fetch(
    new Request(`https://example.com/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: "atlas_session=tok" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db.database, ENVIRONMENT: "test", ...env },
    ctx,
  );
}

describe("admin package requests", () => {
  it("lets the Google-signed-in admin list requests", async () => {
    expect((await call("GET", "/admin/package-requests", fakeDb(google))).status).toBe(200);
  });

  it.each([
    ["signed out", null],
    ["a different email", { ...google, email: "someone@example.com" }],
    ["a password account squatting the admin email", { ...google, auth_provider: null, password_hash: "x" }],
    ["a Google account that also has a password", { ...google, password_hash: "x" }],
  ])("hides the routes from %s", async (_name, user) => {
    const db = fakeDb(user as User | null);
    expect((await call("GET", "/admin/package-requests", db)).status).toBe(404);
    expect((await call("POST", "/admin/package-requests/r1/quote", db, { amountInr: 5 })).status).toBe(404);
    expect(db.executed.some((e) => e.sql.includes("UPDATE package_request"))).toBe(false);
  });

  it("honours ADMIN_EMAILS", async () => {
    const db = fakeDb({ ...google, email: "boss@retroholidays.in" });
    expect((await call("GET", "/admin/package-requests", db, undefined, { ADMIN_EMAILS: "Boss@retroholidays.in" })).status).toBe(200);
  });

  it("writes a quote onto the request", async () => {
    const db = fakeDb(google);
    const res = await call("POST", "/admin/package-requests/r1/quote", db, { amountInr: 345000.4, note: " incl. visas " });
    expect(res.status).toBe(200);
    const update = db.executed.find((e) => e.sql.includes("UPDATE package_request"))!;
    expect(update.sql).toContain("status = 'quoted'");
    expect(update.values[0]).toBe(345000);
    expect(update.values[1]).toBe("incl. visas");
    expect(update.values[3]).toBe("r1");
  });

  it.each([[0], [-5], ["100"], [1e12]])("rejects quote amount %s", async (amountInr) => {
    const db = fakeDb(google);
    expect((await call("POST", "/admin/package-requests/r1/quote", db, { amountInr })).status).toBe(400);
  });

  it("404s for an unknown request id and closes a known one", async () => {
    expect((await call("POST", "/admin/package-requests/nope/quote", fakeDb(google, 0), { amountInr: 10 })).status).toBe(404);
    const db = fakeDb(google);
    expect((await call("POST", "/admin/package-requests/r1/close", db)).status).toBe(200);
    expect(db.executed.some((e) => e.sql.includes("status = 'closed'"))).toBe(true);
  });
});
