import { describe, expect, it } from "vitest";
import type { LogbookEntry } from "./api/types";
import { importLogbook, logbookCsv, parseCsv } from "./logbookCsv";
import logbookFixture from "./fixtures/logbookCsv.json";

/** ForeFlight's export as its guide lays the template out (ForeFlight
 *  Logbook Guide v14.0): a line it asks be kept, the Aircraft Table and
 *  the Flights Table, each a row of formats over a row of field names. */
const FOREFLIGHT = [
  "ForeFlight Logbook Import,This row is required for importing into ForeFlight. Do not delete or modify.",
  "",
  "Aircraft Table,,,,,,,,,,,,,",
  "Text,Text,Text,YYYY,Text,Text,Text,Text,Text,Text,Boolean,Boolean,Boolean,Boolean",
  "AircraftID,EquipmentType,TypeCode,Year,Make,Model,Category,Class,GearType,EngineType,Complex,HighPerformance,Pressurized,TAA",
  "N201TH,Aircraft,C172,2019,Cessna,172,Airplane,ASEL,FT,Piston,,,,",
  "N54321,Aircraft,PA28,1979,Piper,PA-28-181,Airplane,ASEL,FT,Piston,,,,",
  "",
  "Flights Table,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
  "Date,Text,Text,Text,Text,hhmm,hhmm,hhmm,hhmm,hhmm,hhmm,Decimal,Decimal,Decimal,Decimal,Decimal,Decimal,Decimal,Number,Decimal,Number,Number,Number,Number,Number,Decimal,Decimal,Number,Packed Detail,Packed Detail,Decimal,Decimal,Text",
  "Date,AircraftID,From,To,Route,TimeOut,TimeOff,TimeOn,TimeIn,OnDuty,OffDuty,TotalTime,PIC,SIC,Night,Solo,CrossCountry,NVG,NVGOps,Distance,DayTakeoffs,DayLandingsFullStop,NightTakeoffs,NightLandingsFullStop,AllLandings,ActualInstrument,SimulatedInstrument,Holds,Approach1,Approach2,DualGiven,DualReceived,PilotComments",
  '2026-09-12,N201TH,KBVU,KVGT,KCDC 67L,,,,,,,3.6,3.6,,1.2,,3.6,,,135.0,2,2,1,1,4,0.8,0.5,1,1;ILS;12L;KVGT;Broke out at 350 AGL,2;RNAV (GPS);30;KBVU;,0.0,0.0,"Night XC, ""hood"" back"',
  "2026-09-20,N54321,C81,C81,,,,,,,,1.1,1.1,,,,,,,,3,3,,,,,,,,,,1.1,",
  ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
  "2026-09-21,N54321,C81,KDLH,,,,,,,,1500.0,,,,,,,,,,,,,,,,,,,,,Catch-up entry",
  "not a date,N54321,C81,KDLH,,,,,,,,1.0,,,,,,,,,,,,,,,,,,,,,",
].join("\r\n");

describe("the logbook as CSV", () => {
  it("reads quoted fields, their doubled quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","d ""e""",\r\n"f\ng",h')).toEqual([["a", "b, c", 'd "e"', ""], ["f\ng", "h"]]);
  });

  it("reads ForeFlight's export: its types from the Aircraft Table, its approaches, holds and landings ours", () => {
    const { entries, skipped } = importLogbook(FOREFLIGHT);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      flownOn: "2026-09-12", aircraft: "N201TH", aircraftType: "C172", route: "KBVU KCDC 67L KVGT",
      totalHours: 3.6, nightHours: 1.2, crossCountryHours: 3.6, distanceNm: 135,
      // Four landings, one a full stop at night: three by day for 61.57(a).
      dayLandings: 3, nightLandings: 1,
      instrumentHours: 1.3, approaches: 3, holding: true, tracking: false,
      remarks: 'Night XC, "hood" back',
    });
    expect(entries[1]).toMatchObject({ aircraftType: "PA28", route: "C81 C81", dualHours: 1.1, dayLandings: 3, approaches: 0, holding: false });
    expect(skipped).toEqual([
      { line: 15, reason: "1500 hours is more than a day: a summary entry, to log as its flights" },
      { line: 16, reason: 'No date ("not a date")' },
    ]);
  });

  it("writes its own, oldest first, and reads it back as it was", () => {
    const entry = (over: Partial<LogbookEntry>): LogbookEntry => ({
      id: 1, flownOn: "2026-10-01", aircraft: "N12345", aircraftType: "C172", route: "C81 KDLH", totalHours: 3.4, nightHours: 0.5,
      crossCountryHours: 3.4, dayLandings: 2, nightLandings: 1, remarks: "Smooth, then \"bumpy\"", dualHours: 0, soloHours: 3.4,
      instrumentHours: 0.3, toweredLandings: 1, distanceNm: 230, longestLegNm: 230, approaches: 2, holding: true, tracking: true,
      createdAt: "2026-10-01T20:00:00Z", ...over,
    } as LogbookEntry);
    const written = logbookCsv([entry({}), entry({ id: 2, flownOn: "2026-09-01", route: null, remarks: null, holding: false, tracking: false })]);
    expect(written.split("\r\n")[0]).toBe("Date,AircraftID,TypeCode,Route,TotalTime,Night,CrossCountry,Solo,DualReceived,Instrument,AllLandings,NightLandingsFullStop,ToweredLandings,Distance,LongestLeg,Approaches,Holds,Tracking,PilotComments");
    const { entries, skipped } = importLogbook(written);
    expect(skipped).toEqual([]);
    expect(entries.map(e => e.flownOn)).toEqual(["2026-09-01", "2026-10-01"]);
    const asLogged = Object.fromEntries(Object.entries(entry({})).filter(([k]) => k !== "id" && k !== "createdAt"));
    expect(entries[1]).toEqual(asLogged);
    expect(entries[0]).toMatchObject({ route: null, remarks: null, holding: false, tracking: false });
  });

  it("says so when there is no flights' header", () => {
    expect(importLogbook("a,b\n1,2").skipped[0]!.reason).toContain("Date, AircraftID and TotalTime");
  });
});

// The shared fixture the iPhone app's LogbookCSV (PilotLogic.swift) is
// tested against too (WingtipTests/SharedFixturesTests.swift): a logbook
// written or read on either comes out the same (docs/NATIVE.md).
describe("the shared logbook CSV fixture", () => {
  it.each(logbookFixture.export.map((c, i) => ({ ...c, i })))("written out, case $i", ({ entries, csv }) => {
    expect(logbookCsv(entries as unknown as LogbookEntry[])).toBe(csv);
  });

  it.each(logbookFixture.import)("$name", ({ text, entries, skipped }) => {
    expect(importLogbook(text)).toEqual({ entries, skipped });
  });
});
