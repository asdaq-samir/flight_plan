import type { ReactNode } from "react";
import { cn } from "cn";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { TEXT } from "../lib/text";

/** A segment: 28 tall in the track's 32, the words 13 to a finger, the
 *  chosen one raised -- in the dark, iOS's own lighter grey for it, where
 *  a faint tint of the track left the choice hard to see. In a settings
 *  column under 22.5rem (SettingsPanel's container: the console's half
 *  sheet on a phone, in from the screen's edges) the pictures go and the
 *  words stay: with them, Theme's three cut its own row's label short.
 *  Each keeps 44 across there, so a short word's (Top) is its own to tap. */
const SEGMENT = `h-7 rounded-md px-2.5 ${TEXT.note} text-foreground data-[state=on]:bg-background data-[state=on]:shadow-sm dark:data-[state=on]:bg-[#636366] [&_svg:not([class*='size-'])]:size-3.5 @max-[22.5rem]/settings:min-w-11 @max-[22.5rem]/settings:px-2 @max-[22.5rem]/settings:[&_svg]:hidden`;

/** Two to three choices, one of which is picked: shadcn's ToggleGroup as
 *  a segmented control -- the choice raised out of a muted track, as iOS
 *  draws one, every label in the text's colour at 13 points to a
 *  finger (the unchosen ones were grey, 4.35:1 on the track). Always
 *  one of them: a tap on the one already chosen keeps it rather than
 *  clearing the setting. */
export default function Segmented({ label, value, onChange, options, testId, className }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon?: ReactNode }[];
  testId?: string;
  /** Its width, where it is not its words': `w-full [&>*]:flex-1` spans
   *  the column, the segments sharing it equally. */
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
      aria-label={label} size="sm" spacing={0.5} data-testid={testId}
      // Its 44-point hit area a pseudo-element behind the track (isolate
      // keeps it over what is round it): the track is 32, and a tap just
      // over or under it -- the Personal tab's, under the console's tabs
      // -- landed outside it. The track does not grow.
      className={cn("relative isolate rounded-lg bg-muted p-0.5 after:absolute after:inset-x-0 after:-inset-y-1.5 after:-z-10 after:content-['']", className)}
    >
      {options.map(o => (
        <ToggleGroupItem key={o.value} value={o.value} className={SEGMENT}>
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
