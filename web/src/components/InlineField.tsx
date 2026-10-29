import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";

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
export function InlineField({ label, testId, widest, tabular = false, placeholder, placeholderClassName, hint, shrink = false, input, inputClassName, button, endRoom = "w-[1.5625rem]", tip }: {
  /** Grey words after a fixed start the field keeps in its text (the
   *  airplane's "N-"), in the example's style, while nothing is typed
   *  after it: the input's own placeholder shows only while it is empty,
   *  which a fixed start never is. Room kept for it, as for the example. */
  hint?: { start: string; words: string };
  /** The first-run tip pointed at it (lib/tips). */
  tip?: string;
  /** The room kept at its end for its button, so the field does not
   *  widen as one comes: none where it has none (the airplane's, since
   *  its card button went), a dot's for the altitude's caution. */
  endRoom?: string;
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
  /** At its end, shown when it has something to open. */
  button?: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={cn("grid h-7 items-center rounded-full bg-foreground/8", shrink && "shrink-0", TEXT.row)} data-testid={testId} data-tip={tip}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex h-0 overflow-hidden">
        <span className={cn("whitespace-pre pr-1.5 pl-2.5 font-semibold", tabular && "tabular-nums")}>{widest}</span>
        <span className={cn(endRoom, "shrink-0")} />
      </span>
      <span aria-hidden="true" className={cn("invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-pre pr-1.5 pl-2.5 font-normal", placeholderClassName)}>
        {placeholder}
      </span>
      {hint && (
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex h-0 overflow-hidden whitespace-pre pr-1.5 pl-2.5">
          <span className="font-semibold">{hint.start}</span><span className={cn("font-normal", placeholderClassName)}>{hint.words}</span>
          <span className={cn(endRoom, "shrink-0")} />
        </span>
      )}
      <div className="col-start-1 row-start-1 flex h-full min-w-0 items-center">
        <label className="relative flex h-full min-w-0 flex-1 items-center pr-1 after:absolute after:-inset-y-2 after:-left-0.5 after:right-0 after:content-['']">
          <input
            type="text" autoComplete="off" enterKeyHint="done" size={1} placeholder={placeholder} {...input}
            className={cn(
              "relative z-10 h-full w-0 min-w-0 flex-1 bg-transparent pr-0.5 font-semibold outline-none placeholder:font-normal",
              "pl-2.5", tabular && "tabular-nums", inputClassName,
            )}
          />
          {hint && input.value === hint.start && (
            // Over the input, after its text (laid out unseen beside it),
            // never in a tap's way. Grey, but the text's own colour faded
            // rather than the muted grey, which fell to 3.9:1 (and at 60% 4.4:1) on the
            // field's fill in dark (the iOS audit's P15 asks 4.5).
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center overflow-hidden whitespace-pre pl-2.5" data-testid={testId ? `${testId}-hint` : undefined}>
              <span className="invisible font-semibold">{hint.start}</span>
              <span className={cn("font-normal text-foreground/70", placeholderClassName)}>{hint.words}</span>
            </span>
          )}
        </label>
        {button}
      </div>
    </div>
  );
}
