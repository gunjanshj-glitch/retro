import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteRequest } from "@/lib/atlas/engine/types";

const generate = vi.fn((request: QuoteRequest) => ({ totals: { total: request.placeIds.length * 1000 }, stays: [], pax: { rooms: 1 } }));
let release: (() => void) | null = null;

vi.mock("@/lib/atlas/engine", () => ({ generateQuotation: (...a: [QuoteRequest]) => generate(...a) }));
vi.mock("@/lib/atlas/client", () => ({
  loadCore: async () => ({ places: [{ id: "a", slug: "a" }, { id: "b", slug: "b" }] }),
  loadRoutes: async () => [],
  loadVisaRules: async () => [],
  loadHotelLiveRates: async () => new Map(),
  // Destination data arrives only when the test releases it.
  loadDestinations: (slugs: string[]) =>
    new Promise((resolve) => {
      release = () => resolve(new Map(slugs.map((s) => [s, { place: { id: s } }])));
    }),
}));

import { useQuotation } from "@/lib/atlas/use-quotation";

const req = (placeIds: string[]) => ({ placeIds }) as unknown as QuoteRequest;

describe("useQuotation", () => {
  beforeEach(() => {
    generate.mockClear();
    release = null;
  });

  it("does not price a trip until its destination data has loaded", async () => {
    const { result } = renderHook(() => useQuotation(req(["a"])));
    await waitFor(() => expect(result.current.core).not.toBeNull());
    await waitFor(() => expect(release).not.toBeNull());

    // Core is ready but the places are not: a price now would be a low, plausible-looking number.
    expect(result.current.quote).toBeNull();
    expect(generate).not.toHaveBeenCalled();

    await act(async () => release!());
    await waitFor(() => expect(result.current.quote).not.toBeNull());
  });

  it("does not wait again when a destination is removed", async () => {
    let ids = ["a", "b"];
    const { result, rerender } = renderHook(() => useQuotation(req(ids)));
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => release!());
    await waitFor(() => expect(result.current.quote?.totals.total).toBe(2000));

    ids = ["a"];
    release = null;
    rerender();
    expect(result.current.quote?.totals.total).toBe(1000);
  });
});
