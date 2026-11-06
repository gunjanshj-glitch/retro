import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };

function kv() {
  const store = new Map<string, string>();
  return {
    store,
    ns: {
      async get(k: string, type?: string) {
        const v = store.get(k);
        return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
      },
      async put(k: string, v: string) {
        store.set(k, v);
      },
    } as unknown as KVNamespace,
  };
}

const call = (env: Partial<Env>) =>
  worker.fetch(new Request("https://example.com/api/google-reviews"), { ENVIRONMENT: "test", ...env } as Env, ctx);

afterEach(() => vi.restoreAllMocks());

describe("GET /api/google-reviews", () => {
  it("is unavailable without a key, and never calls Google", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const body = await (await call({})).json();
    expect(body).toEqual({ available: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the live rating and count and keeps the key server-side", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ rating: 4.9, userRatingCount: 91, reviews: [] }), { status: 200 }),
    );
    const res = await call({ GOOGLE_PLACES_API_KEY: "secret-key" });
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ available: true, rating: 4.9, total: 91 });
    expect(text).not.toContain("secret-key");
    expect(String(spy.mock.calls[0][0])).toContain("places.googleapis.com/v1/places/");
  });

  it("serves the cached value for an hour instead of re-asking Google", async () => {
    const { ns } = kv();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ rating: 4.8, userRatingCount: 92 }), { status: 200 }),
    );
    const e = { GOOGLE_PLACES_API_KEY: "k", RATE_CACHE: ns };
    await call(e);
    const second = await (await call(e)).json();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ rating: 4.8, total: 92 });
  });

  it("falls back to the last good value when Google fails after the cache expired", async () => {
    const { ns, store } = kv();
    store.set(
      "google-reviews:v1",
      JSON.stringify({ available: true, rating: 4.9, total: 90, reviews: [], fetchedAt: "2020-01-01T00:00:00Z" }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const body = await (await call({ GOOGLE_PLACES_API_KEY: "k", RATE_CACHE: ns })).json();
    expect(body).toMatchObject({ available: true, total: 90 });
  });
});
