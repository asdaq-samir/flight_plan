import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";

/** A field's button at its end: 22 inside the field's 28, three in from
 *  its end, at the owner's ask ("buttons for n number and altitude should
 *  be smaller to fit in its input group"); its 44 a pseudo-element round it. */
export const INLINE_FIELD_BUTTON =
  "relative mr-[3px] flex size-[1.375rem] shrink-0 items-center justify-center rounded-full outline-none after:absolute after:-inset-[11px] after:content-[''] focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A short field in the route box's row with a glass button at its end --
 * the airplane's N-number (FlightInputs) and the cruise altitude
 * (AltitudeGroup) -- one component where the two were near-copies (the 23
 * Oct audit), keeping what the owner asked of them:
 * - 28 tall, the route box's fill and type;
 * - one width whatever is in it ("Keep these inputs fixed size"): the
 *   widest value and the button, and the example, measured unseen in the
 *   one cell, emptied it keeps it and shows its example;
 * - six points between the text and the button ("Does the button need to
 *   have that much spacing"), the field over the button's area where the
 *   two meet, so a tap at the text's end is the field's ("not letting me
 *   clear them").
 */
export function InlineField({ label, testId, widest, tabular = false, placeholder, placeholderClassName, shrink = false, input, inputClassName, button, prefix }: {
  /** Fixed before what is typed, in the secondary grey: an N-number's N. */
  prefix?: string;
  /** The group's name, for VoiceOver. */
  label: string;
  testId?: string;
  /** The widest value it takes, for its one width. */
  widest: string;
  /** Figures that line up as they change (the altitude's). */
  tabular?: boolean;
  placeholder: string;
  /** The example's own size where it is not the row's. */
  placeholderClassName?: string;
  /** Keeps its width in a row too narrow for everything. */
  shrink?: boolean;
  input: Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "placeholder"> & { "data-testid"?: string };
  inputClassName?: string;
  /** At its end, shown when it has something to open (INLINE_FIELD_BUTTON). */
  button?: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={cn("grid h-7 items-center rounded-full bg-foreground/8", shrink && "shrink-0", TEXT.row)} data-testid={testId}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex h-0 overflow-hidden">
        <span className={cn("whitespace-pre pr-1.5 pl-2.5 font-semibold", tabular && "tabular-nums")}>{widest}</span>
        <span className="w-[1.5625rem] shrink-0" />
      </span>
      <span aria-hidden="true" className={cn("invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-pre pr-1.5 pl-2.5 font-normal", placeholderClassName)}>
        {placeholder}
      </span>
      <div className="col-start-1 row-start-1 flex h-full min-w-0 items-center">
        <label className="relative flex h-full min-w-0 flex-1 items-center pr-1 after:absolute after:-inset-y-2 after:-left-0.5 after:right-0 after:content-['']">
          {prefix && <span aria-hidden="true" className="pl-2.5 font-semibold text-muted-foreground">{prefix}</span>}
          <input
            type="text" autoComplete="off" enterKeyHint="done" size={1} placeholder={placeholder} {...input}
            className={cn(
              "relative z-10 h-full w-0 min-w-0 flex-1 bg-transparent pr-0.5 font-semibold outline-none placeholder:font-normal",
              prefix ? "pl-px" : "pl-2.5",
              tabular && "tabular-nums", inputClassName,
            )}
          />
        </label>
        {button}
      </div>
    </div>
  );
}
