import { describe, expect, it } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";
import { createTestDb } from "../helpers/d1";

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
const env = () => ({ DB: createTestDb().database, ENVIRONMENT: "test", ADMIN_EMAILS: "info@retroholidays.in" }) as Env;
const get = (path: string, e = env()) => worker.fetch(new Request(`https://example.com${path}`), e, ctx);

describe("API router", () => {
  it.each(["/api/health", "/api/v1/health", "/health"])("serves %s", async (p) => {
    const r = await get(p);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("versioned and unversioned paths reach the same handler (config, auth, requests)", async () => {
    for (const p of ["/app-config", "/auth/me", "/requests"]) {
      const a = await get(`/api${p}`);
      const b = await get(`/api/v1${p}`);
      expect(b.status).toBe(a.status);
    }
  });

  it("every error response carries a machine-readable code", async () => {
    const cases: [string, number, string][] = [
      ["/api/requests", 401, "AUTH_REQUIRED"],
      ["/api/nope", 404, "NOT_FOUND"],
      ["/api/quotes/missing", 404, "NOT_FOUND"],
    ];
    for (const [p, status, code] of cases) {
      const r = await get(p);
      expect(r.status).toBe(status);
      expect(((await r.json()) as { code: string }).code).toBe(code);
    }
  });

  it("a code a handler set itself is not overwritten", async () => {
    const e = env();
    const r = await worker.fetch(new Request("https://example.com/api/requests/x/pay", { method: "POST" }), e, ctx);
    expect(((await r.json()) as { code: string }).code).toBe("AUTH_REQUIRED");
  });

  it("wrong method on a public path is 405; on a staff path it stays 404 so nothing advertises itself", async () => {
    expect((await worker.fetch(new Request("https://example.com/api/enquiries"), env(), ctx)).status).toBe(405);
    expect((await worker.fetch(new Request("https://example.com/api/admin/enquiries", { method: "DELETE" }), env(), ctx)).status).toBe(404);
  });

  it("versioned idempotency still applies", async () => {
    // /v1 must be normalised before the idempotency allow-list is consulted, or retries on v1 would duplicate.
    const { normalisePath } = await import("@/workers/api/src/http");
    expect(normalisePath("https://x.test/api/v1/requests/abc/accept")).toBe("/requests/abc/accept");
  });
});
