import { test, expect } from "@playwright/test";
import { closeSidebarWithTheStockKey, consolePage, consoleSheet, expectDrawerClosed, expectDrawerOpen, openConsole, grabberTo, settle, showTabs, sideDrawer, slow } from "./helpers";

/**
 * The dev page's training: the dev console, and the waypoint drawer's
 * worklist.
 */

test("dev page: the dev console opens on training, and the waypoint drawer opens once it is closed", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/app/dev");
  await settle(page);
  // The training workspace is the page -- the console stays off screen
  // until its tab is picked. At rest the training's figures alone, as
  // FPL's with a route; the pill its tabs: Train, Perf and Setup.
  if ((page.viewportSize()?.width ?? 0) < 768) await expect(sideDrawer(page).getByTestId("train-figures")).toBeVisible();
  await showTabs(page);
  await expect(sideDrawer(page).getByTestId("tab-bar").getByRole("button")).toHaveText(["Train", "Perf", "Setup"]);
  await expect(page.getByTestId("tab-train")).toHaveAttribute("aria-current", "page");
  // Its tabs half way (the figures are the pill's); down again, the pill.
  await grabberTo(page, "peek");
  await expectDrawerClosed(page);
  expect(await consoleSheet(page).count()).toBe(0);

  await showTabs(page);
  await openConsole(page);
  const devMl = consoleSheet(page);
  await expect(devMl).toBeVisible();
  // The developer's Setup is the pilot's (the owner's pick of the dev
  // page's redesign): the switches and the account, then Status,
  // Settings, Guide and About as rows; the Guide the three steps that
  // change the model. How good the models are is the page's Perf tab.
  await expect(devMl.getByTestId("setup-head")).toBeVisible();
  await consolePage(devMl, "Guide");
  await expect(devMl.getByText("Load a route")).toBeVisible();
  await expect(devMl.getByText("Rate its points")).toBeVisible();
  await expect(devMl.getByText("Retrain", { exact: true })).toBeVisible();
  // No inputs of its own: the header's route form is the one that
  // loads a route, and Retrain lives in the
  // Model Training drawer at the side, in its More menu with Reset.
  expect(await devMl.locator("input, textarea, [role=combobox]").count()).toBe(0);
  expect(await devMl.getByRole("button", { name: /Retrain/ }).count()).toBe(0);
  await consolePage(devMl, "Status");
  await devMl.getByRole("button", { name: /^Services/ }).click();
  await expect(devMl.getByText("planning-service", { exact: true })).toBeVisible();

  // Escape puts it away, Train the tab up again; Perf is how good the
  // models are; then the waypoint drawer opens from its grabber, and
  // Escape closes that too.
  await page.keyboard.press("Escape");
  await expect(devMl).toHaveCount(0);
  await showTabs(page);
  await expect(page.getByTestId("tab-train")).toHaveAttribute("aria-current", "page");
  await showTabs(page);
  await page.getByTestId("tab-perf").click();
  await grabberTo(page, "full");
  await expect(sideDrawer(page).getByTestId("perf-panel").getByText("Model comparison")).toBeVisible();
  await showTabs(page);
  await page.getByTestId("tab-train").click();
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await grabberTo(page, "full");
  await expectDrawerOpen(page);
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
});

test("dev page: the waypoint drawer is a worklist -- every candidate in flight order, walked with the keys, rated from the rating card", async ({ page }) => {
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  const drawer = sideDrawer(page);
  await expect(drawer.getByTestId("drawer-title")).toHaveText("Model Training");
  const list = drawer.getByRole("list", { name: /Waypoints from/i });
  const rows = list.locator("[data-waypoint-row]");
  // Detections stream in: far more rows than the two endpoints, the
  // unrated ones included -- the old list showed only rated points.
  await expect.poll(() => rows.count(), { timeout: slow(30000) }).toBeGreaterThan(10);
  // And then wait for the stream to *stop*. The walk below steps from
  // whichever row is selected, and rows arriving between the click and
  // the keypress shift what nth(3) refers to -- which is what made this
  // test fail about one run in ten, on mobile, where the drawer is a
  // Sheet and everything happens a little later.
  await expect.poll(async () => {
    const before = await rows.count();
    await page.waitForTimeout(1200);
    return (await rows.count()) === before;
  }, { timeout: slow(40000) }).toBe(true);
  await expect(drawer.getByTestId("train-figures")).toBeVisible();
  await expect(rows.first()).toContainText("C81");

  // A click selects the row and puts its point in the rating card under
  // the route (RatingCard).
  await rows.nth(2).click();
  await expect(rows.nth(2)).toHaveAttribute("data-selected", "true");
  await expect(drawer.getByTestId("rating-card").getByRole("button", { name: "Rate 5" })).toBeVisible();

  // Down, with focus in the list, walks the list top to bottom.
  await page.keyboard.press("ArrowDown");
  await expect(list.locator("[data-waypoint-row][data-selected]")).toHaveCount(1);
  await expect(rows.nth(3)).toHaveAttribute("data-selected", "true");

  // The filters live in a popover (a sheet on a phone) from the
  // drawer's header, one named group per axis.
  await drawer.getByTestId("waypoint-filters-button").click();
  for (const axis of ["Role", "Source", "Status"]) {
    await expect(page.getByText(axis, { exact: true })).toBeVisible();
  }
});

