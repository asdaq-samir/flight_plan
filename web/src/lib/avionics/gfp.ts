import type { PickedProcedure } from "../procedures";
import { namedPoints, type NamedPoint, type PlanPoint } from "./points";

/**
 * A GTN flight plan (.gfp), to Garmin's "Guideline for GTN Flight Plan and
 * User Waypoint Files" (190-01007-F0 Rev 1), which the GTN 650/750 and GTN
 * Xi (software 5.10 on) import from an FPL folder on a FAT32 SD card. One
 * line, "FPN/RI" and then its elements, of capitals, figures and
 * ":(),." only:
 *
 * - each waypoint ":F:" and its identifier with its place, which tells
 *   the GTN which of two of a name is meant (2.4.1);
 * - a checkpoint at its place alone, a user waypoint the GTN matches to
 *   one it holds or names itself (2.4.2);
 * - an airway as its entry, ".V191.", and its exit, the fixes between
 *   left to the GTN's database; airways one after another chained (2.4.3);
 * - at most one departure, arrival and approach (2.3): ":DA:" with ":D:"
 *   and ":R:", ":AA:" with ":A:" and ":AP:", the airport then not a
 *   waypoint of its own.
 *
 * No altitudes: the format has none.
 */

/** Degrees and tenths of a minute as the GTN writes a place: N44546 is
 *  44° 54.6' N; W123001 is 123° 0.1' W (2.4.1). */
export function gtnPlace(lat: number, lon: number): string {
  const part = (value: number, degreeDigits: number, positive: string, negative: string) => {
    const tenths = Math.round(Math.abs(value) * 600);
    const degrees = Math.floor(tenths / 600);
    return `${value < 0 ? negative : positive}${String(degrees).padStart(degreeDigits, "0")}${String(tenths % 600).padStart(3, "0")}`;
  };
  return `${part(lat, 2, "N", "S")}${part(lon, 3, "E", "W")}`;
}

/** The procedures of the route the GTN can load: a departure at the
 *  departure, an arrival and an approach at the destination, and the
 *  runways the pilot picked for the takeoff and the landing. */
export interface GtnProcedures {
  departure?: PickedProcedure | null;
  arrival?: PickedProcedure | null;
  approach?: PickedProcedure | null;
  /** The runway taken off from at the departure ("27L"). */
  takeoffRunway?: string | null;
  /** The runway landed on at the destination, where no approach says. */
  landingRunway?: string | null;
}

/** An approach's identifier as the CIFP codes it ("I30L", "R12LZ",
 *  "I35-Z", "VDM-A"; vfr.procedures), as the GTN takes it (2.3.3): the
 *  type's letter and the runway, or a circling approach's own four
 *  letters. A Y or Z variant goes without its letter, which the format
 *  has no place for; the pilot checks the one loaded, as Garmin asks of
 *  every import. Null where the GTN has no code for it. */
const STRAIGHT_IN = /^([A-Z])(\d{2})([LRC])?(?:-?([A-Z]))?$/;
const CIRCLING = /^([A-Z]{3})-[A-Z]$/;

export function gtnApproach(id: string): string | null {
  const straight = STRAIGHT_IN.exec(id);
  if (straight) return `${straight[1]}${straight[2]}${straight[3] ?? ""}`;
  const circling: Record<string, string> = { VOR: "CVOR", VDM: "CVDM", NDB: "CNDB", NDM: "CNDM", GPS: "GPSC" };
  const m = CIRCLING.exec(id);
  return m && circling[m[1]!] ? circling[m[1]!]! : null;
}

/** Whether a procedure picked at a field is an approach, not a SID or a
 *  STAR (a name of letters and a figure, "BAINY4"). */
export const isApproach = (id: string) => STRAIGHT_IN.test(id) || CIRCLING.test(id);

/** A runway as the GTN writes it: two figures and L, R, C, or O for none
 *  (2.3.1). */
export function gtnRunway(end: string | null | undefined): string | null {
  const m = /^(\d{1,2})([LRC]?)$/.exec((end ?? "").toUpperCase());
  return m ? `${m[1]!.padStart(2, "0")}${m[2] || "O"}` : null;
}

export interface Gfp {
  text: string;
  /** The route's waypoints, an airway's fixes among them as the GTN fills
   *  them in: past PANEL_MAX_POINTS a GTN cuts it. */
  waypoints: number;
  /** A procedure picked the GTN has no code for, left out. */
  leftOut: string[];
}

export function gfpOf(points: PlanPoint[], procedures: GtnProcedures = {}): Gfp {
  const named = namedPoints(points);
  const elements: string[] = [];
  const leftOut: string[] = [];
  const { departure, arrival, approach } = procedures;
  const approachCode = approach ? gtnApproach(approach.id) : null;
  if (approach && !approachCode) leftOut.push(approach.id);

  const first = departure ? 1 : 0;
  const last = arrival || approachCode ? named.length - 1 : named.length;
  if (departure && named[0]) {
    const runway = gtnRunway(procedures.takeoffRunway);
    elements.push(`DA:${named[0].id}`, `D:${departure.id}${departure.transition ? `.${departure.transition}` : ""}`);
    if (runway) elements.push(`R:${runway}`);
  }
  const at = (p: NamedPoint) => (p.type === "USER WAYPOINT" ? gtnPlace(p.lat, p.lon) : `${p.id},${gtnPlace(p.lat, p.lon)}`);
  for (let i = first; i < last; i += 1) {
    const p = named[i]!;
    // An airway entered here: its fixes up to its exit, and any airway
    // after it chained on (2.4.3).
    let chain = at(p);
    let j = i;
    let along: string | null = null;
    while (j + 1 < last && named[j + 1]!.airway && named[j + 1]!.type !== "USER WAYPOINT") {
      const next = named[j + 1]!;
      if (next.airway !== along) {
        chain += `.${next.airway}.`;
        along = next.airway!;
      } else {
        chain = chain.slice(0, chain.lastIndexOf(".") + 1);
      }
      chain += `${next.id},${gtnPlace(next.lat, next.lon)}`;
      j += 1;
    }
    elements.push(`F:${chain}`);
    i = j;
  }
  const end = named.at(-1);
  if ((arrival || approachCode) && end) {
    elements.push(`AA:${end.id}`);
    if (arrival) {
      const runway = gtnRunway(approachCode ? /\d{2}[LRC]?/.exec(approachCode)?.[0] : procedures.landingRunway);
      elements.push(`A:${arrival.id}${arrival.transition ? `.${arrival.transition}` : ""}${runway ? `(${runway})` : ""}`);
    }
    if (approachCode && approach) elements.push(`AP:${approachCode}${approach.transition ? `.${approach.transition}` : ""}`);
  }
  return { text: `FPN/RI:${elements.join(":")}`, waypoints: named.length, leftOut };
}
