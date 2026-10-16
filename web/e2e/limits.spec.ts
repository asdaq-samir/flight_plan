import { test, expect } from "@playwright/test";
import { openMapSettings, openSettings, settle, consolePage } from "./helpers";

/**
 * The first-launch acknowledgement (lib/limits, LimitsDialog): seen once
 * on a fresh device, closed only by "I understand", and not again. The
 * suite's session has it given; this spec starts without it.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("limits-fresh")) return;
    localStorage.removeItem("vfr.limits");
    sessionStorage.setItem("limits-fresh", "1");
  });
});

test("a fresh device is told what the planner is not, once, and Settings has it again", async ({ page }) => {
  await page.goto("/app/plan");
  const dialog = page.getByTestId("limits-dialog");
  await expect(dialog).toContainText("planning aid for VFR flight");
  await expect(dialog).toContainText("14 CFR 91.3, 91.103");

  // Only the button closes it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.getByTestId("limits-acknowledge").click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await settle(page);
  await expect(dialog).toHaveCount(0);

  // The console's About tab, after Settings, says it again in full, at
  // the owner's ask -- the app, its build and chart, where its data comes
  // from with each one's terms, and the legal pages.
  await openSettings(page);
  await consolePage(page.getByTestId("console-sheet"), "About");
  const about = page.getByTestId("about-panel");
  await expect(about).toContainText("Wingtip Maps");
  await expect(about.getByTestId("about-planning-aid")).toContainText("planning aid for VFR flight");
  await expect(about.getByTestId("about-planning-aid")).toContainText("14 CFR 91.103");
  await expect(about.getByTestId("about-build")).toBeVisible();
  await expect(about.getByTestId("about-chart-edition")).not.toHaveText(/—/);
  // The traffic's source among them, with its licence, as the FAA's are.
  const traffic = about.getByTestId("about-source").filter({ hasText: "adsb.lol" });
  await expect(traffic).toContainText("ODbL 1.0");
  await expect(traffic).toHaveAttribute("href", /opendatacommons\.org/);
  await expect(about.getByTestId("about-source").filter({ hasText: "FAA sectional" })).toContainText("Public domain");
  await expect(about).not.toContainText("OpenStreetMap");
  await expect(about.getByTestId("legal-privacy")).toHaveAttribute("href", "/app/privacy.html");
  // Settings itself no longer has them.
  await consolePage(page.getByTestId("console-sheet"), "Settings");
  await expect(page.getByTestId("settings-panel").getByTestId("legal-privacy")).toHaveCount(0);
});

// The traffic's source credited under the map's settings beside the
// FAA's charts, at the owner's ask, whether the traffic is shown or not.
test("the map's settings credit adsb.lol for the traffic as they credit the FAA for the charts", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vfr.limits", JSON.stringify({ state: { acknowledged: true }, version: 0 })));
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  const settings = page.getByTestId("map-settings");
  // Rows of their own, where they were a footnote.
  await expect(settings.getByTestId("chart-edition")).toContainText("FAA");
  await expect(settings).toContainText("adsb.lol · ODbL");
});
