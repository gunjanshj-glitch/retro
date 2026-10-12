import { test, expect } from "@playwright/test";

// The ten regions the site is organised into (see content/destinations).
const SLUGS = [
  "africa", "east-asia", "eurasia-cis", "europe", "india",
  "middle-east", "oceania", "russia", "south-asia", "south-east-asia",
];

test.describe("home page hero", () => {
  test("the hero CTA is visible and clickable, and navigates to the destinations page", async ({ page }) => {
    await page.goto("/");
    const heroPanel = page.getByTestId("hero-panel");
    const cta = heroPanel.getByRole("link", { name: /explore destinations/i });
    await expect(cta).toBeVisible();
    // A real click, not just toBeVisible(): Playwright's click fails if
    // another element (e.g. the background video/poster layer) intercepts
    // the pointer event at the CTA's coordinates, so this is what actually
    // proves the hero panel stacks above the media layer.
    await cta.click();
    await expect(page).toHaveURL(/\/destinations$/);
  });
});

test.describe("destination pages", () => {
  for (const slug of SLUGS) {
    test(`/destinations/${slug} renders its heading, package row and back link`, async ({ page }) => {
      await page.goto(`/destinations/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Packages in / })).toBeVisible();
      await expect(page.getByRole("link", { name: /All destinations/ })).toBeVisible();
    });
  }

  test("the hero back link is a visible, filled button", async ({ page }) => {
    await page.goto("/destinations/india");
    const back = page.getByRole("link", { name: /All destinations/ });
    await expect(back).toBeVisible();
    const bg = await back.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("plan page", () => {
  test("shows the requested destination when a valid slug is given", async ({ page }) => {
    await page.goto("/plan?destination=bali");
    await expect(page.getByText("Bali").first()).toBeVisible();
  });

  test("shows the package browser when no slug is given", async ({ page }) => {
    await page.goto("/plan");
    await expect(page.getByText("All packages").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /kashmir/i }).first()).toBeVisible();
  });

  test("falls back to the package browser when an unknown slug is given", async ({ page }) => {
    await page.goto("/plan?destination=atlantis");
    await expect(page.getByRole("link", { name: /kashmir/i }).first()).toBeVisible();
  });

  test("the All packages rail has left and right scroll buttons", async ({ page }) => {
    await page.goto("/plan");
    await expect(page.getByRole("button", { name: "Scroll packages left" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Scroll packages right" })).toBeVisible();
  });
});

test.describe("contact page", () => {
  test("renders founder, address and phone details", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByText(/9804786498|98047 86498/).first()).toBeVisible();
    await expect(page.getByText(/Kolkata/).first()).toBeVisible();
  });

  test("the enquiry form says it continues on WhatsApp and stores nothing", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByText(/pre-filled WhatsApp message/i).first()).toBeVisible();
  });
});