test("a retrain confirmed from the panel's More opens Perf, to follow it", async ({ page }) => {
  // The run's progress is on the page's Perf tab: the tab is where a
  // retrain takes you.
  await page.route("**/api/planner/status", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.pipeline = {
      ...json.pipeline, airflow_configured: true, airflow_reachable: true, last_run: null,
      training: { usable: 40, needed: 30, ready: true, rated: 45, off_detection: 5, reading: [], message: "40 of the 30 ratings training needs." },
    };
    await route.fulfill({ response, json });
  });
  await page.route("**/api/planner/retrain", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dag_run_id: "manual__test", state: "queued" }) }));
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await expect(consoleSheet(page)).toHaveCount(0);

  await grabberTo(page, "full");
  await page.getByTestId("training-more-button").click();
  await page.getByTestId("retrain-button").click();
  await page.getByRole("button", { name: "Retrain", exact: true }).click();

  await showTabs(page);
  await expect(page.getByTestId("tab-perf")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page).getByTestId("retrain-row")).toContainText("Retrain");
  await expect(consoleSheet(page)).toHaveCount(0);
  // The snapshot is polled: a fetch of one still in flight as the page
  // closes is not this test's failure.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Performance: Retrain says why it is off in the planner's words, and the chart model is weighed against the palette", async ({ page }) => {
  await page.route("**/api/planner/status", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.pipeline = {
      ...json.pipeline, airflow_configured: true, airflow_reachable: true, last_run: null,
      training: {
        usable: 28, needed: 30, ready: false, rated: 32, off_detection: 4, reading: [],
        message: "28 of the 30 ratings training needs. 4 of your 32 are on points the chart reader no longer finds. Rate 2 more.",
      },
    };
    json.model = {
      ...json.model,
      chart: { model_type: "Ridge", trained_at: new Date().toISOString(), held_out_mae: 1.2, palette_held_out_mae: 2.2,
               dummy_held_out_mae: 1.8, n_labeled: 40, n_test: 8 },
    };
    await route.fulfill({ response, json });
  });
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("tab-perf").click();
  await grabberTo(page, "full");
  const sheet = sideDrawer(page).getByTestId("perf-panel");

  // Retrain the head's, over the sections (PerfHead), its reason under it.
  await expect(sideDrawer(page).getByTestId("retrain-row")).toBeDisabled();
  await expect(sideDrawer(page).getByTestId("perf-head").getByText("Rate 2 more.", { exact: false })).toBeVisible();
  await expect(sheet.getByText("Chart model", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Beats the palette", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Palette constants", { exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("dev page: a detection the chart model has scored says so in its row, beside where it is", async ({ page }) => {
  // Every detection given the model's score on its way in, as the
  // planner sends it once a chart model is promoted.
  await page.route("**/api/planner/detect/stream?*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "block") message.detections = message.detections.map((d: object) => ({ ...d, predicted_score: 0.36 }));
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  const rows = sideDrawer(page).getByRole("list", { name: /Waypoints from/i }).locator("[data-waypoint-row]");
  await expect(rows.filter({ hasText: "model 0.4" }).first()).toBeVisible({ timeout: slow(30000) });
  // Not the endpoints, which the model does not score.
  await expect(rows.first()).not.toContainText("model");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
