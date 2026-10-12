import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPackageImages } from "@/lib/package-images";

const config = JSON.parse(readFileSync(path.join(process.cwd(), "content", "package-images.json"), "utf-8")) as {
  defaultImages: string[];
  overrides: Record<string, string[]>;
};

describe("package-images", () => {
  it("returns the exact override list for a package that has one", () => {
    const images = getPackageImages("europe", "europe-at-a-glance");
    expect(images.length).toBeGreaterThan(0);
    expect(images).toEqual(config.overrides["europe/europe-at-a-glance"]);
  });

  it("falls back to a deterministic rotation of the default pool for packages with no override", () => {
    // Every real package now has an override, so use a key that has none.
    const images = getPackageImages("testland", "no-such-package");
    expect(images.length).toBeGreaterThan(0);
    for (const src of images) {
      expect(config.defaultImages).toContain(src);
      expect(src).toMatch(/^\/packages\/placeholders\/placeholder-\d+\.webp$/);
    }
    // Deterministic: calling again for the same package returns the same images.
    expect(getPackageImages("testland", "no-such-package")).toEqual(images);
  });

  it("gives different packages a different (not always identical) image set", () => {
    const a = getPackageImages("india", "kerala");
    const b = getPackageImages("india", "goa");
    expect(a).not.toEqual(b);
  });
});
