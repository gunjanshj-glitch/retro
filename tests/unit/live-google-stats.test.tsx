import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

describe("LiveGoogleStats", () => {
  it("paints the build-time figures, then swaps in the live ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: true, rating: 4.8, total: 120 }))),
    );
    const { LiveGoogleStats } = await import("@/lib/live-google-reviews");
    render(<LiveGoogleStats variant="footer" initial={{ rating: "4.9", total: 77 }} />);
    expect(screen.getByText("4.9 ★ from 77 Google reviews")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("4.8 ★ from 120 Google reviews")).toBeTruthy());
    vi.unstubAllGlobals();
  });
});
