import type { ReactNode } from "react";
import { Field, FieldError } from "./ui/field";
import { cn } from "cn";
import { errorIdOf } from "../lib/fieldError";

/**
 * A form's field as a grouped list's row holds it at its end (ListRow's
 * children), or a text box across the group: shadcn's Field round it,
 * and what is wrong with the value in its FieldError under it -- red, an
 * alert, by the field the pilot is looking at -- where the row's words
 * stay what the field is.
 */
export default function RowField({ id, error, wide, children }: {
  id: string;
  error: string | undefined;
  /** A text box across the group, its message at the start. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={!!error || undefined} className={cn("gap-1", !wide && "w-auto items-end")}>
      {children}
      {error && <FieldError id={errorIdOf(id)} className={cn(!wide && "max-w-44 text-right")}>{error}</FieldError>}
    </Field>
  );
}
