import { test, expect } from "@playwright/test";
import { library, openConsole, showTabs } from "./helpers";

/**
 * The Logbook to and from a file (lib/logbookCsv): ForeFlight's export
 * read on the device and its flights sent together, what was already
 * there and what could not be read said under the rows; and the logbook
 * out as a CSV in ForeFlight's column names. The webapp's answers are
 * stubbed: what it leaves out as already logged is LogbookServiceTest's.
 */
const LOGGED = [{
  id: 3, flownOn: "2026-09-20", aircraft: "N12345", aircraftType: "C172", route: "C81 KDLH", totalHours: 3.4, nightHours: 0,
  crossCountryHours: 3.4, dayLandings: 1, nightLandings: 0, remarks: null, dualHours: 0, soloHours: 3.4, instrumentHours: 0,
  toweredLandings: 1, distanceNm: 230, longestLegNm: 230, approaches: 0, holding: false, tracking: false,
}];

const FOREFLIGHT = [
  "ForeFlight Logbook Import,This row is required for importing into ForeFlight. Do not delete or modify.",
  "Aircraft Table",
  "Text,Text,Text,YYYY,Text,Text",
  "AircraftID,EquipmentType,TypeCode,Year,Make,Model",
  "N201TH,Aircraft,C172,2019,Cessna,172",
  "Flights Table",
  "Date,Text,Text,Text,Text,Decimal,Decimal,Number,Number,Text",
  "Date,AircraftID,From,To,Route,TotalTime,Night,AllLandings,NightLandingsFullStop,PilotComments",
  "2026-09-12,N201TH,KBVU,KVGT,,3.6,1.2,4,1,Night cross-country",
  "2026-09-13,N201TH,KVGT,KBVU,,1.0,,1,,",
  "2026-09-14,N201TH,KBVU,KBVU,,1200,,,,Catch-up",
].join("\n");

test("a ForeFlight logbook is imported, and the logbook exported as CSV", async ({ page }) => {
  const sent: { entries: Record<string, unknown>[] }[] = [];
  await page.route(url => url.pathname === "/api/logbook", route => route.fulfill({ json: LOGGED }));
  await page.route(url => url.pathname === "/api/logbook/import", async route => {
    sent.push(route.request().postDataJSON() as { entries: Record<string, unknown>[] });
    await route.fulfill({ json: { added: 1, duplicates: 1 } });
  });
  await page.goto("/app/plan");
  await showTabs(page);
  await openConsole(page);
  const console = page.getByTestId("console-sheet");
  await library(console, "Logbook");

  await console.getByTestId("logbook-import-file").setInputFiles({ name: "logbook.csv", mimeType: "text/csv", buffer: Buffer.from(FOREFLIGHT) });
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.entries).toHaveLength(2);
  expect(sent[0]!.entries[0]).toMatchObject({ flownOn: "2026-09-12", aircraftType: "C172", dayLandings: 3, nightLandings: 1, remarks: "Night cross-country" });
  await expect(console).toContainText("1 flight added, 1 already in your logbook, 1 row left out (line 11: 1200 hours is more than a day");

  const download = page.waitForEvent("download");
  await console.getByTestId("logbook-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^logbook-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString());
  expect(text.split("\r\n")[1]).toBe("2026-09-20,N12345,C172,C81 KDLH,3.4,0,3.4,3.4,0,0,1,0,1,230,230,0,0,,");
});
