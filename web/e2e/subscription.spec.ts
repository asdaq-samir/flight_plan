import { test, expect, type Page } from "@playwright/test";
import { consoleSheet, openBriefing, openConsole, openSection, openTab, settle, showTabs, sideDrawer, slow } from "./helpers";

/**
 * The subscription to the paid features (lib/subscription, PaidPrompt):
 * without it, each paid feature's own place says what it does, that it
 * comes with the subscription and its price, and the free month starts
 * there; nothing paid is asked of the server meanwhile. The suite's
 * pilot is a developer, who has it given; here the webapp's answer is a
 * plain pilot's, stubbed, as the server's check is the Java tests'.
 */

type Standing = "FREE" | "TRIAL";

const subscription = (state: Standing, over: Record<string, unknown> = {}) => ({
  state, entitled: state !== "FREE", until: state === "TRIAL" ? "2026-11-10T12:00:00Z" : null,
  trialAvailable: state === "FREE", trialDays: 30, plan: null, store: null,
  uses: [
    { feature: "NARRATIVE", used: 1, cap: 60 },
    { feature: "CHECKPOINT_NOTES", used: 0, cap: 60 },
    { feature: "ORAL", used: 0, cap: 60 },
  ],
  ...over,
});

/** The webapp's subscription for this page, starting as `state`: the
 *  free month started by its POST. Answers what was asked of it. */
async function stubSubscription(page: Page, state: Standing, over: Record<string, unknown> = {}) {
  let now = state;
  const asked: string[] = [];
  await page.route(url => url.pathname === "/api/subscription", route =>
    route.fulfill({ json: subscription(now, over) }));
  await page.route(url => url.pathname === "/api/subscription/trial", route => {
    asked.push("trial");
    now = "TRIAL";
    return route.fulfill({ json: subscription("TRIAL") });
  });
  page.on("request", r => {
    const path = new URL(r.url()).pathname;
    if (path.endsWith("/api/comparison") || path.endsWith("/checkpoint-notes/generate")) asked.push(path);
  });
  return asked;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("without the subscription the Brief's narrative says it comes with it, and the free month starts there", async ({ page }) => {
  const asked = await stubSubscription(page, "FREE");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openBriefing(page);
  await openTab(page, "Brief");
  await openSection(page, "Narrative");

  const prompt = page.getByTestId("paid-prompt-NARRATIVE");
  await expect(prompt).toBeVisible({ timeout: slow(30000) });
  await expect(prompt).toContainText("$1 a month or $10 a year, the first month free");
  // Nothing written, nothing billed.
  expect(asked).toEqual([]);

  await prompt.getByTestId("start-trial").click();
  const narrative = page.getByTestId("brief-narrative");
  await expect(narrative).toContainText("A test narrative.", { timeout: slow(60000) });
  await expect(prompt).toHaveCount(0);
  expect(asked[0]).toBe("trial");
  expect(asked.filter(a => a.endsWith("/api/comparison"))).toHaveLength(1);
  // What is left of the month, under the text.
  await expect(narrative).toContainText("left this month");
});

test("without the subscription the nav log's wand says checkpoint descriptions come with it, and writes none", async ({ page }) => {
  const asked = await stubSubscription(page, "FREE");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openBriefing(page);
  const drawer = sideDrawer(page);
  const wand = drawer.locator('[role="tabpanel"] [data-testid="generate-descriptions-button"]');
  await expect(wand).toBeEnabled({ timeout: slow(60000) });
  await wand.click();
  const paywall = page.getByTestId("descriptions-paywall");
  await expect(paywall.getByTestId("paid-prompt-CHECKPOINT_NOTES")).toBeVisible();
  await expect(paywall).toContainText("A line for each checkpoint on what to look for from the air.");
  expect(asked).toEqual([]);
});

test("Personal's Subscription page says what the pilot has, and the month's uses", async ({ page }) => {
  await stubSubscription(page, "TRIAL");
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await openConsole(page);
  const console = consoleSheet(page);
  await console.getByRole("tab", { name: "Personal" }).click();
  const row = console.getByRole("button", { name: /^Subscription/ });
  await expect(row).toContainText(/Free until \d{1,2} November/);
  await row.click();
  const panel = console.getByTestId("subscription-panel");
  await expect(panel.getByTestId("subscription-standing")).toContainText(/Free until \d{1,2} November/);
  await expect(panel.getByTestId("subscription-use-NARRATIVE")).toContainText("1 of 60");
  await expect(panel).toContainText("Planning and flying are free.");
});
