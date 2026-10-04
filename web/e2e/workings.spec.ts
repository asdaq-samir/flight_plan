import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * Show the work (LegWorkings): the selected leg's wind triangle worked
 * out step by step, and a student's own figures checked against it.
 */
test("a leg's heading worked out, and a student's magnetic heading marked", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await page.getByRole("button", { name: "Nav Log", exact: true }).click();
  const rows = sideDrawer(page).locator("[data-kind=checkpoint]");
  await expect(rows.first()).toBeVisible({ timeout: slow(120000) });
  await rows.first().click();
  await sideDrawer(page).getByTestId("leg-workings").first().click();
  const sheet = page.getByTestId("leg-workings-content");
  await expect(sheet.getByTestId("working-step")).toHaveCount(10);
  await expect(sheet.getByTestId("working-step").nth(5)).toContainText("east is least, west is best");
  // The answer, read from the worked steps, typed back: right.
  const mh = (await sheet.getByTestId("working-step").nth(5).innerText()).match(/(\d{3})°\s*$/)![1]!;
  await sheet.getByTestId("workings-mode").getByText("Try it").click();
  await sheet.getByTestId("try-mh-input").fill(mh);
  await sheet.getByTestId("try-gs-input").fill("1");
  await sheet.getByTestId("try-check").click();
  await expect(sheet.getByTestId("try-mh").getByLabel("Right")).toBeVisible();
  await expect(sheet.getByTestId("try-gs")).toContainText("Not quite");
  // A figure not typed is not marked, nor its answer given away.
  await expect(sheet.getByTestId("try-th")).not.toContainText("Not quite");
});
