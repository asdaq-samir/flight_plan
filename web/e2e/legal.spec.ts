import { test, expect } from "@playwright/test";
import { openSettings, noTips } from "./helpers";

/**
 * The privacy policy, terms and support pages (public/*.html): served
 * as plain HTML that needs no JavaScript, for App Store Connect's URLs,
 * and linked from Settings and from the sign-in dialog (Apple's Review
 * Guidelines 1.5 and 5.1.1(i)).
 */
test.beforeEach(async ({ page }) => { await page.addInitScript(noTips); });

const PAGES = [
  { path: "/app/privacy.html", heading: "Privacy policy", text: /Anthropic/ },
  { path: "/app/terms.html", heading: "Terms of use", text: /Wingtip Maps is a planning aid for VFR flight\./ },
  { path: "/app/support.html", heading: "Support", text: /github\.com\/asdaq-samir\/flight_plan\/issues/ },
];

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const p of PAGES) {
    test(`${p.heading} loads`, async ({ page }) => {
      const response = await page.goto(p.path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"]).toContain("text/html");
      await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
      await expect(page.locator("body")).toContainText(p.text);
    });
  }
});

test("Settings links the three pages", async ({ page }) => {
  await page.goto("/app/plan");
  await openSettings(page);
  for (const [key, p] of [["privacy", PAGES[0]!], ["terms", PAGES[1]!], ["support", PAGES[2]!]] as const) {
    await expect(page.getByTestId(`legal-${key}`)).toHaveAttribute("href", p.path);
  }
});

test("the sign-in dialog links them", async ({ page }) => {
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("console-sheet").getByRole("tab", { name: "Personal" }).click();
  await page.getByTestId("console-sheet").getByRole("tabpanel").getByRole("button", { name: "Sign in" }).click();
  const legal = page.getByRole("dialog", { name: "Sign in to Wingtip Maps" }).getByTestId("sign-in-legal");
  await expect(legal.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/app/terms.html");
  await expect(legal.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/app/privacy.html");
  await expect(legal.getByRole("link", { name: "Support" })).toHaveAttribute("href", "/app/support.html");
});
