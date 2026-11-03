/**
 * `GET /app-config?platform=ios&version=1.0.3` (B5).
 *
 * The safety net that lets the backend change without stranding installed
 * apps: below `minVersion` the app shows a blocking "please update" screen, and
 * `maintenance` lets us switch the app to a holding page without a release.
 * Everything is driven by optional environment variables so a change is a
 * config edit, not a deploy of app code.
 */
import type { Env } from "./http";
import { json } from "./http";

/** Compares dotted numeric versions. Non-numeric parts read as 0, so junk never throws. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}$/;

function flagsOf(env: Env): Record<string, boolean> {
  // "chat=1,apple=0" → { chat: true, apple: false }
  const out: Record<string, boolean> = {};
  for (const part of (env.APP_FLAGS ?? "").split(",")) {
    const [key, value] = part.split("=").map((s) => s.trim());
    if (key && /^[a-z][a-z0-9_]{0,31}$/i.test(key)) out[key] = value === "1" || value === "true";
  }
  return out;
}

export function handleAppConfig(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") === "android" ? "android" : "ios";
  const raw = url.searchParams.get("version") ?? "";
  const version = VERSION_RE.test(raw) ? raw : null;

  const minVersion = VERSION_RE.test(env.APP_MIN_VERSION ?? "") ? (env.APP_MIN_VERSION as string) : "1.0.0";
  const latestVersion = VERSION_RE.test(env.APP_LATEST_VERSION ?? "") ? (env.APP_LATEST_VERSION as string) : minVersion;
  const maintenance = env.APP_MAINTENANCE === "1" || env.APP_MAINTENANCE === "true";

  return json(
    {
      platform,
      minVersion,
      latestVersion,
      // Computed here too, so a client never has to get version comparison right.
      // An unreadable version is not blocked: failing open beats locking out a working app.
      updateRequired: version ? compareVersions(version, minVersion) < 0 : false,
      updateAvailable: version ? compareVersions(version, latestVersion) < 0 : false,
      maintenance,
      maintenanceMessage: maintenance ? (env.APP_MAINTENANCE_MESSAGE ?? "We are making improvements and will be back shortly.").slice(0, 300) : null,
      whatsapp: "916290855027",
      phone: "+916290855027",
      flags: flagsOf(env),
      catalogueVersion: env.CATALOGUE_VERSION ?? null,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
