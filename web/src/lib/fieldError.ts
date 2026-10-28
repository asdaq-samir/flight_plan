/** The id of what is wrong with a form's field, said under it (RowField). */
export const errorIdOf = (id: string) => `${id}-error`;

/** What a field carries of its problem: marked invalid, and described by
 *  the message under it, so a screen reader reads the two together. */
export function invalidProps(id: string, error: string | undefined) {
  return { "aria-invalid": !!error, "aria-describedby": error ? errorIdOf(id) : undefined };
}
