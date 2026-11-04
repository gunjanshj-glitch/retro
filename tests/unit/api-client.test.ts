import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "@retro/api-client";

function setup(respond: (url: string, init: RequestInit) => Response | Promise<Response>, token: string | null = "tok") {
  const calls: { url: string; init: RequestInit }[] = [];
  const onUnauthorised = vi.fn();
  const api = createClient({
    baseUrl: "https://x.test/api/v1",
    getToken: () => token,
    onUnauthorised,
    newKey: () => "key-1",
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as unknown as typeof fetch,
  });
  return { api, calls, onUnauthorised };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const hdr = (c: { init: RequestInit }) => c.init.headers as Record<string, string>;

describe("api-client", () => {
  it("marks every call as the app and sends the bearer token", async () => {
    const { api, calls } = setup(() => ok({ requests: [] }));
    await api.requests.list();
    expect(hdr(calls[0])["X-Client"]).toBe("mobile");
    expect(hdr(calls[0]).Authorization).toBe("Bearer tok");
  });

  it("sends no Authorization on public calls and none when signed out", async () => {
    const { api, calls } = setup(() => ok({ user: { id: "u" }, token: "t" }));
    await api.auth.login("a@b.com", "pw");
    expect(hdr(calls[0]).Authorization).toBeUndefined();
    const out = setup(() => ok({ user: null }), null);
    await out.api.auth.me();
    expect(hdr(out.calls[0]).Authorization).toBeUndefined();
  });

  it("carries the idempotency key on creates and sends", async () => {
    const { api, calls } = setup(() => ok({ ok: true }));
    await api.requests.message("r1", "hello", api.key());
    expect(hdr(calls[0])["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: "hello" });
  });

  it("uses the field names the Worker reads", async () => {
    const { api, calls } = setup(() => ok({ ok: true }));
    await api.auth.exchange("c", "v");
    await api.devices.register("ExponentPushToken[abc]", "ios", "1.0.0");
    await api.requests.accept("r", "rev", ["o1"], "k");
    const bodies = calls.map((c) => JSON.parse(c.init.body as string));
    expect(bodies[0]).toEqual({ code: "c", code_verifier: "v" });
    expect(bodies[1]).toEqual({ expoPushToken: "ExponentPushToken[abc]", platform: "ios", appVersion: "1.0.0" });
    expect(bodies[2]).toEqual({ revisionId: "rev", optionIds: ["o1"], agreed: true });
  });

  it("maps errors to ApiError with the machine code and signs out on 401", async () => {
    const { api, onUnauthorised } = setup(() => ok({ error: "Sign in required.", code: "UNAUTHORISED" }, 401));
    const err = await api.requests.list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORISED");
    expect(onUnauthorised).toHaveBeenCalledOnce();
  });

  it("does not sign out on a 401 from a call that sent no token (wrong password)", async () => {
    const { api, onUnauthorised } = setup(() => ok({ error: "Incorrect email or password." }, 401), null);
    await api.auth.login("a@b.com", "x").catch(() => {});
    expect(onUnauthorised).not.toHaveBeenCalled();
  });

  it("turns a network failure into a NETWORK error", async () => {
    const { api } = setup(() => { throw new TypeError("fail"); });
    const err = await api.requests.list().catch((e) => e);
    expect(err.isNetwork).toBe(true);
  });

  it("passes platform and version to /app-config as a query", async () => {
    const { api, calls } = setup(() => ok({}));
    await api.config("ios", "1.2.3");
    expect(calls[0].url).toBe("https://x.test/api/v1/app-config?platform=ios&version=1.2.3");
  });
});
