/**
 * A student's way to the checkride (the Logbook's Checkride page) and
 * their instructor's (the Students page): the ACS codes a knowledge test
 * report gives, read out of whatever the student pastes, and an
 * endorsement's words as they will be signed. The endorsements themselves
 * -- AC 61-65K's samples, their 14 CFR sections and how long each is good
 * for -- are the webapp's (EndorsementKind), sent with the record.
 */

/**
 * An endorsement's words with the student's name and the fields filled
 * in, as the webapp's EndorsementKind.render fills them: a blank left
 * empty leaves nothing, the spaces around it closed up. What the sheet
 * shows is what is signed: the webapp refuses a signature over words that
 * are not what it makes of the same fields.
 */
export function renderEndorsement(template: string, student: string, fields: Record<string, string>): string {
  return template
    .replace(/\{([A-Za-z]+)\}/g, (_, key: string) => (key === "student" ? student : (fields[key] ?? "")))
    .replace(/\s+/g, " ")
    .trim();
}

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
