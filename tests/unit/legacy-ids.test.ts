import { describe, expect, it } from "vitest";
import { idName, legacySlug } from "../../scripts/etl/legacy-ids";
import { slugify } from "../../scripts/etl/normalise";

describe("corrected spellings keep their old ids", () => {
  it("places keep the slug saved trips already reference", () => {
    expect(legacySlug("place", "Seoul")).toBe("seol");
    expect(legacySlug("place", "Ho Chi Minh City")).toBe("hochiminh");
    expect(legacySlug("place", "Borneo Island")).toBe("bornea-island");
  });

  it("countries keep their region-prefixed id", () => {
    expect(slugify(`europe-${idName("country", "Hungary")}`)).toBe("europe-hungery");
    expect(slugify(`south-east-asia-${idName("country", "Philippines")}`)).toBe("south-east-asia-phillipines");
  });

  it("a package that was always spelt correctly keeps its own id", () => {
    expect(idName("package", "Philippines")).toBe("Philippines");
    expect(idName("package", "Kyrgyzstan")).toBe("Kyrgisthan");
  });

  it("names never misspelt are untouched", () => {
    expect(legacySlug("place", "Glasgow")).toBe("glasgow");
  });
});
