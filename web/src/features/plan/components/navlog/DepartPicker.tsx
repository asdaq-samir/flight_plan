import { Suspense, lazy, useId, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "../../../../components/ui/button";

/** The month grid is react-day-picker, which is not small and is only
 *  ever seen inside this popover -- so it arrives with the popover
 *  rather than with the page. */
const Calendar = lazy(() => import("../../../../components/ui/calendar").then(m => ({ default: m.Calendar })));
import { Input } from "../../../../components/ui/input";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../../components/ResponsivePopover";
import { cn } from "cn";
import { CHIP_TEXT, GLASS_BUTTON } from "../../../../components/mapChrome";
import { TEXT } from "../../../../lib/text";

interface Props {
  /** The departure as an ISO instant, or "" for about now. */
  value: string;
  onChange: (iso: string) => void;
  /** A chip of glass, or the time in the tint as the departure's step in
   *  FPL's list says it ("09:00 ⌄"), where the owner moved it. */
  look?: "chip" | "time";
  /** What it is the time of: the flight's departure, or a stop's leaving
   *  again ("Departure from KMSN"). */
  label?: string;
  testId?: string;
  /** Leave Now, back to about now: the flight's own departure's; a stop
   *  has no "now" to go back to. */
  leavesNow?: boolean;
  /** The earliest and latest it may be, ms since 1970: a stop's leaving,
   *  from its landing to a day after, as the planner takes a stop's time
   *  on the ground. A time picked outside is brought inside and said so. */
  earliest?: number;
  latest?: number;
}

/** The instant of a calendar day at a local "HH:mm". */
function instantAt(day: Date, time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0).toISOString();
}

/** The next whole hour, local: the time a freshly picked day starts
 *  with, so picking a day alone already means something. */
function nextHour(): string {
  return `${String((new Date().getHours() + 1) % 24).padStart(2, "0")}:00`;
}

/** The departure in a few characters, as iOS's compact picker reads:
 *  "18:00" today, "Sat 18:00" within the week, "11/17 18:00" further
 *  out -- short enough that the airplane, the time and Save, Brief and
 *  Print share one line on a phone, where the day, a time box and a
 *  cross took a line of their own, and "17 Nov 18:00" still pushed the
 *  buttons to the next. */
function shortWhen(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - today.getTime()) / 86_400_000);
  const time = format(date, "HH:mm");
  if (days === 0) return time;
  return `${days > 0 && days < 7 ? format(date, "EEE") : format(date, "M/d")} ${time}`;
}

/**
 * When the flight leaves: one compact field, "Now" or "Sat 18:00", that
 * opens shadcn's own date picker -- the calendar in a popover, a sheet on
 * a phone -- with the time under it and Leave Now to go back to about
 * now, instead of the browser's `datetime-local` control, which every
 * browser draws its own way. The day and the time are one value to the
 * caller, an ISO instant: a new day keeps the time (or takes the next
 * whole hour), a new time keeps the day.
 */
export default function DepartPicker({
  value, onChange: change, look = "chip", label = "Departure", testId = "depart-date", leavesNow = true, earliest, latest,
}: Props) {
  const [open, setOpen] = useState(false);
  // A pick outside its range, brought inside: said under the time, where
  // it was picked, until the next pick.
  const [held, setHeld] = useState(false);
  const onChange = (iso: string) => {
    const ms = iso ? Date.parse(iso) : NaN;
    const kept = Number.isNaN(ms) ? ms : Math.min(latest ?? Infinity, Math.max(earliest ?? -Infinity, ms));
    setHeld(kept !== ms);
    change(Number.isNaN(ms) || kept === ms ? iso : new Date(kept).toISOString());
  };
  const timeId = useId();
  const parsed = value ? new Date(value) : undefined;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const time = date ? format(date, "HH:mm") : "";
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        {look === "time" ? (
          <button
            type="button" aria-label={`${label}, ${date ? shortWhen(date) : "now"}: change`} data-testid={testId}
            className={cn("relative flex shrink-0 items-center gap-0.5 font-semibold text-tint tabular-nums after:absolute after:-inset-2.5 after:content-['']", TEXT.detail)}
          >
            {date ? shortWhen(date) : "Now"}
            <ChevronDown className="size-4" aria-hidden />
          </button>
        ) : (
          <Button
            // A chip of glass, as Maps' filter chips are: the time in the
            // text's colour, not a button's tint, at a note's 13 (TEXT), as
            // the airplane beside it (FlightInputs).
            variant="outline" size="sm" className={cn("rounded-full px-2.5 font-normal pointer-coarse:px-1.5", GLASS_BUTTON, CHIP_TEXT)}
            aria-label={`${label} date`} data-testid={testId}
          >
            {!date && <CalendarIcon className="text-muted-foreground" />}
            {date ? shortWhen(date) : "Now"}
          </Button>
        )}
      </ResponsivePopoverTrigger>
      {/* A sheet from the bottom on a phone, the calendar centred in it. */}
      {/* Its Done at the foot its way out (no close). */}
      <ResponsivePopoverContent title={label} className="w-auto p-0" align="start" closeButton={false}>
        <div className="flex flex-col items-center gap-3 pb-3" data-testid="depart-picker">
          {/* Sized like the grid it stands in for, so the popover does
              not jump once it arrives. */}
          <Suspense fallback={<div className="h-[21rem] w-[17rem]" />}>
            <Calendar
              mode="single" required selected={date} defaultMonth={date} captionLayout="dropdown"
              disabled={[
                ...(earliest != null ? [{ before: new Date(new Date(earliest).setHours(0, 0, 0, 0)) }] : []),
                ...(latest != null ? [{ after: new Date(latest) }] : []),
              ]}
              onSelect={day => onChange(instantAt(day, time || nextHour()))}
            />
          </Suspense>
          {/* The time once a day is picked -- picking one gives it the
              next whole hour -- and the way back to about now. The stock
              Input keeps 16px below md so a phone does not zoom on it. */}
          <div className="flex items-center gap-2 px-3">
            {date && (
              // Wrapped, so a finger 6 above or below the 32-point field is
              // still the field's: 44, as every control, without growing it.
              <label className="-my-1.5 flex py-1.5" htmlFor={timeId}>
              <Input
                id={timeId}
                type="time"
                value={time}
                onChange={e => { if (e.target.value) onChange(instantAt(date, e.target.value)); }}
                aria-label={`${label} time`}
                className="h-8 w-28 appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                data-testid="depart-time"
              />
              </label>
            )}
            {leavesNow && (
              <Button
                type="button" variant="ghost" size="sm" className="text-tint"
                onClick={() => { onChange(""); setOpen(false); }} disabled={!date} data-testid="depart-clear"
              >
                Leave now
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => setOpen(false)} data-testid="depart-done">Done</Button>
          </div>
          {held && earliest != null && latest != null && (
            <p className={cn("px-3 text-amber-700 dark:text-amber-300", TEXT.note)} role="status" data-testid="depart-range">
              From landing, {format(new Date(earliest), "HH:mm")}, to a day after.
            </p>
          )}
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
