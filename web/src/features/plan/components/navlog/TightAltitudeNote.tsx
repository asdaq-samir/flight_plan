import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { Popover, PopoverAnchor, PopoverContent } from "../../../../components/ui/popover";
import { TEXT } from "../../../../lib/text";

/**
 * A leg flown at a tight altitude (the planner's vfr.altitude: no 500 ft
 * step fits under its ceiling), as an amber mark beside the Nav Log's
 * title that opens to the why -- "Tight 8–20 nm along: 1,800 ft, 100 ft
 * under the Class B and right at the obstacle minimum." It was a line
 * of its own across the panel.
 *
 * Inside the section's title, which is the accordion's button: so not
 * a button of its own, but a mark that takes its own tap, the section
 * left as it was.
 */
export default function TightAltitudeNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  const toggle = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(o => !o);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          role="button" tabIndex={0} aria-label="Tight altitude" aria-expanded={open}
          onClick={toggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
          // A finger's 44 points round a 24-point mark (index.css's rule
          // is for buttons; this is a span inside one), and over the
          // section button's own hit area, which lies across its title.
          className="relative z-10 inline-grid size-6 place-items-center rounded-full text-amber-600 outline-none after:absolute after:-inset-2.5 focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
          data-testid="tight-altitude-flag"
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
      </PopoverAnchor>
      {/* Kept off the screen's edges, the panel's gutter's width. */}
      <PopoverContent collisionPadding={16} className={cn("w-72 font-normal", TEXT.detail)} data-testid="tight-altitude">{note}</PopoverContent>
    </Popover>
  );
}
