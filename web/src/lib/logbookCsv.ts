import type { LogbookEntry, LogbookEntryRequest } from "./api/types";
import { callEngine } from "./engine/engine";

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
 *
 * Read and written by the shared engine (native/engine/src/pilot/
 * logbook.rs and csv.rs, papaparse's reading of CSV ported step for
 * step, through lib/engine), the code the iPhone app reads a logbook
 * file with too: the rules live there.
 */

/** RFC 4180's CSV, papaparse's reading of it: commas (or the delimiter
 *  the first rows show), quotes doubled inside quotes, and a quoted
 *  field's own commas and line breaks; a row to each record, empty ones
 *  kept so a row's place is its line. */
export function parseCsv(text: string): string[][] {
  return callEngine<string[][]>("csv_rows", { text });
}

/** The logbook as a CSV file, oldest flight first, in ForeFlight's
 *  column names where it has the field. */
export function logbookCsv(entries: LogbookEntry[]): string {
  return callEngine<string>("logbook_csv_write", { entries });
}

export interface Imported {
  entries: LogbookEntryRequest[];
  /** Rows left out, each by its line in the file and why. */
  skipped: { line: number; reason: string }[];
}

/** A logbook CSV read: ForeFlight's, or this logbook's own. */
export function importLogbook(text: string): Imported {
  return callEngine<Imported>("logbook_csv_read", { text });
}
