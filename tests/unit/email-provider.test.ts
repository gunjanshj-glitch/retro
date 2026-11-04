import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPasswordResetEmail } from "../../workers/api/src/email";
import type { Env } from "../../workers/api/src/http";

afterEach(() => vi.restoreAllMocks());

describe("mail provider selection", () => {
  it("uses Resend when RESEND_API_KEY is set, with bearer auth and a flat payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await sendPasswordResetEmail({ RESEND_API_KEY: "re_x", MAIL_FROM: "no-reply@retroholidays.in" } as Env, "a@b.com", "https://x/reset?token=t");
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_x");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["a@b.com"]);
    expect(body.from).toBe("Retro Holidays <no-reply@retroholidays.in>");
    expect(body.text).toContain("https://x/reset?token=t");
  });

  it("reports failure when Resend rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("domain not verified", { status: 403 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendPasswordResetEmail({ RESEND_API_KEY: "re_x" } as Env, "a@b.com", "https://x")).toBe(false);
  });

  it("falls back to MailChannels without a Resend key", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await sendPasswordResetEmail({ MAILCHANNELS_API_KEY: "k" } as Env, "a@b.com", "https://x");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("mailchannels");
  });
});
