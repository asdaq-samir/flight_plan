/**
 * A student's way to the checkride (the Logbook's Checkride page) and
 * their instructor's (the Students page): the ACS codes a knowledge test
 * report gives, read out of whatever the student pastes, and an
 * endorsement's words as they will be signed. The endorsements themselves
 * -- AC 61-65K's samples, their 14 CFR sections and how long each is good
 * for -- are the webapp's (EndorsementKind), sent with the record.
 *
 * The words and the codes are the shared engine's (native/engine/src/
 * pilot/endorsements.rs, through lib/engine), as the iPhone app's are.
 */
import { callEngine } from "./engine/engine";

/**
 * An endorsement's words with the student's name and the fields filled
 * in, as the webapp's EndorsementKind.render fills them: a blank left
 * empty leaves nothing, the spaces around it closed up. What the sheet
 * shows is what is signed: the webapp refuses a signature over words that
 * are not what it makes of the same fields.
 */
export function renderEndorsement(template: string, student: string, fields: Record<string, string>): string {
  return callEngine("endorsement_render", { template, student, fields });
}

/** The ACS codes in what was pasted -- a report's text, a list, codes
 *  typed in lower case -- each once, in the order given; a sub-element's
 *  letter lower case, as the ACS writes it: K1a. */
export function acsCodesIn(text: string): string[] {
  return callEngine("acs_codes", { text });
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
