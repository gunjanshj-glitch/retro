import { describe, expect, it, vi } from "vitest";

vi.mock("@/content/place-photos.json", () => ({
  default: {
    "east-asia/seoul": { src: "/places/east-asia/seoul.webp", illustration: true },
    "europe/glasgow": { src: "/places/europe/glasgow.webp", credit: "A. Person", license: "CC BY 4.0", source: "https://commons.wikimedia.org/x" },
  },
}));

const { getPlaceInfo } = await import("@/lib/place-images");

describe("AI-generated place pictures", () => {
  it("are flagged as illustrations and carry no photo credit", () => {
    const info = getPlaceInfo("east-asia", "Seoul");
    expect(info.image).toBe("/places/east-asia/seoul.webp");
    expect(info.illustration).toBe(true);
    expect(info.credit).toBeUndefined();
  });

  it("real photos keep their credit and are not flagged", () => {
    const info = getPlaceInfo("europe", "Glasgow");
    expect(info.illustration).toBeUndefined();
    expect(info.credit).toContain("A. Person");
  });
});
