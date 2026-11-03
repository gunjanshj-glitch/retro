import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "workers/api/src");

describe("session credential is read in exactly one place", () => {
  it("only auth.ts (readSessionToken) and http.ts (cookie helpers) touch the session cookie", () => {
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "http.ts" && f !== "auth.ts")
      .filter((f) => /parseCookies|SESSION_COOKIE|atlas_session/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
