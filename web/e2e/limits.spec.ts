import { test, expect } from "@playwright/test";
import { openMapSettings, openSetup, settle, consolePage } from "./helpers";

/**
 * What the planner is not (lib/limits): said in About and at the
 * briefing's foot, not in a dialog to accept before the map, at the
 * owner's ask ("no aviation app does that").
 */
test("a fresh device opens straight onto the map, and About says what the planner is not", async ({ page }) => {
  // A device that has been here before carries the acknowledgement the
  // first-launch dialog kept (vfr.limits); this one has none.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("limits-fresh")) return;
    localStorage.removeItem("vfr.limits");
    sessionStorage.setItem("limits-fresh", "1");
  });
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Before you fly")).toHaveCount(0);

  // The console's About page says it again in full, at
  // the owner's ask -- the app, its build and chart, where its data comes
  // from with each one's terms, and the legal pages.
  await openSetup(page);
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
});

// The traffic's source credited under the map's settings beside the
// FAA's charts, at the owner's ask, whether the traffic is shown or not.
test("the map's settings credit adsb.lol for the traffic as they credit the FAA for the charts", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  const settings = page.getByTestId("map-settings");
  // Rows of their own, where they were a footnote.
  await expect(settings.getByTestId("chart-edition")).toContainText("FAA");
  await expect(settings).toContainText("adsb.lol · ODbL");
});
