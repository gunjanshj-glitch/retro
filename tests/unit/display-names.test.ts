import { describe, expect, it } from "vitest";
import { displayName, fixSpelling } from "@/lib/display-names";

describe("display names", () => {
  it("corrects known misspellings of a name", () => {
    expect(displayName("Hungery")).toBe("Hungary");
    expect(displayName("Czech")).toBe("Czechia");
  });

  it("leaves real places that only look misspelled alone", () => {
    // Chamouny is a village in Mauritius, not a spelling of Chamonix.
    expect(displayName("Chamouny")).toBe("Chamouny");
  });

  it("fixes whole words in text without mangling longer names", () => {
    expect(fixSpelling("Budapest, Hungery and Seol")).toBe("Budapest, Hungary and Seoul");
    expect(fixSpelling("Prague, Czech Republic")).toBe("Prague, Czech Republic");
  });
});
