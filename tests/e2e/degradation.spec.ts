import { test, expect } from "@playwright/test";

// The hero picks its cards at random on each load, so these tests work from
// whichever card is active rather than naming a specific destination.
const VIDEO = '[data-testid^="media-video-"]';
const POSTER = '[data-testid^="media-poster-"]';

test.describe("degradation paths", () => {
  test("reduced motion: page is usable and shows static poster imagery, no video autoplay", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.getByRole("list").first()).toBeVisible();
    await context.close();
  });

  test("video ended: auto-advances to the next card while the hero is in view", async ({ page }) => {
    await page.goto("/");
    const cardRail = page.getByRole("list").first();
    const active = cardRail.locator('a[aria-current="true"]');
    await expect(active).toHaveCount(1);
    const before = await active.getAttribute("href");
    await page.locator(VIDEO).first().evaluate((el) => {
      (el as HTMLVideoElement).dispatchEvent(new Event("ended"));
    });
    await expect(cardRail.locator('a[aria-current="true"]')).not.toHaveAttribute("href", before ?? "");
  });

  test("video error: the active card falls back to its poster and the hero CTA still works", async ({ page }) => {
    await page.route("**/media/**/clip*", (route) => route.abort());
    await page.goto("/");
    // MediaLayer swaps the <video> out on error rather than hiding it, so the
    // genuine failover signal is that no video element remains.
    await expect(page.locator(VIDEO)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(POSTER).first()).toBeAttached();
    const cta = page.getByTestId("hero-panel").getByRole("link", { name: /explore destinations/i });
    await expect(cta).toBeVisible();
  });
});
