import { afterEach, describe, expect, it, vi } from "vitest";
import { daysLeft, daysLeftLabel } from "@/components/my-requests/status";
import { canTransition, normalisePhone, isFinished } from "@/lib/quote-workflow";

describe("daysLeft", () => {
  afterEach(() => vi.useRealTimers());

  it("counts calendar days in India time, so a quote open until the 4th has 7 days left on the 28th", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T17:48:00Z")); // 23:18 IST on the 28th
    expect(daysLeft("2026-11-04T18:29:59.000Z")).toBe(7);
    expect(daysLeftLabel(7)).toBe("7 days left");
  });

  it("says last day on the final day, and null once lapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T05:00:00Z"));
    expect(daysLeft("2026-11-04T18:29:59.000Z")).toBe(0);
    expect(daysLeftLabel(0)).toBe("last day");
    vi.setSystemTime(new Date("2026-11-04T18:30:00Z"));
    expect(daysLeft("2026-11-04T18:29:59.000Z")).toBeNull();
  });
});

describe("workflow rules", () => {
  it("allows the intended path and blocks shortcuts", () => {
    expect(canTransition("pending", "in_review")).toBe(true);
    expect(canTransition("quoted", "accepted")).toBe(true);
    expect(canTransition("pending", "paid")).toBe(false);
    expect(canTransition("part_paid", "quoted")).toBe(false);
    expect(isFinished("paid")).toBe(true);
  });
  it("validates optional phone numbers", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("+91 98765 43210")).toBe("+91 98765 43210");
    expect(normalisePhone("call me")).toBeNull();
  });
});
