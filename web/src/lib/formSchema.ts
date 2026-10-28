import { z } from "zod";
import { localDay } from "./clock";

// Zod checks once whether it may compile its parsers with Function(),
// which the page's Content-Security-Policy (script-src 'self', no eval)
// refuses -- and the refusal is a violation the browser reports, which
// Lighthouse's best practices count. Its parsers without that work the
// same, a little slower on schemas far bigger than these. Set here, where
// every form takes zod from, so whichever form's page loads first has it.
z.config({ jitless: true });

export { z };

/** The forms' fields stay strings through validation, as a plain <input>
 *  holds them; each form turns them into its request once, on submit. */

/** A day from a date field, blank allowed, not after today: what the
 *  server's @PastOrPresent asks of a day already gone by. Compared as
 *  ISO strings, which sort as the days do. */
export const pastDay = z.string().refine(value => value === "" || value <= localDay(), "Not after today");

/** The same, a day that must be given. */
export const requiredPastDay = (message: string) => z.string().min(1, message)
  .refine(value => value <= localDay(), "Not after today");

/** Blank, or a number at or over nought: hours in service. */
export const optionalHours = z.string().trim().refine(
  value => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
  "Hours cannot be negative",
);

/** A form's blank figure as the request carries it: null. */
export const numberOrNull = (value: string) => (value.trim() ? Number(value) : null);

/** A blank day or line as the request carries it: null. */
export const textOrNull = (value: string) => value.trim() || null;
