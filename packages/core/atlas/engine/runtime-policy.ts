/**
 * Lets an installed app take the latest commercial policy from the backend instead of the copy compiled
 * into the app. The engine reads these two JSON files as module-level constants, so the new values are
 * written INTO those same objects. Call this before the engine module is first evaluated; the web never
 * calls it and keeps the build-time values.
 */
import policy from "../../../../content/quote-policy.json";
import calibration from "../../../../content/pricing-calibration.json";
import { overwriteInPlace } from "../../catalogue";

export function applyRuntimePolicy(next: { policy?: unknown; calibration?: unknown }): void {
  const ok = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (ok(next.policy)) overwriteInPlace(policy as unknown as Record<string, unknown>, next.policy);
  if (ok(next.calibration)) overwriteInPlace(calibration as unknown as Record<string, unknown>, next.calibration);
}
