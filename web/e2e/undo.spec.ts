import { test, expect, type Page } from "@playwright/test";
import { clearTheRoute, openPanel, settle, sideDrawer } from "./helpers";

/**
 * Undo in place of asking first (the owner's "make the pilot aware, never
 * restrict them"): the route cleared or a stop taken out goes at once,
 * and the bar that says so takes it back; Cmd-Z or Ctrl-Z does too, and
 * Shift with it gives the change again (lib/planHistory).
 *
 * Only the route's own address is looked at, so the planner's answers are
 * not waited for: they are let go.
 */

test.beforeEach(async ({ page }) => {
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname), route => route.abort());
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const undoBar = (page: Page, words: string) => page.locator("[data-sonner-toast]", { hasText: words });

// The page's own settling after a load (an ident made the field's own) is
// part of the load, not a step to undo (SETTLE_MS): the pilot's first edit
// comes after it.
const pastSettling = (page: Page) => page.waitForTimeout(1600);

test("a cleared route comes back from the Undo bar, and again from the keyboard", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KMSN");
  await settle(page);
  await openPanel(page);
  await pastSettling(page);

  await clearTheRoute(page);
  await expect(page).not.toHaveURL(/[?&]dep=/);
  const bar = undoBar(page, "Route Cleared");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(page).toHaveURL(/[?&]dep=C81(&|$)/);
  await expect(page).toHaveURL(/[?&]dest=KDLH(&|$)/);
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
  await expect(bar).toHaveCount(0);

  // Redone and undone by the keys, away from any field.
  await page.locator("body").focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page).not.toHaveURL(/[?&]dep=/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page).toHaveURL(/[?&]dest=KDLH(&|$)/);
});

test("a stop taken out comes back from the Undo bar that names it", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KRYV,KMSN");
  await settle(page);
  await openPanel(page);
  await pastSettling(page);

  const lines = sideDrawer(page).getByTestId("route-slide");
  await lines.getByRole("group", { name: "Stop 2 KMSN" }).focus();
  await page.keyboard.press("Delete");
  await expect(page).toHaveURL(/[?&]stops=KRYV(&|$)/);
  const bar = undoBar(page, "KMSN Removed");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(page).toHaveURL(/[?&]stops=KRYV%2CKMSN(&|$)|[?&]stops=KRYV,KMSN(&|$)/);
  await expect(lines.getByRole("group", { name: "Stop 2 KMSN" })).toBeVisible();
});
