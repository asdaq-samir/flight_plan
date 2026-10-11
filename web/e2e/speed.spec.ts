import { test, expect, type Page } from "@playwright/test";
import { expandConsole, noTips } from "./helpers";

/**
 * The speed trend (SpeedController): the Dev console's Speed page, under
 * System, charts
 * each Core Web Vital from pilots' browsers beside the nightly lab run,
 * and a pilot's browser reports its own as the page is put away, with
 * nothing of the pilot's in it.
 */

// The built app's service worker would answer /api itself, past the stubs.
test.use({ serviceWorkers: "block" });

const consoleSheet = (page: Page) => page.getByTestId("console-sheet");

const DAYS = [
  { day: "2026-10-10", source: "field", metric: "LCP", device: "phone", p50: 1600, p75: 2300, count: 40, version: "aaa" },
  { day: "2026-10-11", source: "field", metric: "LCP", device: "phone", p50: 1500, p75: 2100, count: 52, version: "bbb" },
  { day: "2026-10-11", source: "field", metric: "LCP", device: "desktop", p50: 700, p75: 900, count: 9, version: "bbb" },
  { day: "2026-10-11", source: "lab", metric: "lcp", device: "phone", p50: 1800, p75: 1800, count: 1, version: "2cafd50" },
  { day: "2026-10-11", source: "lab", metric: "open_app", device: "phone", p50: 1060, p75: 1060, count: 1, version: "2cafd50" },
];

test("the Speed page, under System, charts pilots' figures beside the lab's, by device", async ({ page }) => {
  await page.route(url => url.pathname === "/api/speed", route =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(DAYS) }));
  await page.goto("/app/dev");
  await page.getByTestId("settings-button").click();
  await consoleSheet(page).getByRole("tab", { name: "System" }).click();
  await expandConsole(page);
  await consoleSheet(page).getByRole("button", { name: "Speed" }).click();
  await expect(consoleSheet(page).getByTestId("console-page").getByRole("heading", { name: "Speed" })).toBeVisible();

  const lcp = consoleSheet(page).getByTestId("speed-chart-LCP");
  await expect(lcp).toBeVisible();
  // The latest of each, and where good ends, under the chart.
  await expect(consoleSheet(page).getByText("Pilots 2.1 s · lab 1.8 s · good within 2.5 s")).toBeVisible();
  await expect(consoleSheet(page).getByTestId("speed-chart-open_app")).toBeVisible();
  // A metric with nothing measured has no chart.
  await expect(consoleSheet(page).getByTestId("speed-chart-INP")).toHaveCount(0);

  // On the desktop, its own pilots' figure.
  await consoleSheet(page).getByTestId("speed-device").getByText("Desktop").click();
  await expect(consoleSheet(page).getByText("Pilots 900 ms · lab 1.8 s · good within 2.5 s")).toBeVisible();
});

test("a pilot's browser reports its Web Vitals as the page is put away, and nothing of the pilot's", async ({ page }) => {
  // A browser driven by tests reports nothing (lib/speed), so this one
  // says it is not.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  await page.addInitScript(noTips);
  const sent: string[] = [];
  await page.route(url => url.pathname === "/api/speed/field", route => {
    sent.push(route.request().postData() ?? "");
    return route.fulfill({ status: 204 });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await page.getByTestId("search-airports").or(page.getByTestId("capsule-detail")).first().waitFor();
  // The library loads once the page is idle.
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect.poll(() => sent.length).toBeGreaterThan(0);
  const report = JSON.parse(sent[0]!) as { page: string; device: string; version: string; metrics: Record<string, number> };
  expect(report.page).toBe("plan");
  expect(["phone", "tablet", "desktop"]).toContain(report.device);
  expect(Object.keys(report.metrics).every(m => ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(m))).toBe(true);
  expect(report.metrics.TTFB).toBeGreaterThanOrEqual(0);
  // The route's airports are in the address; none of it goes.
  expect(sent[0]).not.toMatch(/C81|KDLH|dep=|lat|lon/);
});
