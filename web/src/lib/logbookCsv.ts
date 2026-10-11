import type { LogbookEntry, LogbookEntryRequest } from "./api/types";

/**
 * The logbook as a CSV file, out and in: out in columns named as
 * ForeFlight's logbook template names its own where it has one, so a
 * spreadsheet or another logbook reads them; in from that file again, or
 * from ForeFlight's own export -- an Aircraft Table, then a Flights Table,
 * each a row of formats over a row of field names (ForeFlight Logbook
 * Guide v14.0, "ForeFlight Template") -- its names read whatever their
 * spaces or case ("Total Time", "TotalTime").
 *
 * What ForeFlight keeps that this logbook does not (times out and in,
 * Hobbs and tach, people) is left; what it keeps apart this logbook keeps
 * together: its actual and simulated instrument as the instrument time,
 * its approaches' counts as the approaches, its holds as holding, and its
 * landings as day landings (all of them, which 61.57(a) counts by day or
 * night) beside the night full-stop ones (61.57(b)).
 */

/** RFC 4180's CSV: commas, quotes doubled inside quotes, and a quoted
 *  field's own commas and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const cell = (value: string | number | boolean | null | undefined) => {
  const text = value == null ? "" : typeof value === "boolean" ? (value ? "x" : "") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The columns written, ForeFlight's names where it has the field. */
const OUT: [string, (e: LogbookEntry) => string | number | boolean | null | undefined][] = [
  ["Date", e => e.flownOn],
  ["AircraftID", e => e.aircraft],
  ["TypeCode", e => e.aircraftType],
  ["Route", e => e.route],
  ["TotalTime", e => e.totalHours],
  ["Night", e => e.nightHours],
  ["CrossCountry", e => e.crossCountryHours],
  ["Solo", e => e.soloHours],
  ["DualReceived", e => e.dualHours],
  ["Instrument", e => e.instrumentHours],
  ["AllLandings", e => e.dayLandings + e.nightLandings],
  ["NightLandingsFullStop", e => e.nightLandings],
  ["ToweredLandings", e => e.toweredLandings],
  ["Distance", e => e.distanceNm],
  ["LongestLeg", e => e.longestLegNm],
  ["Approaches", e => e.approaches],
  ["Holds", e => (e.holding ? 1 : 0)],
  ["Tracking", e => e.tracking],
  ["PilotComments", e => e.remarks],
];

/** The logbook as a CSV file, oldest flight first. */
export function logbookCsv(entries: LogbookEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.flownOn.localeCompare(b.flownOn));
  return [OUT.map(([name]) => name), ...sorted.map(e => OUT.map(([, of]) => of(e)))]
    .map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A field's name as compared: "Total Time" and "TotalTime" are one. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface Imported {
  entries: LogbookEntryRequest[];
  /** Rows left out, each by its line in the file and why. */
  skipped: { line: number; reason: string }[];
}

const hours = (v: string | undefined) => {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
};
const count = (v: string | undefined) => {
  const n = Number.parseInt((v ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const truthy = (v: string | undefined) => !!v && !/^(|0|false|no|n)$/i.test(v.trim());

/** A date as ForeFlight writes it (2002-01-02), or as a spreadsheet may
 *  have turned it (1/2/2002); null for neither. */
function dateOf(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return us ? `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}` : null;
}

/** The header row of a table: the first row from `from` with all of these. */
function headerRow(rows: string[][], from: number, ...names: string[]): number {
  for (let i = from; i < rows.length; i++) {
    const keys = rows[i]!.map(key);
    if (names.every(n => keys.includes(n))) return i;
  }
  return -1;
}

/** A logbook CSV read: ForeFlight's, or this logbook's own. */
export function importLogbook(text: string): Imported {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  // ForeFlight's Aircraft Table: each tail's type code.
  const types = new Map<string, string>();
  const aircraftAt = headerRow(rows, 0, "aircraftid", "typecode", "make");
  const flightsAt = headerRow(rows, aircraftAt + 1, "date", "aircraftid", "totaltime");
  if (aircraftAt >= 0 && (flightsAt < 0 || aircraftAt < flightsAt)) {
    const names = rows[aircraftAt]!.map(key);
    for (let i = aircraftAt + 1; i < (flightsAt < 0 ? rows.length : flightsAt); i++) {
      const row = rows[i]!;
      const tail = row[names.indexOf("aircraftid")]?.trim();
      const type = row[names.indexOf("typecode")]?.trim();
      if (tail && type && tail.toLowerCase() !== "text") types.set(tail, type);
    }
  }
  if (flightsAt < 0) return { entries: [], skipped: [{ line: 1, reason: "No row of field names with Date, AircraftID and TotalTime" }] };
  const names = rows[flightsAt]!.map(key);
  const at = (row: string[], name: string) => {
    const i = names.indexOf(name);
    return i < 0 ? undefined : row[i];
  };
  const entries: LogbookEntryRequest[] = [];
  const skipped: Imported["skipped"] = [];
  for (let i = flightsAt + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.every(c => !c.trim())) continue;
    const line = i + 1;
    const flownOn = dateOf(at(row, "date"));
    if (!flownOn) {
      skipped.push({ line, reason: `No date ("${at(row, "date") ?? ""}")` });
      continue;
    }
    const total = hours(at(row, "totaltime"));
    if (total > 24) {
      skipped.push({ line, reason: `${total} hours is more than a day: a summary entry, to log as its flights` });
      continue;
    }
    const tail = (at(row, "aircraftid") ?? "").trim();
    const route = [at(row, "from"), at(row, "route"), at(row, "to")].map(s => (s ?? "").trim()).filter(Boolean).join(" ");
    const night = count(at(row, "nightlandingsfullstop"));
    // All its landings, by day or night, as day landings for 61.57(a),
    // the night full-stop ones apart; where it gives no total, its day
    // full-stop ones.
    const all = at(row, "alllandings")?.trim() ? count(at(row, "alllandings")) : count(at(row, "daylandingsfullstop")) + night;
    // ForeFlight's approaches, "count;type;runway;airport;comments" each.
    const approaches = names.includes("approaches")
      ? count(at(row, "approaches"))
      : names.filter(n => /^approach\d+$/.test(n)).reduce((sum, n) => sum + count(row[names.indexOf(n)]?.split(";")[0]), 0);
    entries.push({
      flownOn,
      aircraft: tail.slice(0, 16) || null,
      aircraftType: ((at(row, "typecode") ?? types.get(tail) ?? "").trim().slice(0, 16)) || null,
      route: route.slice(0, 120) || null,
      totalHours: total,
      nightHours: hours(at(row, "night")),
      crossCountryHours: hours(at(row, "crosscountry")),
      dayLandings: Math.max(0, all - night),
      nightLandings: night,
      remarks: (at(row, "pilotcomments") ?? "").trim().slice(0, 500) || null,
      dualHours: hours(at(row, "dualreceived")),
      soloHours: hours(at(row, "solo")),
      instrumentHours: names.includes("instrument")
        ? hours(at(row, "instrument"))
        : Math.round((hours(at(row, "actualinstrument")) + hours(at(row, "simulatedinstrument"))) * 10) / 10,
      toweredLandings: count(at(row, "toweredlandings")),
      distanceNm: hours(at(row, "distance")),
      longestLegNm: hours(at(row, "longestleg")),
      approaches,
      holding: count(at(row, "holds")) > 0,
      tracking: truthy(at(row, "tracking")),
    });
  }
  return { entries, skipped };
}
