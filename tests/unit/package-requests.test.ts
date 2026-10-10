import { describe, expect, it } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";

type Executed = { sql: string; values: unknown[] };

/** D1 stand-in that answers by query shape: a session lookup, the per-hour
 *  count, and a list; every statement is recorded. */
function fakeDb(opts: { signedIn: boolean; recentCount?: number; listRows?: Record<string, unknown>[] }) {
  const executed: Executed[] = [];
  const database = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const answer = () => {
        executed.push({ sql, values: bound });
        if (sql.includes("FROM session")) {
          return opts.signedIn ? { id: "u1", name: "Asha", email: "asha@example.com", avatar_url: null } : null;
        }
        if (sql.includes("COUNT(*)")) return { n: opts.recentCount ?? 0 };
        return null;
      };
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async run() {
          executed.push({ sql, values: bound });
          return { results: [], success: true, meta: {} };
        },
        async first() {
          return answer();
        },
        async all() {
          executed.push({ sql, values: bound });
          return { results: opts.listRows ?? [], success: true, meta: {} };
        },
      };
      return statement;
    },
  };
  return { database: database as unknown as D1Database, executed };
}

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };

const valid = {
  destinationSlug: "europe",
  destinationName: "Europe",
  packageSlug: "western-europe",
  packageName: "Western Europe",
  package: { places: ["Paris", "Rome"], days: 9, priceFromInr: 150000 },
  tripType: "family",
  adults: 2,
  children: 1,
  startDate: "2030-01-15",
  departureCity: "DEL",
  hotelStar: "4 Star",
  includeFlights: true,
  food: "veg",
  notes: "Anniversary trip",
};

function call(method: "GET" | "POST", body: unknown, db: ReturnType<typeof fakeDb>, signedInCookie = true) {
  const env: Env = { DB: db.database, ENVIRONMENT: "test" };
  return worker.fetch(
    new Request("https://example.com/api/package-requests", {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(signedInCookie ? { Cookie: "atlas_session=tok" } : {}),
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
}

describe("package requests", () => {
  it("requires a signed-in user to create or list", async () => {
    const db = fakeDb({ signedIn: false });
    expect((await call("POST", valid, db, false)).status).toBe(401);
    expect((await call("GET", null, db, false)).status).toBe(401);
    expect(db.executed.some((e) => e.sql.includes("INSERT"))).toBe(false);
  });

  it("stores a valid request against the signed-in user", async () => {
    const db = fakeDb({ signedIn: true });
    const res = await call("POST", valid, db);
    expect(res.status).toBe(201);
    const insert = db.executed.find((e) => e.sql.includes("INSERT INTO package_request"));
    expect(insert).toBeDefined();
    expect(insert!.values).toContain("u1");
    expect(insert!.values).toContain("western-europe");
    expect(insert!.values).toContain("family");
    expect(insert!.values).toContain(1); // include_flights
  });

  it("accepts a request with no travel date", async () => {
    const db = fakeDb({ signedIn: true });
    const res = await call("POST", { ...valid, startDate: null }, db);
    expect(res.status).toBe(201);
  });

  it.each([
    ["unknown trip type", { tripType: "astronaut" }],
    ["zero adults", { adults: 0 }],
    ["fractional adults", { adults: 1.5 }],
    ["too many children", { children: 99 }],
    ["bad date", { startDate: "next summer" }],
    ["bad departure code", { departureCity: "delhi" }],
    ["unknown hotel category", { hotelStar: "9 Star" }],
    ["unknown food", { food: "air" }],
    ["bad package slug", { packageSlug: "Bad Slug!" }],
  ])("rejects %s", async (_label, patch) => {
    const db = fakeDb({ signedIn: true });
    const res = await call("POST", { ...valid, ...patch }, db);
    expect(res.status).toBe(400);
    expect(db.executed.some((e) => e.sql.includes("INSERT"))).toBe(false);
  });

  it("rate-limits a burst from one account", async () => {
    const db = fakeDb({ signedIn: true, recentCount: 10 });
    const res = await call("POST", valid, db);
    expect(res.status).toBe(429);
    expect(db.executed.some((e) => e.sql.includes("INSERT"))).toBe(false);
  });

  it("lists only the caller's requests, with the quote once given", async () => {
    const db = fakeDb({
      signedIn: true,
      listRows: [
        {
          id: "r1", created_at: "2030-01-01T00:00:00Z", status: "quoted", destination_name: "Europe",
          destination_slug: "europe", package_name: "Western Europe", package_slug: "western-europe",
          trip_type: "family", adults: 2, children: 1, start_date: null, departure_city: "DEL",
          hotel_star: "4 Star", include_flights: 1, quoted_amount_inr: 125000, quote_note: "Flights included", quoted_at: "2030-01-02T00:00:00Z",
        },
        {
          id: "r2", created_at: "2029-12-01T00:00:00Z", status: "pending", destination_name: "Europe",
          destination_slug: "europe", package_name: "Western Europe", package_slug: "western-europe",
          trip_type: "solo", adults: 1, children: 0, start_date: "2030-03-01", departure_city: "BOM",
          hotel_star: "3 Star", include_flights: 0, quoted_amount_inr: null, quote_note: null, quoted_at: null,
        },
      ],
    });
    const res = await call("GET", null, db);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: { id: string; quote: unknown; includeFlights: boolean }[] };
    expect(body.requests[0].quote).toEqual({ amountInr: 125000, note: "Flights included", quotedAt: "2030-01-02T00:00:00Z" });
    expect(body.requests[0].includeFlights).toBe(true);
    expect(body.requests[1].quote).toBeNull();
    const select = db.executed.find((e) => e.sql.includes("FROM package_request"));
    expect(select!.sql).toContain("WHERE user_id = ?");
    expect(select!.values).toEqual(["u1"]);
  });
});
