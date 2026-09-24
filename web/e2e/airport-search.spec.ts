import { test, expect, type Page } from "@playwright/test";

/**
 * The route picker's search: Enter takes a row only when the rows answer
 * what is in the box. The lookup is held, so the box runs ahead of it
 * the way it does on a slow link.
 */

const airport = (ident: string, name: string) => ({ ident, name, municipality: null, region: "US-MN" });

async function slowSearch(page: Page, heldFor: string) {
  await page.route("**/airports/search?**", async route => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    if (q.toUpperCase() === heldFor) await new Promise(resolve => setTimeout(resolve, 3000));
    const airports = q.toUpperCase() === "KD"
      ? [airport("KDAA", "First KD field"), airport("KDLH", "Duluth International")]
      : q.toUpperCase().startsWith("KDLH") ? [airport("KDLH", "Duluth International")] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ airports }) });
  });
}

test("Enter before the lookup has answered keeps what was typed, not the first row of an older answer", async ({ page }) => {
  await slowSearch(page, "KDLH");
  await page.goto("/app/plan?dep=C81&dest=KMSP");
  const destination = page.getByLabel("Destination", { exact: true });
  await destination.click();
  const box = page.getByPlaceholder("Ident or airport name");
  await box.fill("KD");
  await expect(page.getByRole("option", { name: /KDAA/ })).toBeVisible();

  await box.pressSequentially("LH");
  await box.press("Enter");
  await expect(destination).toContainText("KDLH");
});

test("once the rows answer the box, Enter takes the highlighted row", async ({ page }) => {
  await slowSearch(page, "");
  await page.goto("/app/plan?dep=C81&dest=KMSP");
  const destination = page.getByLabel("Destination", { exact: true });
  await destination.click();
  const box = page.getByPlaceholder("Ident or airport name");
  await box.fill("KD");
  await expect(page.getByRole("option", { name: /KDAA/ })).toBeVisible();
  await expect(page.getByRole("listbox")).not.toHaveAttribute("aria-busy", "true");

  await box.press("Enter");
  await expect(destination).toContainText("KDAA");
});
