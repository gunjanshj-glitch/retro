import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { PackageCard } from "@/lib/atlas/client";

const cards: PackageCard[] = [1, 2].map((id) => ({
  id,
  slug: `pkg-${id}`,
  name: `Package ${id}`,
  destinationSlug: "testland",
  coverImage: `/packages/placeholders/placeholder-${id}.webp`,
  tagline: "",
  nights: 5,
  days: 6,
  priceFromInr: 0,
  priceIncludesFlight: true,
})) as unknown as PackageCard[];

vi.mock("@/lib/atlas/client", () => ({ loadPackageCards: () => Promise.resolve(cards) }));
const reduced = vi.fn(() => false);
vi.mock("@/lib/reduced-motion", () => ({ usePrefersReducedMotion: () => reduced() }));

import { PackageBrowseRail } from "@/components/plan/PackageBrowseRail";

describe("PackageBrowseRail", () => {
  beforeEach(() => {
    reduced.mockReturnValue(false);
    Element.prototype.scrollBy = vi.fn() as never;
  });

  it("shows left and right scroll buttons while auto-scrolling", async () => {
    render(<PackageBrowseRail />);
    expect(await screen.findByRole("button", { name: "Scroll packages left" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll packages right" })).toBeInTheDocument();
  });

  it("hands over to a manual row (one copy of each card) when an arrow is used", async () => {
    render(<PackageBrowseRail />);
    fireEvent.click(await screen.findByRole("button", { name: "Scroll packages right" }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Package 1/ })).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Scroll packages left" })).toBeInTheDocument();
  });

  it("keeps the arrows for reduced-motion users", async () => {
    reduced.mockReturnValue(true);
    render(<PackageBrowseRail />);
    expect(await screen.findByRole("button", { name: "Scroll packages right" })).toBeInTheDocument();
  });
});
