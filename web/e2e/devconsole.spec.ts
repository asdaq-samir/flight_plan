import { test, expect, type Page } from "@playwright/test";

/**
 * The Dev console's System tab, for the answers that are not "up": a
 * service this deployment does not run, and a planner that did not
 * answer. Each used to read "checking…" for ever.
 */

const consoleSheet = (page: Page) => page.locator('[data-slot="sheet-content"][data-side="top"]');
const row = (page: Page, service: RegExp) => consoleSheet(page).getByRole("row", { name: service });

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

test("a snapshot that failed reads no answer, and nothing waits for it for ever", async ({ page }) => {
  await page.route("**/api/planner/status", route =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "planner down" }) }));
  await openSystemTab(page);

  await expect(row(page, /model-service/)).toContainText("no answer");
  await expect(row(page, /crewai-agent/)).toContainText("no answer");
  await expect(consoleSheet(page).getByText("The planner did not answer.")).toBeVisible();
  await expect(consoleSheet(page).getByText("Loading…")).toHaveCount(0);
});
