import { format, parseISO } from "date-fns";
import type { CrossCountryReview, Instructor, SignedEndorsement } from "./api/types";

/** A day as the pages say one: "13 Oct 2026". */
export const said = (iso: string) => format(parseISO(iso), "d MMM yyyy");
/** A day as AC 61-65K's samples write one: "10-13-2026". */
export const acDay = (iso: string) => format(parseISO(iso), "MM-dd-yyyy");

/** The latest of each kind signed in the app and not voided, by its code:
 *  the record comes newest first. */
export function inForce(signed: SignedEndorsement[]): Map<string, SignedEndorsement> {
  const out = new Map<string, SignedEndorsement>();
  for (const e of signed) if (!e.voided && !out.has(e.code)) out.set(e.code, e);
  return out;
}

/** The signature line AC 61-65K asks of every endorsement, as the webapp
 *  writes it: "/s/ 10-13-2026 J. J. Jones 987654321CFI RE 12-31-2027". */
export function signatureLine(instructor: Instructor, signedOn: string): string {
  return `/s/ ${acDay(signedOn)} ${instructor.fullName} ${instructor.certificate} ${instructor.untilKind === "EXP" ? "Exp." : "RE"} ${acDay(instructor.until!)}`;
}

/** A solo cross-country's airports in order: "KUGN KRFD KUGN". */
export const reviewRoute = (r: CrossCountryReview) =>
  [r.flight.departureIdent, ...r.flight.stops, r.flight.destinationIdent].join(" ");

/** Where a solo cross-country put to an instructor stands. */
export function reviewState(r: CrossCountryReview): string {
  if (r.endorsement) return `Endorsed ${said(r.endorsement.signedOn)}`;
  if (r.answeredAt) return `Not endorsed: ${r.declinedNote ?? ""}`;
  return "Waiting for your instructor";
}
