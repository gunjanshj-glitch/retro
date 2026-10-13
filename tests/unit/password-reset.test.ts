import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";

type Reset = { email: string; expires_at: string; used_at: string | null };

/** Small stateful D1 stand-in covering just the statements the reset flow issues. */
function fakeDb(opts: { users?: Record<string, { id: string }>; resets?: Record<string, Reset>; recent?: number } = {}) {
  const users = { ...(opts.users ?? {}) };
  const resets = { ...(opts.resets ?? {}) };
  const log: { sql: string; v: unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      let v: unknown[] = [];
      const st = {
        bind(...a: unknown[]) {
          v = a;
          return st;
        },
        async first() {
          log.push({ sql, v });
          if (sql.includes("SELECT id FROM user WHERE email")) return users[v[0] as string] ?? null;
          if (sql.includes("COUNT(*)")) return { n: opts.recent ?? 0 };
          if (sql.includes("FROM password_reset WHERE token_hash")) {
            const r = resets[v[1 - 1] as string];
            return r && !r.used_at && r.expires_at > (v[1] as string) ? { email: r.email } : null;
          }
          if (sql.includes("SELECT id, name, email, avatar_url FROM user")) {
            const u = users[v[0] as string];
            return u ? { id: u.id, name: "N", email: v[0], avatar_url: null } : null;
          }
          return null;
        },
        async run() {
          log.push({ sql, v });
          let changes = 1;
          if (sql.startsWith("UPDATE password_reset SET used_at = ? WHERE token_hash")) {
            const r = resets[v[1] as string];
            if (!r || r.used_at) changes = 0;
            else r.used_at = v[0] as string;
          }
          if (sql.startsWith("INSERT INTO password_reset")) {
            resets[v[0] as string] = { email: v[1] as string, expires_at: v[3] as string, used_at: null };
          }
          return { success: true, meta: { changes }, results: [] };
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
      };
      return st;
    },
  };
  return { database: database as unknown as D1Database, log, resets };
}

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };
const call = (path: string, db: ReturnType<typeof fakeDb>, body: unknown) =>
  worker.fetch(
    new Request(`https://example.com/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { DB: db.database, ENVIRONMENT: "test" } as Env,
    ctx,
  );

const sent: { to: string; text: string }[] = [];
function stubMail() {
  sent.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const p = JSON.parse(String(init.body));
      sent.push({ to: p.personalizations[0].to[0].email, text: p.content[0].value });
      return new Response("{}", { status: 202 });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const tokenFrom = () => /token=([0-9a-f]{64})/.exec(sent[0].text)![1];

describe("forgot password", () => {
  it("emails the admin a link even before the account exists (first-time setup)", async () => {
    stubMail();
    const res = await call("/auth/forgot", fakeDb(), { email: "Info@retroholidays.in" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("info@retroholidays.in");
    expect(sent[0].text).toContain("https://retroholidays.in/reset-password?token=");
  });

  it("answers the same but sends nothing for unknown, non-admin addresses", async () => {
    stubMail();
    const res = await call("/auth/forgot", fakeDb(), { email: "stranger@example.com" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("stops after 3 links an hour", async () => {
    stubMail();
    await call("/auth/forgot", fakeDb({ recent: 3 }), { email: "info@retroholidays.in" });
    expect(sent).toHaveLength(0);
  });

  it("stores only a hash of the token", async () => {
    stubMail();
    const db = fakeDb();
    await call("/auth/forgot", db, { email: "info@retroholidays.in" });
    expect(Object.keys(db.resets)[0]).not.toBe(tokenFrom());
  });
});

describe("reset password", () => {
  it("creates the admin account on first use, signs in, and is single-use", async () => {
    stubMail();
    const db = fakeDb();
    await call("/auth/forgot", db, { email: "info@retroholidays.in" });
    const token = tokenFrom();

    const ok = await call("/auth/reset", db, { token, password: "correct horse" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Set-Cookie")).toContain("atlas_session=");
    expect((await ok.json()) as { admin: boolean }).toMatchObject({ admin: true });
    const insert = db.log.find((e) => e.sql.startsWith("INSERT INTO user"))!;
    expect(insert.v[3]).toBe("info@retroholidays.in");
    expect(insert.v[6]).toBeTruthy(); // password_verified_at

    expect((await call("/auth/reset", db, { token, password: "another one 1" })).status).toBe(400);
  });

  it("replaces an existing password and ends old sessions", async () => {
    stubMail();
    const db = fakeDb({ users: { "info@retroholidays.in": { id: "u1" } } });
    await call("/auth/forgot", db, { email: "info@retroholidays.in" });
    const res = await call("/auth/reset", db, { token: tokenFrom(), password: "correct horse" });
    expect(res.status).toBe(200);
    expect(db.log.some((e) => e.sql.startsWith("DELETE FROM session WHERE user_id"))).toBe(true);
    expect(db.log.some((e) => e.sql.startsWith("UPDATE user SET password_hash"))).toBe(true);
  });

  it("rejects expired, unknown and malformed tokens, and short passwords", async () => {
    const db = fakeDb({ resets: {} });
    expect((await call("/auth/reset", db, { token: "nope", password: "correct horse" })).status).toBe(400);
    expect((await call("/auth/reset", db, { token: "a".repeat(64), password: "correct horse" })).status).toBe(400);
    expect((await call("/auth/reset", db, { token: "a".repeat(64), password: "short" })).status).toBe(400);
  });

  it("blocks plain sign-up on the admin address", async () => {
    const res = await call("/auth/register", fakeDb(), { name: "X", email: "info@retroholidays.in", password: "password123" });
    expect(res.status).toBe(400);
  });
});
