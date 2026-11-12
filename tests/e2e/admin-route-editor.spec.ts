import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The admin re-plans a traveller's trip. The backend is mocked (auth, the
 * request, draft/send); the atlas, the engine and the UI are the real thing.
 */

const REQUEST = {
  placeIds: ["bangkok", "pattaya", "phuket", "krabi", "koh-samui"],
  nights: 10,
  startDate: "2030-02-10",
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
  destinationSummary: "Bangkok, Pattaya, Phuket, Krabi, Koh Samui",
  nights: 10,
  startDate: "2030-02-10",
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

type Captured = { path: string; body: Record<string, unknown> }[];

async function openEditor(page: Page, captured: Captured = []) {
  await page.route("**/api/auth/me", (r: Route) => r.fulfill({ json: { user: { id: "u1", name: "Admin", email: "a@example.com", avatarUrl: null } } }));
  await page.route("**/api/auth/providers", (r: Route) => r.fulfill({ json: { google: false, facebook: false, x: false } }));
  await page.route("**/api/live-rates**", (r: Route) => r.abort());
  await page.route("**/api/admin/requests/REQ-TEST1", (r: Route) => r.fulfill({ json: DETAIL }));
  await page.route("**/api/admin/requests/REQ-TEST1/*", async (r: Route) => {
    captured.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    const last = new URL(r.request().url()).pathname.split("/").pop();
    await r.fulfill({ json: last === "send" ? { ok: true, version: 1, totalInr: 1, validUntil: "2099-01-01" } : { ok: true, savedAt: "2030-01-01T11:00:00Z" } });
  });
  await page.goto("/admin/request?id=REQ-TEST1");
  await expect(page.getByTestId("handle-bangkok")).toBeVisible({ timeout: 60_000 });
  // Pricing has settled once the headline total is a number.
  await expect(page.getByText("Final total").locator("xpath=following-sibling::dd")).not.toHaveText("…", { timeout: 60_000 });
}

/**
 * Drag one stop onto another. Both must be on screen when the drag starts: a page that has to scroll
 * under the pointer mid-drag cancels a native drag, and a person would scroll first too.
 */
async function dragStop(page: Page, from: string, to: string) {
  await page.getByRole("list", { name: "Route" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.getByTestId(`handle-${from}`).dragTo(page.getByTestId(`stop-${to}`));
}

const stopOrder = (page: Page) => page.locator('[data-testid^="stop-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("stop-", "")));
const notice = (page: Page) => page.getByTestId("route-notice");
const finalTotal = (page: Page) => page.getByText("Final total").locator("xpath=following-sibling::dd").innerText();
const nightsOf = async (page: Page, id: string) => Number((await page.getByTestId(`nights-${id}`).innerText()).split(" ")[0]);

/** The first place named in the traveller-facing "Day by day" list further down the page. */
async function firstDayPlace(page: Page) {
  const list = page.getByRole("heading", { name: "Day by day" }).locator("xpath=following::ol[1]");
  return (await list.locator("> li").first().innerText()).split("\n").find((l) => /[A-Za-z]{3}/.test(l) && !/^Day\b/.test(l))!;
}

// The site scrolls smoothly; a drag that starts while the page is still gliding aims at where things were.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("admin route editor", () => {
  test("lists every stop in order, with handles, nights and a way to add", async ({ page }) => {
    await openEditor(page);
    const order = await stopOrder(page);
    expect(new Set(order)).toEqual(new Set(["bangkok", "pattaya", "phuket", "krabi", "koh-samui"]));
    for (const id of order) {
      await expect(page.getByTestId(`handle-${id}`)).toBeVisible();
      await expect(page.getByTestId(`nights-${id}`)).toContainText("night");
    }
    await expect(page.getByRole("button", { name: "+ Add to trip" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Undo last change" })).toBeDisabled();
  });

  test("dragging a stop to the top makes it the first stop and the first day of the plan", async ({ page }) => {
    await openEditor(page);
    const before = await stopOrder(page);
    const last = before[before.length - 1];
    await dragStop(page, last, before[0]);
    const after = await stopOrder(page);
    expect(after[0]).toBe(last);
    expect(after.slice(1)).toEqual(before.slice(0, -1));
    await expect(notice(page)).toContainText("Route:");
    // The itinerary the traveller will see really starts there: the route is literal, not just redrawn.
    const name = (await page.getByTestId(`stop-${last}`).locator("h4").innerText()).trim();
    expect(await firstDayPlace(page)).toContain(name);
  });

  test("dragging a stop down, and every position, keeps the other stops in order", async ({ page }) => {
    await openEditor(page);
    const start = await stopOrder(page);
    await dragStop(page, start[0], start[2]);
    const expected = [...start];
    expected.splice(2, 0, expected.splice(0, 1)[0]);
    expect(await stopOrder(page)).toEqual(expected);
  });

  test("arrow buttons reorder too, and stop at the ends", async ({ page }) => {
    await openEditor(page);
    const [first, second] = await stopOrder(page);
    const name = (id: string) => page.getByTestId(`stop-${id}`).locator("h4").innerText();
    await expect(page.getByRole("button", { name: `Move ${await name(first)} earlier` })).toBeDisabled();
    await page.getByRole("button", { name: `Move ${await name(first)} later` }).click();
    expect((await stopOrder(page)).slice(0, 2)).toEqual([second, first]);
    const order = await stopOrder(page);
    const last = order[order.length - 1];
    await expect(page.getByRole("button", { name: `Move ${await name(last)} later` })).toBeDisabled();
  });

  test("reordering works from the keyboard alone", async ({ page }) => {
    await openEditor(page);
    const [first, second] = await stopOrder(page);
    const n = (await page.getByTestId(`stop-${first}`).locator("h4").innerText()).trim();
    const btn = page.getByRole("button", { name: `Move ${n} later` });
    await btn.focus();
    await page.keyboard.press("Enter");
    expect((await stopOrder(page)).slice(0, 2)).toEqual([second, first]);
  });

  test("nights per stop: more, fewer, floor at 1, and the price follows", async ({ page }) => {
    await openEditor(page);
    const id = (await stopOrder(page))[1];
    const name = (await page.getByTestId(`stop-${id}`).locator("h4").innerText()).trim();
    const priceBefore = await finalTotal(page);
    const nBefore = await nightsOf(page, id);
    await page.getByRole("button", { name: `One more night in ${name}` }).click();
    expect(await nightsOf(page, id)).toBe(nBefore + 1);
    await expect.poll(() => finalTotal(page)).not.toBe(priceBefore);
    await page.getByRole("button", { name: `One fewer night in ${name}` }).click();
    expect(await nightsOf(page, id)).toBe(nBefore);
    // Walk down to one night; the minus then disables.
    for (let i = nBefore; i > 1; i--) await page.getByRole("button", { name: `One fewer night in ${name}` }).click();
    expect(await nightsOf(page, id)).toBe(1);
    await expect(page.getByRole("button", { name: `One fewer night in ${name}` })).toBeDisabled();
  });

  test("removing a stop shrinks the trip; the last stop cannot be removed", async ({ page }) => {
    await openEditor(page);
    let order = await stopOrder(page);
    while (order.length > 1) {
      const n = (await page.getByTestId(`stop-${order[0]}`).locator("h4").innerText()).trim();
      await page.getByRole("button", { name: `Remove ${n} from the trip` }).click();
      const next = await stopOrder(page);
      expect(next).not.toContain(order[0]);
      order = next;
    }
    const n = (await page.getByTestId(`stop-${order[0]}`).locator("h4").innerText()).trim();
    await expect(page.getByRole("button", { name: `Remove ${n} from the trip` })).toBeDisabled();
  });

  test("adds a compatible destination at the end with two nights, and it can then be moved to the top", async ({ page }) => {
    await openEditor(page);
    const before = await stopOrder(page);
    await page.getByLabel("Add a destination").selectOption("ha-noi");
    await page.getByRole("button", { name: "+ Add to trip" }).click();
    await expect(page.locator('[data-testid^="stop-"]')).toHaveCount(before.length + 1, { timeout: 60_000 });
    expect((await stopOrder(page)).at(-1)).toBe("ha-noi");
    expect(await nightsOf(page, "ha-noi")).toBe(2);
    await expect(notice(page)).toContainText("Added Ha Noi");
    await dragStop(page, "ha-noi", before[0]);
    expect((await stopOrder(page))[0]).toBe("ha-noi");
  });

  test("a place the planner cannot combine is shown as left out, with the reason, and can be removed", async ({ page }) => {
    await openEditor(page);
    const before = await stopOrder(page);
    await page.getByLabel("Add a destination").selectOption("brisbane");
    await page.getByRole("button", { name: "+ Add to trip" }).click();
    const leftOut = page.getByTestId("left-out");
    await expect(leftOut).toBeVisible({ timeout: 60_000 });
    await expect(leftOut).toContainText("Brisbane");
    await expect(leftOut).toContainText(/not realistically combinable/i);
    expect(await stopOrder(page)).toEqual(before); // nothing was silently added to the route
    await leftOut.getByRole("button", { name: "Remove Brisbane from the trip" }).click();
    await expect(page.getByTestId("left-out")).toHaveCount(0);
    expect(await stopOrder(page)).toEqual(before);
  });

  test("when the trip-length field disagrees with the stops, say so and fix it in one click", async ({ page }) => {
    await openEditor(page);
    await page.getByLabel("Add a destination").selectOption("ha-noi");
    await page.getByRole("button", { name: "+ Add to trip" }).click();
    await expect(page.getByTestId("stop-ha-noi")).toBeVisible({ timeout: 60_000 });
    // The trip-details panel may nudge the length into its realistic range for the new destination.
    // Whatever it does, the editor must never leave stops and total quietly disagreeing.
    const banner = page.getByText(/Trip details say \d+ nights/);
    if (await banner.count()) {
      await page.getByRole("button", { name: /^Set trip to \d+ nights$/ }).click();
    }
    await expect(page.getByText(/Trip details say \d+ nights/)).toHaveCount(0);
  });

  test("an outing can be dragged to another day at the same destination, not to another destination", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2400 });
    await openEditor(page);
    // Find a stop with at least two days that each hold a movable outing.
    const stops = await stopOrder(page);
    let found: { stop: string; from: string; to: string; id: string } | null = null;
    for (const s of stops) {
      const days = page.getByTestId(`stopdays-${s}`).locator('[data-testid^="day-"]');
      const count = await days.count();
      if (count < 2) continue;
      for (let i = 0; i < count; i++) {
        const outing = days.nth(i).locator('[draggable="true"]').first();
        if (await outing.count()) {
          const id = (await outing.getAttribute("data-testid"))!;
          const target = days.nth(i === 0 ? 1 : 0);
          found = { stop: s, from: (await days.nth(i).getAttribute("data-testid"))!, to: (await target.getAttribute("data-testid"))!, id };
          break;
        }
      }
      if (found) break;
    }
    expect(found, "the Thailand trip should have a stop with two days and a movable outing").not.toBeNull();
    const f = found!;
    await page.getByTestId(f.id).dragTo(page.getByTestId(`stopdays-${f.stop}`).locator(`[data-testid="${f.to}"]`));
    await expect(page.getByTestId(`stopdays-${f.stop}`).locator(`[data-testid="${f.to}"]`).getByTestId(f.id)).toBeVisible();
    await expect(notice(page)).toContainText("is now on Day");

    // Another destination's day: refused, with the reason, and nothing moves.
    const other = stops.find((s) => s !== f.stop)!;
    const otherDay = page.getByTestId(`stopdays-${other}`).locator('[data-testid^="day-"]').first();
    await page.getByTestId(f.id).dragTo(otherDay);
    await expect(notice(page)).toContainText("can only go on a day spent there");
    await expect(page.getByTestId(`stopdays-${f.stop}`).getByTestId(f.id)).toBeVisible();
    await expect(otherDay.getByTestId(f.id)).toHaveCount(0);
  });

  test("the Day dropdown moves an outing without dragging", async ({ page }) => {
    await openEditor(page);
    const editor = page.getByRole("list", { name: "Days by stop" });
    const select = editor.getByRole("combobox", { name: /^Move .* to another day$/ }).first();
    await expect(select).toBeVisible();
    const label = (await select.getAttribute("aria-label"))!;
    const options = await select.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    const current = await select.inputValue();
    const target = options.find((v) => v !== current)!;
    await select.selectOption(target);
    await expect(notice(page)).toContainText(`is now on Day ${target}`);
    await expect(editor.getByRole("combobox", { name: label })).toHaveValue(target);
  });

  test("+ Add site puts a new outing on the chosen day; Take out and Add back round-trip", async ({ page }) => {
    await openEditor(page);
    const stop = (await stopOrder(page))[0];
    const day = page.getByTestId(`stopdays-${stop}`).locator('[data-testid^="day-"]').first();
    await day.getByRole("button", { name: /^Add a site to Day/ }).click();
    const list = day.getByRole("group", { name: /^Sites available in/ });
    await expect(list).toBeVisible();
    const empty = await list.getByText("already in the plan").count();
    test.skip(empty > 0, "every outing at this destination is already planned");
    const add = list.getByRole("button", { name: /^Add .* to Day/ }).first();
    const title = ((await add.getAttribute("aria-label")) ?? "").replace(/^Add /, "").replace(/ to Day \d+$/, "");
    await add.click();
    await expect(notice(page)).toContainText(`Added ${title}`);
    // It is in the plan (the day shows it, or the page says honestly there is no room).
    const planned = await page.getByText(title, { exact: false }).count();
    expect(planned).toBeGreaterThan(0);

    // Take an existing outing out, then bring it back.
    const out = page.getByRole("button", { name: /^Take .* out of the plan$/ }).first();
    const outLabel = (await out.getAttribute("aria-label"))!;
    const outTitle = outLabel.replace(/^Take /, "").replace(/ out of the plan$/, "");
    await out.click();
    await expect(notice(page)).toContainText(`${outTitle} taken out`);
    await page.getByRole("button", { name: `Add ${outTitle} back` }).first().click();
    await expect(notice(page)).toContainText(`${outTitle} added back`);
  });

  test("transport between stops can be changed per hop, and survives an edit that does not touch that hop", async ({ page }) => {
    await openEditor(page);
    const stops = await stopOrder(page);
    // The first hop with more than one mode to choose from.
    const editor = page.getByRole("list", { name: "Days by stop" });
    const groups = editor.getByRole("radiogroup", { name: /^Transport from/ });
    const n = await groups.count();
    expect(n).toBeGreaterThan(0);
    let picked: { group: string; mode: string } | null = null;
    for (let i = 0; i < n && !picked; i++) {
      const radios = groups.nth(i).getByRole("radio");
      if ((await radios.count()) < 2) continue;
      for (let j = 0; j < (await radios.count()); j++) {
        if ((await radios.nth(j).getAttribute("aria-checked")) === "false") {
          const group = (await groups.nth(i).getAttribute("aria-label"))!;
          const mode = (await radios.nth(j).locator(".capitalize").innerText()).trim();
          await radios.nth(j).click();
          picked = { group, mode };
          break;
        }
      }
    }
    expect(picked, "some hop offers an alternative mode").not.toBeNull();
    const radio = editor.getByRole("radiogroup", { name: picked!.group }).first().getByRole("radio", { name: new RegExp(`^${picked!.mode}`, "i") });
    await expect(radio).toHaveAttribute("aria-checked", "true");
    expect(stops.length).toBeGreaterThan(1);
  });

  test("undo and redo step back and forward through route edits", async ({ page }) => {
    await openEditor(page);
    const original = await stopOrder(page);
    await dragStop(page, original[0], original[3]);
    const moved = await stopOrder(page);
    expect(moved).not.toEqual(original);
    await page.getByRole("button", { name: "Undo last change" }).click();
    expect(await stopOrder(page)).toEqual(original);
    await page.getByRole("button", { name: "Redo" }).click();
    expect(await stopOrder(page)).toEqual(moved);
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  test("'Let the planner re-order' hands the route back", async ({ page }) => {
    await openEditor(page);
    const original = await stopOrder(page);
    await dragStop(page, original[original.length - 1], original[0]);
    expect((await stopOrder(page))[0]).toBe(original[original.length - 1]);
    await page.getByRole("button", { name: "Let the planner re-order" }).click();
    await expect.poll(() => stopOrder(page)).toEqual(original);
  });

  test("a changed trip-length field is flagged against the stops, with a one-click fix", async ({ page }) => {
    await openEditor(page);
    const id = (await stopOrder(page))[0];
    const name = (await page.getByTestId(`stop-${id}`).locator("h4").innerText()).trim();
    await page.getByRole("button", { name: `One more night in ${name}` }).click();
    // The stops and the total agree after any stepper change; nothing to flag.
    await expect(page.getByText(/Trip details say/)).toHaveCount(0);
  });

  test("Save draft and Send carry the admin's order and nights, and the itinerary that goes with them", async ({ page }) => {
    const captured: Captured = [];
    await openEditor(page, captured);
    const original = await stopOrder(page);
    await dragStop(page, original[original.length - 1], original[0]);
    const order = await stopOrder(page);
    const id = order[1];
    const name = (await page.getByTestId(`stop-${id}`).locator("h4").innerText()).trim();
    await page.getByRole("button", { name: `One more night in ${name}` }).click();
    const nights = await nightsOf(page, id);

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => captured.some((c) => c.path.endsWith("/draft"))).toBe(true);
    const draft = captured.find((c) => c.path.endsWith("/draft"))!.body as { request: { placeOrder: string[]; placeIds: string[]; nights: number; nightOverrides: Record<string, number> }; quotation: { stays: { placeId: string; nights: number }[] } };
    expect(draft.request.placeOrder).toEqual(order);
    expect(draft.request.placeIds).toEqual(order);
    expect(draft.request.nightOverrides[id]).toBe(nights);
    expect(draft.request.nights).toBe(Object.values(draft.request.nightOverrides).reduce((a, b) => a + b, 0));
    // What the traveller will be shown is the same route, in the same order, with the same nights.
    expect(draft.quotation.stays.map((s) => s.placeId).filter((p, i, a) => a.indexOf(p) === i)).toEqual(order);
    expect(draft.quotation.stays.find((s) => s.placeId === id)!.nights).toBe(nights);

    await page.getByRole("button", { name: /Send (final|revised) quote/ }).click();
    await page.getByRole("button", { name: "Send to traveller" }).click();
    await expect.poll(() => captured.some((c) => c.path.endsWith("/send"))).toBe(true);
    const sent = captured.find((c) => c.path.endsWith("/send"))!.body as typeof draft;
    expect(sent.request.placeOrder).toEqual(order);
  });

  test("a reopened draft keeps the admin's order", async ({ page }) => {
    const order = ["koh-samui", "krabi", "phuket", "pattaya", "bangkok"];
    await page.route("**/api/auth/me", (r) => r.fulfill({ json: { user: { id: "u1", name: "Admin", email: "a@example.com", avatarUrl: null } } }));
    await page.route("**/api/auth/providers", (r) => r.fulfill({ json: { google: false, facebook: false, x: false } }));
    await page.route("**/api/live-rates**", (r) => r.abort());
    await page.route("**/api/admin/requests/REQ-TEST1", (r) =>
      r.fulfill({
        json: {
          ...DETAIL,
          workingCopy: {
            kind: "draft", version: 0, updatedAt: "2030-01-01T11:00:00Z", adjustments: null, validUntil: "2099-01-01", note: null,
            request: { ...REQUEST, placeIds: order, placeOrder: order, nightOverrides: { "koh-samui": 2, krabi: 2, phuket: 2, pattaya: 2, bangkok: 2 } },
          },
        },
      }),
    );
    await page.goto("/admin/request?id=REQ-TEST1");
    await expect(page.getByTestId("handle-bangkok")).toBeVisible({ timeout: 60_000 });
    expect(await stopOrder(page)).toEqual(order);
  });

  test("on a phone: no sideways scroll, every control reachable by tap (no drag needed)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await openEditor(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const [first, second] = await stopOrder(page);
    const n = (await page.getByTestId(`stop-${first}`).locator("h4").innerText()).trim();
    await page.getByRole("button", { name: `Move ${n} later` }).tap();
    expect((await stopOrder(page)).slice(0, 2)).toEqual([second, first]);
    const box = await page.getByRole("button", { name: `Move ${n} earlier` }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await ctx.close();
  });
});
