import { describe, expect, it } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";

/** D1 stand-in: one live session ("good") for one user; everything else misses. */
function db(email = "t@example.com") {
  const mk = (sql: string) => {
    let v: unknown[] = [];
    const st = {
      bind(...a: unknown[]) {
        v = a;
        return st;
      },
      async first() {
        if (sql.includes("FROM session s JOIN user u") && v[0] === "good")
          return { id: "u1", name: "T", email, avatar_url: null, auth_provider: null, password_hash: "x", password_verified_at: "2026-01-01" };
        return null;
      },
      async run() {
        return { success: true, meta: { changes: 1 }, results: [] };
      },
      async all() {
        return { results: [], success: true, meta: {} };
      },
    };
    return st;
  };
  return { prepare: mk } as unknown as D1Database;
}
const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
const env = (email?: string, admins = ""): Env => ({ DB: db(email), ADMIN_EMAILS: admins }) as unknown as Env;
const get = (path: string, headers: Record<string, string>, e: Env) =>
  worker.fetch(new Request(`https://example.com/api${path}`, { headers }), e, ctx);

describe("session via cookie or bearer", () => {
  it("cookie still works", async () => {
    const r = await get("/auth/me", { Cookie: "atlas_session=good" }, env());
    expect((await r.json()) as { user: { id: string } }).toMatchObject({ user: { id: "u1" } });
  });
  it("bearer works", async () => {
    const r = await get("/auth/me", { Authorization: "Bearer good" }, env());
    expect((await r.json()) as { user: { id: string } }).toMatchObject({ user: { id: "u1" } });
  });
  it("unknown bearer is signed out", async () => {
    const r = await get("/auth/me", { Authorization: "Bearer nope" }, env());
    expect(await r.json()).toEqual({ user: null });
  });
  it("non-staff bearer gets 404 on /admin", async () => {
    const r = await get("/admin/requests", { Authorization: "Bearer good" }, env());
    expect(r.status).toBe(404);
  });
  it("staff bearer reaches /admin", async () => {
    const r = await get("/admin/requests", { Authorization: "Bearer good" }, env("t@example.com", "t@example.com"));
    expect(r.status).toBe(200);
  });
});
