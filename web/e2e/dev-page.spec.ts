import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, consoleSheet, expectDrawerClosed, expectDrawerOpen, closeSidebarWithTheStockKey } from "./helpers";

/**
 * The dev page's training: the dev console, and the waypoint drawer's
 * worklist.
 */

test("dev page: the dev console opens on training, and the waypoint drawer opens once it is closed", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/app/dev");
  await settle(page);
  // The training workspace is the page -- the console stays off screen
  // until its own trigger is opened.
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  await expectDrawerClosed(page);
  expect(await consoleSheet(page).count()).toBe(0);

  await page.getByTestId("settings-button").click();
  const devMl = consoleSheet(page);
  await expect(devMl).toBeVisible();
  // The developer's drawer opens on training -- the three steps that
  // change the model -- then how good the models are, then the stack.
  await expect(devMl.getByText("Collect a route")).toBeVisible();
  for (const name of ["Guide", "Performance", "System"]) {
    await expect(devMl.getByRole("tab", { name })).toBeVisible();
  }
  await devMl.getByRole("tab", { name: "Performance" }).click();
  await expect(devMl.getByText("Model comparison")).toBeVisible();
  await devMl.getByRole("tab", { name: "Guide" }).click();
  await expect(devMl.getByText("Collect a route")).toBeVisible();
  await expect(devMl.getByText("Rate its checkpoints")).toBeVisible();
  await expect(devMl.getByText("Retrain", { exact: true })).toBeVisible();
  // No inputs of its own: the header's route form is the one that
  // loads (and offers to collect) a route, and Retrain lives in the
  // Model Training drawer at the side, in its More menu with Reset.
  expect(await devMl.locator("input, textarea, [role=combobox]").count()).toBe(0);
  expect(await devMl.getByRole("button", { name: /Retrain/ }).count()).toBe(0);
  await devMl.getByRole("tab", { name: "System" }).click();
  await expect(devMl.getByText("planning-service", { exact: true })).toBeVisible();
  await devMl.getByRole("tab", { name: "Performance" }).click();

  // The console is modal: Escape puts it away, then the waypoint drawer
  // opens from the header, and Escape closes that too.
  await page.keyboard.press("Escape");
  await expect(devMl).toHaveCount(0);
  await page.getByTestId("sidebar-trigger-button").click();
  await expectDrawerOpen(page);
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
});

test("dev page: the waypoint drawer is a worklist -- every candidate in flight order, walked with the keys, rated from the selected row", async ({ page }) => {
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
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
  await expect(drawer.getByRole("progressbar", { name: /^\d+ of \d+ rated$/ })).toBeVisible();
  await expect(rows.first()).toContainText("C81");

  // A click selects the row, and its own rating buttons open under it.
  await rows.nth(2).click();
  await expect(rows.nth(2)).toHaveAttribute("data-selected", "true");
  await expect(drawer.getByRole("button", { name: "Rate 5" })).toBeVisible();

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

test("a retrain confirmed from the panel's More opens the console on Performance, to follow it", async ({ page }) => {
  // The run's progress is on the Performance tab, with no badge on the
  // tab's name any more: the tab is where a retrain takes you.
  await page.route("**/api/planner/status", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.pipeline = {
      ...json.pipeline, airflow_configured: true, airflow_reachable: true, last_run: null,
      training: { route: "C81->KDLH", usable: 40, needed: 30, ready: true, rated: 45, zeros: 3, off_landmark: 2, same_landmark: 0, older: 0, message: "40 of the 30 ratings training needs." },
    };
    await route.fulfill({ response, json });
  });
  await page.route("**/api/planner/retrain", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dag_run_id: "manual__test", state: "queued" }) }));
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await expect(consoleSheet(page)).toHaveCount(0);

  await page.getByTestId("training-more-button").click();
  await page.getByTestId("retrain-button").click();
  await page.getByRole("button", { name: "Retrain", exact: true }).click();

  await expect(consoleSheet(page).getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
  await expect(consoleSheet(page).getByRole("tab", { name: "Performance" })).toHaveText("Performance");
  await expect(consoleSheet(page).getByTestId("retrain-row")).toContainText("Retrain");
  // The snapshot is polled: a fetch of one still in flight as the page
  // closes is not this test's failure.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
