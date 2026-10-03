import { Suspense, lazy, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "../../../../components/ui/button";

/** The month grid is react-day-picker, which is not small and is only
 *  ever seen inside this popover -- so it arrives with the popover
 *  rather than with the page. */
const Calendar = lazy(() => import("../../../../components/ui/calendar").then(m => ({ default: m.Calendar })));
import { Input } from "../../../../components/ui/input";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../../components/ResponsivePopover";
import { cn } from "cn";
import { TEXT } from "../../../../lib/text";

interface Props {
  /** The departure as an ISO instant, or "" for about now. */
  value: string;
  onChange: (iso: string) => void;
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
 *  "Today 18:00", "Sat 18:00" within the week, "3 Oct 18:00" further
 *  out -- short enough that the aeroplane, the time and the panel's
 *  three buttons share one line on a phone, where the day, a time box
 *  and a cross took a line of their own and pushed the buttons to a
 *  third. */
function shortWhen(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - today.getTime()) / 86_400_000);
  const day = days === 0 ? "Today" : days > 0 && days < 7 ? format(date, "EEE") : format(date, "d MMM");
  return `${day} ${format(date, "HH:mm")}`;
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
export default function DepartPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value) : undefined;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const time = date ? format(date, "HH:mm") : "";
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <Button
          // A field, as iOS's compact date picker is: the time in the
          // text's colour at a row's size (TEXT), not a button's tint.
          variant="outline" size="sm" className={cn("font-normal text-foreground", TEXT.row)}
          aria-label="Departure date" data-testid="depart-date"
        >
          {!date && <CalendarIcon className="text-muted-foreground" />}
          {date ? shortWhen(date) : "Now"}
        </Button>
      </ResponsivePopoverTrigger>
      {/* A sheet from the bottom on a phone, the calendar centred in it. */}
      <ResponsivePopoverContent title="Departure" className="w-auto p-0" align="start">
        <div className="flex flex-col items-center gap-3 pb-3" data-testid="depart-picker">
          {/* Sized like the grid it stands in for, so the popover does
              not jump once it arrives. */}
          <Suspense fallback={<div className="h-[21rem] w-[17rem]" />}>
            <Calendar
              mode="single" required selected={date} defaultMonth={date} captionLayout="dropdown"
              onSelect={day => onChange(instantAt(day, time || nextHour()))}
            />
          </Suspense>
          {/* The time once a day is picked -- picking one gives it the
              next whole hour -- and the way back to about now. The stock
              Input keeps 16px below md so a phone does not zoom on it. */}
          <div className="flex items-center gap-2 px-3">
            {date && (
              <Input
                type="time"
                value={time}
                onChange={e => { if (e.target.value) onChange(instantAt(date, e.target.value)); }}
                aria-label="Departure time"
                className="h-8 w-28 appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                data-testid="depart-time"
              />
            )}
            <Button
              type="button" variant="ghost" size="sm" className="text-tint"
              onClick={() => { onChange(""); setOpen(false); }} disabled={!date} data-testid="depart-clear"
            >
              Leave now
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)} data-testid="depart-done">Done</Button>
          </div>
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
