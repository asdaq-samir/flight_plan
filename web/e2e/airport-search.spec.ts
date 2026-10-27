import { test, expect, type Locator, type Page } from "@playwright/test";
import { openPanel, sideDrawer, slow } from "./helpers";

/**
 * The route picker's search: Enter takes a row only when the rows answer
 * what is in the box. The lookup is held, so the box runs ahead of it
 * the way it does on a slow link -- the planner's lookup, as before the
 * phone has its own copy of the search (lib/airportIndex), which these
 * keep from it: with the copy in, the rows answer the box at once
 * (places.spec).
 */

const airport = (ident: string, name: string) => ({ ident, name, municipality: null, region: "US-MN" });

/** The route's destination changed: from its pill's menu, a tap on it
 *  opening the airport's card (RouteBox). */
async function changeDestination(page: Page) {
  await page.getByLabel("Destination", { exact: true }).click({ button: "right" });
  await page.getByTestId("pill-menu-change").click();
}

async function slowSearch(page: Page, heldFor: string) {
  await page.route(url => url.pathname.endsWith("/airports/index"), route => route.fulfill({ status: 503, body: "" }));
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
  await openPanel(page);
  const destination = page.getByLabel("Destination", { exact: true });
  await changeDestination(page);
  const box = page.getByPlaceholder("Search for a destination");
  await box.fill("KD");
  await expect(page.getByRole("option", { name: /KDAA/ })).toBeVisible();

  await box.pressSequentially("LH");
  await box.press("Enter");
  await expect(destination).toContainText("KDLH");
});

test("once the rows answer the box, Enter takes the highlighted row", async ({ page }) => {
  await slowSearch(page, "");
  await page.goto("/app/plan?dep=C81&dest=KMSP");
  await openPanel(page);
  const destination = page.getByLabel("Destination", { exact: true });
  await changeDestination(page);
  const box = page.getByPlaceholder("Search for a destination");
  await box.fill("KD");
  await expect(page.getByRole("option", { name: /KDAA/ })).toBeVisible();
  await expect(page.getByRole("listbox")).not.toHaveAttribute("aria-busy", "true");

  await box.press("Enter");
  await expect(destination).toContainText("KDAA");
});

/** How a search's row is drawn: its height, its ident's weight, its two
 *  lines' sizes and the town's grey. */
const rowLook = (row: Locator) => row.evaluate(el => {
  const lines = [...el.querySelectorAll<HTMLElement>("span.block")];
  const ident = el.querySelector<HTMLElement>(".font-mono")!;
  return {
    height: Math.round(el.getBoundingClientRect().height),
    ident: getComputedStyle(ident).fontWeight,
    lines: lines.length,
    name: getComputedStyle(lines[0]!).fontSize,
    town: lines[1] ? [getComputedStyle(lines[1]).fontSize, getComputedStyle(lines[1]).color] : null,
  };
});

test("the route box's suggestions are the airport search's own rows, the typing kept in the box", async ({ page }, info) => {
  // One list for both (AirportResults): the route box's was a short list
  // of its own under the box, 288 tall at the most.
  test.skip(info.project.name !== "mobile", "judged as a phone");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await openPanel(page);
  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  const field = sideDrawer(page).getByTestId("route-type");
  await field.fill("madison");
  const suggestions = page.getByTestId("route-suggestions");
  const typedRow = suggestions.getByTestId("airport-result").filter({ hasText: "KMSN" }).first();
  await expect(typedRow).toBeVisible({ timeout: slow(10000) });
  await expect(suggestions.getByText("Airports", { exact: true })).toBeVisible();
  // The typing stays in the box: nothing took its focus.
  await expect(field).toBeFocused();
  const inBox = await rowLook(typedRow);
  // Two lines, 52 tall at the least, the ident in bold, the town in the grey.
  expect(inBox.lines).toBe(2);
  expect(inBox.height).toBeGreaterThanOrEqual(52);
  expect(inBox.ident).toBe("700");

  // The airport picker's row for the same airport, drawn the same.
  await page.goto("/app/plan?dep=C81&dest=KMSP");
  await openPanel(page);
  await changeDestination(page);
  await page.getByPlaceholder("Search for a destination").fill("madison");
  const pickerRow = page.getByTestId("airport-result").filter({ hasText: "KMSN" }).first();
  await expect(pickerRow).toBeVisible({ timeout: slow(10000) });
  expect(await rowLook(pickerRow)).toEqual(inBox);

  // Picked from the box's list, it is the stop.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await openPanel(page);
  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  await sideDrawer(page).getByTestId("route-type").fill("madison");
  await page.getByTestId("route-suggestions").getByTestId("airport-result").filter({ hasText: "KMSN" }).first().click();
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
});
