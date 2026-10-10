/**
 * What the mock oral (the planner's app.oral) is asked with: the
 * student's flight in a few plain lines, from what the briefing already
 * holds, and the ACS elements to examine -- the codes on their knowledge
 * test report first, then the cross-country elements an examiner asks a
 * private pilot applicant about on the planned flight.
 */
import type { AcsTable } from "./checkride";
import { lookUp } from "./checkride";
import { grouped } from "./units";

export interface PlanFacts {
  route: { ident: string; name?: string | null; airspaceClass?: string | null; patternFt?: number | null; runway?: string | null }[];
  aircraft?: string | null;
  cruiseFt?: number | null;
  distanceNm?: number | null;
  eteMin?: number | null;
  fuelGal?: number | null;
  reserveMin?: number | null;
  night?: boolean | null;
  depart?: string | null;
  metars: { ident: string; raw: string }[];
  destinationForecast?: string | null;
  hazards: string[];
  specialUse: string[];
  tfrs: number;
}

const ft = (n: number) => `${grouped(n)} ft`;

/** The flight as the examiner is told it: a line a fact, nothing it
 *  cannot be told plainly. */
export function planFacts(f: PlanFacts): string {
  const lines: string[] = [];
  lines.push(`Route: ${f.route.map(a => a.ident + (a.name ? ` (${a.name})` : "")).join(" to ")}.`);
  for (const a of f.route) {
    const bits = [
      a.airspaceClass && `Class ${a.airspaceClass} at the surface`,
      a.patternFt != null && `pattern altitude ${ft(a.patternFt)}`,
      a.runway && `runway ${a.runway} favoured by the wind`,
    ].filter(Boolean);
    if (bits.length) lines.push(`${a.ident}: ${bits.join(", ")}.`);
  }
  const plan = [
    f.aircraft && `Aircraft: ${f.aircraft}`,
    f.cruiseFt != null && `cruise ${ft(f.cruiseFt)}`,
    f.distanceNm != null && `${Math.round(f.distanceNm)} nm`,
    f.eteMin != null && `${Math.floor(f.eteMin / 60)} h ${Math.round(f.eteMin % 60)} min en route`,
    f.fuelGal != null && `${f.fuelGal.toFixed(1)} gal planned`,
    f.reserveMin != null && `${Math.round(f.reserveMin)}-minute reserve`,
  ].filter(Boolean);
  if (plan.length) lines.push(`${plan.join(", ")}.`);
  if (f.depart || f.night != null) lines.push(`Departing ${f.depart ?? "now"}${f.night ? ", part of the flight at night" : ""}.`);
  for (const m of f.metars) lines.push(`METAR ${m.ident}: ${m.raw}`);
  if (f.destinationForecast) lines.push(`Destination forecast: ${f.destinationForecast}.`);
  if (f.hazards.length) lines.push(`Adverse conditions along the route: ${f.hazards.join("; ")}.`);
  if (f.specialUse.length) lines.push(`Special-use airspace crossed: ${f.specialUse.join("; ")}.`);
  if (f.tfrs) lines.push(`${f.tfrs} TFR${f.tfrs === 1 ? "" : "s"} near the route.`);
  return lines.join("\n").slice(0, 6000);
}

/** The tasks a cross-country's oral is about: weather, cross-country
 *  planning, the airspace, performance, human factors, navigation. */
const CROSS_COUNTRY = ["PA.I.C", "PA.I.D", "PA.I.E", "PA.I.F", "PA.I.H", "PA.VI.A", "PA.VI.B", "PA.VI.C"];

/**
 * The elements for the next question, three to choose from: of the
 * student's knowledge-test codes not yet asked, else of the cross-country
 * tasks' knowledge and risk elements not yet asked, at random -- each
 * with its words, as the ACS gives them.
 */
export function nextFocus(table: AcsTable, testCodes: string[], asked: string[], random = Math.random): { code: string; text: string }[] {
  const words = (code: string) => {
    const found = lookUp(table, code);
    return found ? `${found.task}${found.element ? `: ${found.element}` : ""}` : null;
  };
  const fresh = (codes: string[]) => codes.filter(c => !asked.includes(c) && words(c));
  let pool = fresh(testCodes);
  if (pool.length === 0) {
    pool = fresh(Object.keys(table.elements).filter(c => CROSS_COUNTRY.some(t => c.startsWith(`${t}.`)) && /\.[KR]\d+$/.test(c)));
  }
  if (pool.length === 0) pool = fresh(Object.keys(table.elements).filter(c => c.startsWith("PA.")));
  const chosen: string[] = [];
  while (chosen.length < 3 && pool.length) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  return chosen.map(code => ({ code, text: words(code)!.slice(0, 400) }));
}
