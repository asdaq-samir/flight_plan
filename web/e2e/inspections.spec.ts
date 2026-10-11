import { test, expect } from "@playwright/test";
import { library } from "./helpers";

/**
 * An airplane's inspections and tests in its form (the Library's
 * Aircraft): each recorded date with the last day it is good for -- the
 * annual's past due -- the 100-hour by hours, and the whole saved
 * together. The webapp's answers are stubbed: the calendar months are
 * AircraftControllerTest's, and what the risk assessment makes of them
 * airworthiness.test's.
 */
test("an airplane's inspections say how long each is good for, and are saved together", async ({ page }) => {
  const plane = {
    id: 5, tailNumber: "N12345", typeDesignator: "C172", cruiseTasKt: 110, fuelBurnGph: 8.5, cruisePowerPct: null,
    climbTasKt: null, climbFuelBurnGph: null, usableFuelGal: 40, createdAt: "2026-01-01T00:00:00Z", vorCheck: null,
    inspections: {
      annualOn: "2020-01-15", annualGoodThrough: "2021-01-31",
      hundredHourAtHours: 1200.5, hoursNow: 1250, hundredHourDueAtHours: 1300.5,
      staticCheckOn: null, staticCheckGoodThrough: null, transponderCheckOn: null, transponderCheckGoodThrough: null,
      eltInspectedOn: "2026-02-01", eltInspectionGoodThrough: "2099-02-28", eltBatteryDueOn: "2099-06-01",
    },
  };
  const saved: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === "/api/aircraft", route => route.fulfill({ json: [plane] }));
  await page.route(url => url.pathname === "/api/aircraft/5/inspections", async route => {
    saved.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: plane });
  });
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await library(console, "Aircraft");
  await console.getByRole("button", { name: "Edit N12345" }).click();
  await expect(page.getByTestId("inspection-annualOn")).toHaveText("Past due since 2021-01-31");
  await expect(page.getByTestId("inspection-eltInspectedOn")).toHaveText("To 2099-02-28");
  await expect(page.getByTestId("inspection-eltBattery")).toHaveText("By 2099-06-01");
  await expect(page.getByTestId("inspection-hundredHour")).toHaveText(", 50.5 h to go");

  await page.getByTestId("inspection-annualOn-date").fill("2026-09-20");
  await page.getByTestId("inspection-transponderCheckOn-date").fill("2025-03-02");
  await page.getByTestId("inspection-hoursNow").fill("1262.3");
  await page.getByTestId("inspections-save").click();
  await expect.poll(() => saved.at(-1)).toMatchObject({
    annualOn: "2026-09-20", transponderCheckOn: "2025-03-02", hoursNow: 1262.3, hundredHourAtHours: 1200.5,
    eltInspectedOn: "2026-02-01", eltBatteryDueOn: "2099-06-01", staticCheckOn: null,
  });
});

test("an airplane's checklist is written from its flight manual, then run item by item", async ({ page }) => {
  const plane = {
    id: 5, tailNumber: "N12345", typeDesignator: "C172", cruiseTasKt: 110, fuelBurnGph: 8.5, cruisePowerPct: null,
    climbTasKt: null, climbFuelBurnGph: null, usableFuelGal: 40, createdAt: "2026-01-01T00:00:00Z", vorCheck: null,
    inspections: {
      annualOn: null, annualGoodThrough: null, hundredHourAtHours: null, hoursNow: null, hundredHourDueAtHours: null,
      staticCheckOn: null, staticCheckGoodThrough: null, transponderCheckOn: null, transponderCheckGoodThrough: null,
      eltInspectedOn: null, eltInspectionGoodThrough: null, eltBatteryDueOn: null,
    },
  };
  let checklist: { sections: unknown[] } = { sections: [] };
  await page.route(url => url.pathname === "/api/aircraft", route => route.fulfill({ json: [plane] }));
  await page.route(url => url.pathname === "/api/aircraft/5/checklist", async route => {
    if (route.request().method() === "PUT") checklist = route.request().postDataJSON() as typeof checklist;
    await route.fulfill({ json: checklist });
  });
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await library(console, "Aircraft");
  await console.getByRole("button", { name: "Edit N12345" }).click();
  await page.getByRole("button", { name: /^Checklist/ }).click();
  await expect(console).toContainText("No checklist yet");
  await console.getByTestId("checklist-edit").click();
  await console.getByTestId("checklist-text").fill("# Before takeoff\nFuel selector -- Both\nMixture ..... Rich");
  await console.getByTestId("checklist-save").click();
  await expect.poll(() => checklist.sections).toEqual([{
    title: "Before takeoff", items: [{ challenge: "Fuel selector", response: "Both" }, { challenge: "Mixture", response: "Rich" }],
  }]);
  const items = console.getByTestId("checklist-item");
  await expect(items).toHaveCount(2);
  await items.first().click();
  await expect(items.first()).toHaveAttribute("aria-checked", "true");
  await expect(console).toContainText("1 of 2");
  await console.getByTestId("checklist-reset").click();
  await expect(items.first()).toHaveAttribute("aria-checked", "false");
});
