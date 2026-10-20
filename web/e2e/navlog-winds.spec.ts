import { test, expect } from "@playwright/test";
import { openPanel, openTab, controlsInSight, settle, slow, closeCard } from "./helpers";

/**
 * A nav log the winds could not be read for. The planner's own stream is
 * taken and cut where the winds failed -- its altitude line with nothing
 * flown, then the error -- so the rest of the page is the real one.
 */

test("a winds outage never reads as an altitude the pilot typed", async ({ page }) => {
  // It read "0 ft · yours", with Custom pressed, for an altitude nobody
  // typed, and the reasoning said some leg had no legal altitude.
  await page.route("**/api/planner/navlog?**", async route => {
    const response = await route.fetch();
    const lines = (await response.text()).split("\n").filter(Boolean).map(l => JSON.parse(l));
    const altitude = lines.find(m => m.type === "altitude");
    const cut = [
      ...lines.filter(m => m.type === "stage"),
      { ...altitude, flown: null, altitude_ft: null, options: [] },
      { type: "error", detail: "aviationweather.gov winds-06 unavailable: timed out" },
    ];
    await route.fulfill({
      status: 200, contentType: "application/x-ndjson", body: cut.map(m => JSON.stringify(m)).join("\n") + "\n",
    });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Nav Log");
  await controlsInSight(page);

  const why = page.getByTestId("altitude-why");
  await expect(why).toHaveAccessibleName(/no altitude/, { timeout: 60000 });
  await expect(why).not.toHaveAccessibleName(/yours/);
  await why.click();
  // The Profile card, the altitude set on its side view.
  const popover = page.getByTestId("profile-card");
  await expect(popover).toContainText("winds aloft could not be read");
  await expect(popover).not.toContainText("no legal altitude");
  // And no altitude typed beside the airplane for it.
  await closeCard(page, "profile-close");
  await expect(page.getByTestId("altitude-input")).toHaveValue("");
});

test("a plan whose winds are past their forecast's period says so, and plans again", async ({ page }) => {
  // The audit's finding: a nav log planned for "now" at 08:00 flew
  // 08:00's winds at 14:00 and did not say so. Its totals' winds made an
  // hour past their period here; the rest of the plan is the real one.
  let asked = 0;
  await page.route(url => url.pathname.endsWith("/planner/navlog"), async route => {
    asked++;
    const response = await route.fetch();
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "done") {
        message.totals.planned_at = ago(8);
        message.totals.winds = { valid_at: ago(4), use_from: ago(8), use_to: ago(1) };
      }
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const old = page.getByTestId("navlog-winds-old");
  await expect(old).toBeVisible({ timeout: slow(60_000) });
  await expect(old).toContainText("Winds out of date");
  await expect(old).toContainText(/Planned \d{4}Z · winds for use \d{4}–\d{4}Z/);
  const before = asked;
  await page.getByTestId("navlog-plan-again").click();
  await expect.poll(() => asked).toBeGreaterThan(before);
  // The plan asked again is still streaming as the test ends.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
