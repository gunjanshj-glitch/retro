import { describe, it, expect } from "vitest";
import { statSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Checks every place that actually has media under public/media, rather than a
// hand-kept slug list that drifts from the folders.
const MEDIA_ROOT = path.join("public", "media");
const SLUGS = readdirSync(MEDIA_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

// Ceilings, set just above the largest current files (paris: 655KB landscape /
// 465KB portrait clip, budapest: 361KB poster). They stop things getting
// heavier; they are not targets. Re-encode and tighten when media is optimised.
const CLIP_BUDGET_BYTES = 700 * 1024;
const PORTRAIT_CLIP_BUDGET_BYTES = 500 * 1024;
const POSTER_BUDGET_BYTES = 400 * 1024;

describe("media budget", () => {
  it("has at least one place with media", () => {
    expect(SLUGS.length).toBeGreaterThan(0);
  });

  it.each(SLUGS)("%s: landscape av1 clip is under 700KB", (slug) => {
    const p = path.join(MEDIA_ROOT, slug, "clip.av1.webm");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeLessThan(CLIP_BUDGET_BYTES);
  });

  it.each(SLUGS)("%s: portrait av1 clip is under 500KB", (slug) => {
    const p = path.join(MEDIA_ROOT, slug, "clip-portrait.av1.webm");
    expect(statSync(p).size).toBeLessThan(PORTRAIT_CLIP_BUDGET_BYTES);
  });

  it.each(SLUGS)("%s: poster is under 400KB", (slug) => {
    const p = path.join(MEDIA_ROOT, slug, "poster.webp");
    expect(statSync(p).size).toBeLessThan(POSTER_BUDGET_BYTES);
  });
});
