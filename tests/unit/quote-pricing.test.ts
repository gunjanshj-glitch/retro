import { describe, expect, it } from "vitest";
import {
  buildPublicQuote,
  componentBreakdown,
  emptyAdjustments,
  nextPaymentInr,
  parseAdjustments,
  priceQuote,
} from "@/lib/quote-pricing";
import { fakeQuotation } from "../helpers/quotation";

describe("priceQuote", () => {
  it("is the engine total when nothing is adjusted", () => {
    expect(priceQuote(100_000, emptyAdjustments())).toMatchObject({ packageInr: 100_000, totalInr: 100_000, dueNowInr: 100_000 });
  });

  it("applies a pinned package price, discounts and mandatory charges", () => {
    const adj = parseAdjustments({
      fixedPackageInr: 90_000,
      lines: [
        { id: "disc", label: "Early-bird discount", amountInr: -5_000, optional: false },
        { id: "fee", label: "Private transfer upgrade", amountInr: 2_000, optional: false },
      ],
    });
    expect(adj.ok).toBe(true);
    if (adj.ok) expect(priceQuote(100_000, adj.value).totalInr).toBe(87_000);
  });

  it("prices only the optional extras that were ticked, and ignores unknown ids", () => {
    const adj = parseAdjustments({ lines: [{ id: "spa", label: "Spa day", amountInr: 4_000, optional: true }, { id: "bal", label: "Balloon ride", amountInr: 9_000, optional: true }] });
    if (!adj.ok) throw new Error(adj.error);
    expect(priceQuote(100_000, adj.value, []).totalInr).toBe(100_000);
    expect(priceQuote(100_000, adj.value, ["spa"]).totalInr).toBe(104_000);
    expect(priceQuote(100_000, adj.value, ["spa", "nope"]).totalInr).toBe(104_000);
  });

  it("asks for the deposit first when one is set below the total", () => {
    const adj = parseAdjustments({ depositInr: 25_000 });
    if (!adj.ok) throw new Error(adj.error);
    expect(priceQuote(100_000, adj.value).dueNowInr).toBe(25_000);
  });
});

describe("parseAdjustments", () => {
  it("rejects a discount offered as an optional extra", () => {
    expect(parseAdjustments({ lines: [{ id: "x", label: "Off", amountInr: -1, optional: true }] }).ok).toBe(false);
  });
  it("rejects zero, non-numeric and duplicate lines", () => {
    expect(parseAdjustments({ lines: [{ id: "a", label: "Zero", amountInr: 0, optional: false }] }).ok).toBe(false);
    expect(parseAdjustments({ lines: [{ id: "a", label: "Bad", amountInr: "5", optional: false }] }).ok).toBe(false);
    const dup = { id: "a", label: "A", amountInr: 5, optional: false };
    expect(parseAdjustments({ lines: [dup, dup] }).ok).toBe(false);
  });
  it("rejects a non-positive pinned price or deposit", () => {
    expect(parseAdjustments({ fixedPackageInr: 0 }).ok).toBe(false);
    expect(parseAdjustments({ depositInr: -5 }).ok).toBe(false);
  });
});

describe("nextPaymentInr", () => {
  it("takes the deposit first, then the balance", () => {
    expect(nextPaymentInr(100_000, 0, 25_000)).toBe(25_000);
    expect(nextPaymentInr(100_000, 25_000, 25_000)).toBe(75_000);
    expect(nextPaymentInr(100_000, 100_000, 25_000)).toBe(0);
  });
  it("takes everything when there is no deposit or it is not smaller than the total", () => {
    expect(nextPaymentInr(100_000, 0, null)).toBe(100_000);
    expect(nextPaymentInr(100_000, 0, 100_000)).toBe(100_000);
  });
});

describe("componentBreakdown", () => {
  it("always sums to the package price, folding margin into categories", () => {
    for (const pinned of [100_000, 85_000, 120_500]) {
      const rows = componentBreakdown(fakeQuotation(), pinned);
      expect(rows.reduce((s, r) => s + r.amountInr, 0)).toBe(pinned);
      expect(rows.every((r) => r.amountInr > 0)).toBe(true);
    }
  });
});

describe("buildPublicQuote", () => {
  it("leaves out engine internals", () => {
    const view = buildPublicQuote(fakeQuotation(), emptyAdjustments(), { validUntil: "2030-01-01T00:00:00.000Z", note: null });
    const text = JSON.stringify(view);
    expect(text).not.toContain("internal margin note");
    expect(text).not.toContain("agentMarkup");
    expect(text).not.toContain("flooredToPackage");
    expect(view.title).toBe("Paris · Rome");
    expect(view.nights).toBe(5);
  });
});
