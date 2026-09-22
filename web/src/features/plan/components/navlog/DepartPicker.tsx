import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import IconButton from "../../../../components/IconButton";
import { Button } from "../../../../components/ui/button";
import { Calendar } from "../../../../components/ui/calendar";
import { Input } from "../../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";

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

/**
 * When the flight leaves: shadcn's own date picker -- a calendar in a
 * popover -- with a time box beside it, the "date and time picker"
 * shape from its docs, instead of the browser's `datetime-local`
 * control, which every browser draws its own way (and a phone as a
 * wheel). Empty is "about now", and the cross brings it back there.
 * The day and the time are one value to the caller, an ISO instant:
 * a new day keeps the time (or takes the next whole hour), a new time
 * keeps the day (or takes today).
 */
export default function DepartPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value) : undefined;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const time = date ? format(date, "HH:mm") : "";
  return (
    <div className="flex items-center gap-1" data-testid="depart-picker">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline" size="sm" className="font-normal"
            aria-label="Departure date" data-testid="depart-date"
          >
            <CalendarIcon className="text-muted-foreground" />
            {date ? format(date, "EEE d MMM") : "Now"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single" required selected={date} defaultMonth={date} captionLayout="dropdown"
            onSelect={day => { onChange(instantAt(day, time || nextHour())); setOpen(false); }}
          />
        </PopoverContent>
      </Popover>
      {/* The time, and the way back to "now", only once a day is
          picked: with no departure the flight is planned for about now
          and a time means nothing, and an empty `type="time"` box
          renders as a wide blank with no placeholder and nothing to
          say what it is. Picking a day gives it the next whole hour,
          so it is never empty while it is on screen. The stock Input
          keeps 16px below md so a phone does not zoom on it, and the
          browser's own picker indicator is hidden the way shadcn's own
          example hides it -- the box is the control. */}
      {date && (
        <>
          <Input
            type="time"
            value={time}
            onChange={e => { if (e.target.value) onChange(instantAt(date, e.target.value)); }}
            aria-label="Departure time"
            className="h-8 w-[6.5rem] appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            data-testid="depart-time"
          />
          <IconButton label="Depart about now instead" className="size-8" onClick={() => onChange("")} data-testid="depart-clear">
            <X className="size-4" />
          </IconButton>
        </>
      )}
    </div>
  );
}
