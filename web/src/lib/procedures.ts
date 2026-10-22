import type { ProcedureFix, ProcedureList } from "./api/types";
import { altFt } from "./units";

/** An instrument procedure picked at a field of the route (the route's
 *  Procedures): the field, the procedure's coded identifier ("I08-Y"),
 *  and its transition -- none for an approach from vectors, or an
 *  arrival's or departure's common route alone. */
export interface PickedProcedure {
  ident: string;
  id: string;
  transition: string | null;
  /** A fix of it ATC sent the airplane direct to, at the owner's ask ("the
   *  ability to go direct to a fix as told by ATC"): the procedure flown
   *  from there (vfr.procedure_paths). */
  direct?: string | null;
}

/** A procedure's fix as its branch in FPL's list (FixBranch) and its card
 *  (FixCard) show it: the drawing's, and whether the chart puts a
 *  procedure turn at it. */
export type BranchFix = Pick<ProcedureFix, "ident" | "roles" | "min_ft" | "max_ft"> & { turn?: boolean };

/** The parts a fix plays, as a chart names them, its hold left to the line. */
export const fixRoles = (fix: BranchFix) => [...fix.roles.filter(r => r !== "hold"), ...(fix.turn ? ["↺ procedure turn"] : [])];

/** A transition as a pilot picks it, said one way everywhere (the
 *  menus, the procedure's page, the route's box): an approach's from its
 *  initial fix or from vectors to final; an arrival's from where it
 *  starts, or its common route alone; a departure's to where it ends. */
export function transitionWords(kind: "approach" | "arrival" | "departure", transition: string | null, inLine = false): string {
  const words = transition === null ? (kind === "approach" ? "Vectors to final" : "Common route")
    : kind === "departure" ? `To ${transition}` : `From ${transition}`;
  // In the middle of a line, its first word's capital dropped, the fix's kept.
  return inLine ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

/** The runway an approach lands on, as a pattern's chip names it: "ILS
 *  RWY 09L" is "9L"; a circling-only approach ("VOR-A", "RNAV (GPS)-B")
 *  has none. */
export function approachRunway(name: string): string | null {
  const m = /\bRWY\s*0*(\d{1,2}[LCR]?)\b/i.exec(name);
  return m ? m[1]!.toUpperCase() : null;
}

/** The procedures picked, from the address: "KBUR:I08-Y:LAX,KBUR:JANNY5",
 *  each a field, a procedure and its transition, and after a fourth colon
 *  a fix flown direct to ("KELD:I22::BXCMB"), as the patterns are kept
 *  ("pattern=KDLH:27"). What is not one is left out. */
export function proceduresOf(param: string | null): PickedProcedure[] {
  if (!param) return [];
  return param.split(",").flatMap(part => {
    const [ident, id, transition, direct] = part.split(":").map(s => s.trim().toUpperCase());
    if (!(ident && id && /^[A-Z0-9]{2,5}$/.test(ident) && /^[A-Z0-9-]{1,6}$/.test(id))) return [];
    const picked: PickedProcedure = { ident, id, transition: transition && /^[A-Z0-9]{1,5}$/.test(transition) ? transition : null };
    return [direct && /^[A-Z0-9]{2,5}$/.test(direct) ? { ...picked, direct } : picked];
  });
}

/** A SID's or a STAR's name as a route is written with one -- a
 *  clearance's, a filed flight plan's, ForeFlight's: "KMSP BAEE1 BAE V191
 *  OSH OSHH2 KATW" -- four or five letters and its number. No airport's
 *  identifier is that long and no fix's has a number, so it is neither. */
export const TYPED_PROCEDURE = /^[A-Z]{4,5}\d$/;

/** A procedure typed among a route's points, with the points either side
 *  of it as typed: a departure's transition is the fix after it, an
 *  arrival's the fix before it. */
export interface TypedProcedure {
  name: string;
  before: string | null;
  after: string | null;
}

/** A typed procedure as picked, found where it can be flown: a departure
 *  out of the route's departure, by the fix after it where that is one of
 *  its transitions; else an arrival into the destination, joined at the
 *  fix before it. With the kind, so the field's pick of that kind it
 *  replaces can be found; null where neither field publishes it. */
export async function typedProcedure(
  typed: TypedProcedure, route: { dep: string; dest: string }, list: (ident: string) => Promise<ProcedureList>,
): Promise<{ picked: PickedProcedure; kind: "departure" | "arrival"; list: ProcedureList } | null> {
  const ends = [[route.dep, "departure", typed.after], [route.dest, "arrival", typed.before]] as const;
  for (const [field, kind, join] of ends) {
    if (!field) continue;
    const found = await list(field).catch(() => null);
    const procedure = found?.procedures.find(p => p.kind === kind && p.id === typed.name);
    if (found && procedure) {
      const transition = join && procedure.transitions.includes(join) ? join : null;
      return { picked: { ident: field, id: procedure.id, transition }, kind, list: found };
    }
  }
  return null;
}

/** Whether two idents name one field: the CIFP names it by its ICAO ident
 *  (KBUR) where the route may have the FAA's (BUR). */
export function sameField(a: string, b: string): boolean {
  const bare = (ident: string) => (ident.length === 4 && ident.startsWith("K") ? ident.slice(1) : ident);
  return bare(a.toUpperCase()) === bare(b.toUpperCase());
}

/** The procedures picked, for the address. */
export function proceduresParam(picks: PickedProcedure[]): string {
  return picks.map(p => [p.ident, p.id, ...(p.direct ? [p.transition ?? "", p.direct] : p.transition ? [p.transition] : [])].join(":")).join(",");
}

/** One line of a fix's altitudes as an approach chart sets it (the FAA's
 *  Aeronautical Chart User's Guide, terminal procedures): a minimum
 *  altitude underlined, a maximum one overlined, a mandatory one both. */
export interface AltitudeLine {
  text: string;
  under: boolean;
  over: boolean;
}

/** A fix's crossing altitudes as the chart writes them: one line at or
 *  above, at or below, or at; between two, the higher over the lower --
 *  and in words, for a screen reader. */
export function altitudeLines(fix: Pick<ProcedureFix, "min_ft" | "max_ft">): { lines: AltitudeLine[]; words: string | null } {
  const { min_ft: low, max_ft: high } = fix;
  if (low != null && high != null && low === high) {
    return { lines: [{ text: altFt(low), under: true, over: true }], words: `at ${altFt(low)} ft` };
  }
  if (low != null && high != null) {
    return {
      lines: [{ text: altFt(high), under: false, over: true }, { text: altFt(low), under: true, over: false }],
      words: `between ${altFt(low)} and ${altFt(high)} ft`,
    };
  }
  if (low != null) return { lines: [{ text: altFt(low), under: true, over: false }], words: `at or above ${altFt(low)} ft` };
  if (high != null) return { lines: [{ text: altFt(high), under: false, over: true }], words: `at or below ${altFt(high)} ft` };
  return { lines: [], words: null };
}

/** A fix's speed as the chart words it (ARINC 424-18 5.261): "at" the
 *  speed, or "min" or "max" of it. */
export function speedWords(fix: Pick<ProcedureFix, "speed_kt" | "speed_limit">): string | null {
  if (!fix.speed_kt) return null;
  if (fix.speed_limit === "min") return `${fix.speed_kt} kt min`;
  if (fix.speed_limit === "max") return `${fix.speed_kt} kt max`;
  return `${fix.speed_kt} kt`;
}
