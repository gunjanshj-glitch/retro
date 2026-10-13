import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";

type Q = { sql: string; values: unknown[] };

function fakeDb(opts: { state?: Record<string, unknown> | null; existingByProvider?: boolean } = {}) {
  const executed: Q[] = [];
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
          if (sql.includes("FROM oauth_state")) return opts.state ?? null;
          if (sql.includes("provider_id = ?")) return opts.existingByProvider ? { id: "u9" } : null;
          return null;
        },
        async run() {
          executed.push({ sql, values: bound });
          return { success: true, meta: {}, results: [] };
        },
      };
      return st;
    },
  };
  return { database: database as unknown as D1Database, executed };
}

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
const env = (db: D1Database, extra: Partial<Env> = {}): Env => ({
  DB: db,
  ENVIRONMENT: "test",
  PUBLIC_SITE_URL: "https://retroholidays.in",
  X_CLIENT_ID: "xid",
  X_CLIENT_SECRET: "xsecret",
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("Continue with X", () => {
  it("reports availability only when configured", async () => {
    const db = fakeDb();
    const on = await worker.fetch(new Request("https://e.com/api/auth/providers"), env(db.database), ctx);
    expect(((await on.json()) as { x: boolean }).x).toBe(true);
    const off = await worker.fetch(
      new Request("https://e.com/api/auth/providers"),
      env(db.database, { X_CLIENT_ID: undefined }),
      ctx,
    );
    expect(((await off.json()) as { x: boolean }).x).toBe(false);
  });

  it("starts with PKCE and stores the verifier", async () => {
    const db = fakeDb();
    const res = await worker.fetch(new Request("https://e.com/api/auth/x/start?redirect=/plan"), env(db.database), ctx);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toBeTruthy();
    expect(loc.searchParams.get("scope")).toContain("users.email");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://retroholidays.in/api/auth/x/callback");
    const insert = db.executed.find((q) => q.sql.includes("INSERT INTO oauth_state"))!;
    expect(insert.values[4]).toBeTruthy(); // verifier
    expect(insert.values[4]).not.toBe(loc.searchParams.get("code_challenge"));
  });

  function callback(db: ReturnType<typeof fakeDb>, email?: string) {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("oauth2/token")
        ? new Response(JSON.stringify({ access_token: "t" }))
        : new Response(JSON.stringify({ data: { id: "777", name: "Asha", username: "asha", confirmed_email: email } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    return {
      fetchMock,
      res: worker.fetch(new Request("https://e.com/api/auth/x/callback?code=c&state=s"), env(db.database), ctx),
    };
  }
  const goodState = { provider: "x", created_at: new Date().toISOString(), redirect_to: "/plan", code_verifier: "ver" };

  it("exchanges the code with Basic auth + verifier and creates an account", async () => {
    const db = fakeDb({ state: goodState });
    const { res, fetchMock } = callback(db, "asha@example.com");
    const r = await res;
    expect(r.status).toBe(302);
    expect(r.headers.get("Set-Cookie")).toContain("atlas_session=");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("xid:xsecret")}`);
    expect(String(init.body)).toContain("code_verifier=ver");
    const insert = db.executed.find((q) => q.sql.includes("INSERT INTO user"))!;
    expect(insert.values).toContain("asha@example.com");
    expect(insert.values).toContain("x");
  });

  it("falls back to a placeholder email and never merges by email when X shares none", async () => {
    const db = fakeDb({ state: goodState });
    const r = await callback(db).res;
    expect(r.status).toBe(302);
    expect(db.executed.some((q) => q.sql.includes("WHERE email = ?"))).toBe(false);
    const insert = db.executed.find((q) => q.sql.includes("INSERT INTO user"))!;
    expect(insert.values).toContain("777@x.users.noreply.retroholidays.in");
  });

  it("rejects an expired or unknown state", async () => {
    const r = await callback(fakeDb({ state: null }), "a@b.com").res;
    expect(r.status).toBe(400);
  });
});
