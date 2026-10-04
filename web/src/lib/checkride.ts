/**
 * A student's way to the checkride (the Logbook's Checkride page): the
 * endorsements an instructor gives on the way, as AC 61-65 lists them
 * with their 14 CFR sections, and the ACS codes a knowledge test report
 * gives, read out of whatever the student pastes.
 */

export interface EndorsementKind {
  code: string;
  label: string;
  rule: string;
  /** Days it is good for from the day it was given, where it runs out. */
  validDays?: number;
}

/** In the order a student meets them. */
export const ENDORSEMENTS: EndorsementKind[] = [
  { code: "pre-solo-knowledge", label: "Pre-solo aeronautical knowledge", rule: "61.87(b)" },
  { code: "pre-solo-flight", label: "Pre-solo flight training", rule: "61.87(c)" },
  { code: "solo-90", label: "Solo flight (each 90 days)", rule: "61.87(n), (p)", validDays: 90 },
  { code: "solo-night", label: "Solo flight at night", rule: "61.87(o)" },
  { code: "solo-xc-training", label: "Solo cross-country training", rule: "61.93(c)(1)" },
  { code: "solo-xc-flight", label: "The solo cross-country planned", rule: "61.93(c)(2)" },
  { code: "solo-xc-50nm", label: "Repeated solo cross-country within 50 nm", rule: "61.93(b)(2)" },
  { code: "class-b", label: "Solo flight in Class B airspace", rule: "61.95(a)", validDays: 90 },
  { code: "class-b-airport", label: "Solo at an airport in Class B airspace", rule: "61.95(b)", validDays: 90 },
  { code: "knowledge-test", label: "Aeronautical knowledge test", rule: "61.35(a)(1), 61.103(d), 61.105" },
  { code: "knowledge-test-review", label: "Review of the knowledge test's deficient areas", rule: "61.39(a)(6)(iii)" },
  { code: "practical-test", label: "Flight proficiency and practical test", rule: "61.39(a)(6)(i)–(ii), 61.103(f), 61.107(b), 61.109" },
];

const CODE = /\b(PA|IR)\.([IVX]{1,4})\.([A-Z])\.([KRS])(\d{1,2})([A-Z]?)\b/g;

/** The ACS codes in what was pasted -- a report's text, a list, codes
 *  typed in lower case -- each once, in the order given. */
export function acsCodesIn(text: string): string[] {
  const found: string[] = [];
  for (const m of text.toUpperCase().matchAll(CODE)) {
    // A sub-element's letter is lower case, as the ACS writes it: K1a.
    const code = `${m[1]}.${m[2]}.${m[3]}.${m[4]}${m[5]}${m[6]!.toLowerCase()}`;
    if (!found.includes(code)) found.push(code);
  }
  return found;
}

/** The day an endorsement runs out, or null where it does not. */
export function endorsementUntil(kind: EndorsementKind, endorsedOn: string): string | null {
  if (!kind.validDays) return null;
  const until = new Date(`${endorsedOn}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + kind.validDays);
  return until.toISOString().slice(0, 10);
}

/** The ACS's own table (lib/acs.json, from the FAA's PDFs). */
export interface AcsTable {
  editions: string[];
  tasks: Record<string, { area: string; task: string }>;
  elements: Record<string, string>;
}

/** A code's task and element, as the ACS words them; null for a code
 *  this edition does not have. */
export function lookUp(table: AcsTable, code: string): { area: string; task: string; element: string | null } | null {
  const task = table.tasks[code.split(".").slice(0, 3).join(".")];
  if (!task) return null;
  return { ...task, element: table.elements[code] ?? null };
}
