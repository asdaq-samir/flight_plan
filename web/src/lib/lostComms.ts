/**
 * Two-way radio failure under IFR (the roadmap's lost-comms calculator,
 * 14 CFR 91.185, ACS IR.VII.A): the route to fly, the altitude on each
 * segment of it, and when to leave the clearance limit, each worked from
 * the clearance as the rule words it. In VFR conditions there is nothing
 * to work: continue VFR and land as soon as practicable (91.185(b)).
 */

/** 91.185(c)(1): the route, in the rule's order -- the first that applies. */
export const ROUTES = [
  { key: "assigned", label: "Assigned", rule: "The route assigned in the last ATC clearance received." },
  { key: "vectored", label: "Vectored", rule: "Being radar vectored: direct from the point of radio failure to the fix, route or airway specified in the vector clearance." },
  { key: "expected", label: "Expected", rule: "No route assigned: the route ATC has advised may be expected in a further clearance." },
  { key: "filed", label: "Filed", rule: "Neither assigned nor expected: the route filed in the flight plan." },
] as const;

export type RouteKey = (typeof ROUTES)[number]["key"];

export interface Segment {
  name: string;
  /** The minimum altitude for IFR operations on it: the MEA, or an OROCA
   *  or MOCA where the pilot is working off-airway. */
  minimumFt: number | null;
}

export interface Clearance {
  assignedFt: number | null;
  expectedFt: number | null;
  /** The segment the expected altitude applies from ("expect 6,000 ten
   *  minutes after departure" is from where the aeroplane is then): its
   *  index; before it, only the assigned and the minimum count. */
  expectedFrom: number;
}

export type Because = "assigned" | "minimum" | "expected";

/** 91.185(c)(2): on each segment, the highest of the altitude assigned,
 *  the minimum for IFR operations, and the altitude ATC said to expect --
 *  and which it was. Null where none is known. */
export function segmentAltitudes(segments: Segment[], c: Clearance): { name: string; fly: number | null; because: Because | null }[] {
  return segments.map((s, i) => {
    const candidates: [number | null, Because][] = [
      [c.assignedFt, "assigned"], [s.minimumFt, "minimum"], [i >= c.expectedFrom ? c.expectedFt : null, "expected"],
    ];
    const known = candidates.filter((x): x is [number, Because] => x[0] != null);
    if (!known.length) return { name: s.name, fly: null, because: null };
    const [fly, because] = known.reduce((a, b) => (b[0] > a[0] ? b : a));
    return { name: s.name, fly, because };
  });
}

/** 91.185(c)(3): when to leave the clearance limit, in words. */
export function leaveLimit(approachFix: boolean, efc: string, eta: string): string {
  if (approachFix) {
    return efc
      ? `Hold at the clearance limit, and begin the descent or the approach as close as possible to the expect-further-clearance time, ${efc}.`
      : `Begin the descent or the approach as close as possible to your estimated time of arrival${eta ? `, ${eta}` : ""}, from the filed or amended time en route.`;
  }
  return efc
    ? `Leave the clearance limit at the expect-further-clearance time, ${efc}, proceed to a fix an approach begins from, and begin the descent or the approach as close as possible to your estimated time of arrival${eta ? `, ${eta}` : ""}.`
    : `Leave the clearance limit on arriving over it, proceed to a fix an approach begins from, and begin the descent or the approach as close as possible to your estimated time of arrival${eta ? `, ${eta}` : ""}.`;
}
