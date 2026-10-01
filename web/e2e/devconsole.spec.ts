import { test, expect, type Page } from "@playwright/test";

/**
 * The Dev console's System tab, for the answers that are not "up": a
 * service this deployment does not run, and a planner that did not
 * answer. Each used to read "checking…" for ever.
 */

const consoleSheet = (page: Page) => page.getByTestId("console-sheet");
// A service's row in the Services list.
const row = (page: Page, service: RegExp) => consoleSheet(page).locator('[data-slot="item"]').filter({ hasText: service });

async function openSystemTab(page: Page) {
  await page.goto("/app/dev");
  await page.getByTestId("dev-console-button").click();
  await consoleSheet(page).getByRole("tab", { name: "System" }).click();
}

test("an agent this deployment does not run reads not configured", async ({ page }) => {
  await page.route("**/api/planner/status", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.services.nav_log_agent = null;
    await route.fulfill({ response, json });
  });
  await openSystemTab(page);

  await expect(row(page, /nav-log-agent/)).toContainText("not configured");
  await expect(row(page, /nav-log-agent/)).not.toContainText("checking");
});

test("a snapshot that failed reads no answer, and nothing waits for it for ever", { tag: "@smoke" }, async ({ page }) => {
  await page.route("**/api/planner/status", route =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "planner down" }) }));
  await openSystemTab(page);

  await expect(row(page, /model-service/)).toContainText("no answer");
  await expect(row(page, /crewai-agent/)).toContainText("no answer");
  await expect(row(page, /webapp/)).toContainText("no answer");
  await expect(row(page, /planning-service/)).toContainText("no answer");
  // The reference data's page says so too, once its row is tapped: the
  // tab opens on Services, the rest a row each that opens its own page.
  await consoleSheet(page).getByRole("button", { name: /^Reference data/ }).click();
  await expect(consoleSheet(page).getByRole("heading", { name: "Reference data" })).toBeVisible();
  await expect(consoleSheet(page).getByText("The planner did not answer.")).toBeVisible();
  await expect(consoleSheet(page).getByText("Asking the planner for its status…")).toHaveCount(0);
});

test("a snapshot from long ago -- the service worker's, with the planner out of reach -- says so, and is not read as up", async ({ page }) => {
  // What a phone off the Wi-Fi gets: the last snapshot the service
  // worker holds, arriving as a 200 with every service "up" as of
  // forty minutes ago.
  await page.route("**/api/planner/status", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.checked_at = new Date(Date.now() - 40 * 60_000).toISOString();
    await route.fulfill({ response, json });
  });
  await openSystemTab(page);

  await expect(consoleSheet(page).getByTestId("stale-snapshot")).toContainText("has not answered since this snapshot, 40 min ago");
  await expect(consoleSheet(page).getByText(/Checked 40 min ago — the planner has not answered since/)).toBeVisible();
});

test("the System tab's rows open a page each, as Settings does, and back returns to the row", async ({ page }) => {
  await openSystemTab(page);
  const sheet = consoleSheet(page);
  await sheet.getByRole("button", { name: /^Elsewhere in the stack/ }).click();
  // The page in the tab's place, read from its title on.
  await expect(sheet.getByRole("heading", { name: "Elsewhere in the stack" })).toBeFocused();
  await expect(sheet.getByRole("region", { name: "Services" })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: /API docs/ }).first()).toBeVisible();

  await sheet.getByRole("button", { name: "System", exact: true }).click();
  await expect(sheet.getByRole("region", { name: "Services" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Elsewhere in the stack/ })).toBeFocused();
});
