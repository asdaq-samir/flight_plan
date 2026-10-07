import { test, expect } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * Print's Kneeboard card (Kneeboard, printKneeboard): offered beside the
 * whole briefing, and printed on half-letter paper with the card alone on
 * it. The browser's print is stubbed to record what the page was when it
 * was asked; the card's own layout is seen in a PDF, not here.
 */
test("Print offers the kneeboard card, and prints it alone on half-letter paper", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { printed: string }).printed =
        `${document.documentElement.className}|${document.querySelector("style[data-kneeboard]")?.textContent ?? ""}`;
    };
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });

  // Off screen until printed, and whole: every row of the log, both fields.
  const card = page.getByTestId("kneeboard");
  await expect(card).toBeHidden();
  expect(await card.locator("tbody tr").count()).toBeGreaterThan(5);
  await expect(card).toContainText("KDLH · Duluth");

  await page.getByTestId("more-actions").click();
  await expect(page.getByTestId("print-briefing")).toBeVisible();
  await page.getByTestId("print-kneeboard").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed?: string }).printed ?? "")).toContain("print-kneeboard");
  const printed = await page.evaluate(() => (window as unknown as { printed: string }).printed);
  expect(printed).toContain("size: 5.5in 8.5in");
});
