import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The route board on the quotation: drag a stop, shuffle, reverse, reset, and the price follows. The backend is
 * mocked (auth and the request); the atlas, the engine and the UI are the real thing.
 */

const REQUEST = {
  placeIds: ["paris", "amsterdam", "brussels"],
  nights: 7,
  startDate: "2030-05-10",
  adults: 2,
  childAges: [],
  travellerType: "couple",
  tripStyle: "romantic",
  nationality: "IND",
  departureCity: "DEL",
  hotelStar: "4 Star",
  hotelZone: "Central",
  carrier: "FSC",
  cabin: "Economy",
  mealPlan: "breakfast",
  food: "no-preference",
  pace: "balanced",
  includeVisa: true,
  includeInsurance: false,
  includeFlight: true,
};

const DETAIL = {
  id: "REQ-TEST1",
  createdAt: "2030-01-01T10:00:00Z",
  updatedAt: "2030-01-01T10:00:00Z",
  status: "in_review",
  destinationSummary: "Paris, Amsterdam, Brussels",
  nights: 7,
  startDate: "2030-05-10",
  estimateInr: 400000,
  perPersonInr: 200000,
  contact: { name: "Test Traveller", accountEmail: "t@example.com", email: "t@example.com", phone: null, note: null },
  snapshot: { request: REQUEST },
  events: [],
  revisions: [],
  workingCopy: null,
  defaultValidUntil: "2099-01-01",
  quotedTotalInr: null,
  quoteValidUntil: null,
  acceptance: null,
  paidInr: 0,
  payments: [],
};

async function openQuote(page: Page) {
  await page.route("**/api/auth/me", (r: Route) => r.fulfill({ json: { user: { id: "u1", name: "Admin", email: "a@example.com", avatarUrl: null } } }));
  await page.route("**/api/auth/providers", (r: Route) => r.fulfill({ json: { google: false, facebook: false, x: false } }));
  await page.route("**/api/live-rates**", (r: Route) => r.abort());
  await page.route("**/api/admin/requests/REQ-TEST1", (r: Route) => r.fulfill({ json: DETAIL }));
  await page.route("**/api/admin/requests/REQ-TEST1/*", (r: Route) => r.fulfill({ json: { ok: true, savedAt: "2030-01-01T11:00:00Z" } }));
  await page.goto("/admin/request?id=REQ-TEST1");
  await expect(page.getByTestId("route-board")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Final total").locator("xpath=following-sibling::dd")).not.toHaveText("…", { timeout: 60_000 });
}

const finalTotal = (page: Page) => page.getByText("Final total").locator("xpath=following-sibling::dd").innerText();
const stopsInOrder = (page: Page) =>
  page.locator('[data-testid^="route-stop-"]').evaluateAll((els) =>
    els
      .map((e) => ({ id: e.getAttribute("data-testid")!.replace("route-stop-", ""), x: e.getBoundingClientRect().x }))
      .sort((a, b) => a.x - b.x)
      .map((s) => s.id),
  );

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("route board", () => {
  test("shows the suggested route as a journey", async ({ page }) => {
    await openQuote(page);
    expect(await stopsInOrder(page)).toHaveLength(3);
    await expect(page.getByTestId("route-board-summary")).toContainText(/Return ticket|Open-jaw/);
    await expect(page.getByTestId("route-reset")).toBeDisabled();
  });

  test("dragging a stop re-orders the trip and re-prices it, and reset brings the suggestion back", async ({ page }) => {
    await openQuote(page);
    const before = await stopsInOrder(page);
    const total = await finalTotal(page);
    const first = page.getByTestId(`route-stop-${before[0]}`);
    const last = page.getByTestId(`route-stop-${before[2]}`);
    await first.scrollIntoViewIfNeeded();
    const a = (await first.boundingBox())!;
    const b = (await last.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + 22);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 10, b.y + 22, { steps: 12 });
    await page.mouse.up();

    await expect(page.getByTestId("route-reset")).toBeEnabled();
    await expect.poll(() => stopsInOrder(page)).toEqual([before[1], before[2], before[0]]);
    await expect(page.getByText("Final total").locator("xpath=following-sibling::dd")).not.toHaveText(total);

    await page.getByTestId("route-reset").click();
    await expect(page.getByTestId("route-reset")).toBeDisabled();
    await expect.poll(() => stopsInOrder(page)).toEqual(before);
    await expect(page.getByText("Final total").locator("xpath=following-sibling::dd")).toHaveText(total);
  });

  test("reverse and shuffle change the order", async ({ page }) => {
    await openQuote(page);
    const before = await stopsInOrder(page);
    await page.getByRole("button", { name: "Reverse" }).click();
    await expect.poll(() => stopsInOrder(page)).toEqual([...before].reverse());
    await page.getByRole("button", { name: "Shuffle" }).click();
    const shuffled = await stopsInOrder(page);
    expect([...shuffled].sort()).toEqual([...before].sort());
    expect(shuffled).not.toEqual([...before].reverse());
  });

  test("a hand-made order says how it compares with the suggestion", async ({ page }) => {
    await openQuote(page);
    await page.getByRole("button", { name: "Reverse" }).click();
    await expect(page.getByTestId("route-board-compare")).toContainText(/than our suggestion|Same price/);
  });
});
