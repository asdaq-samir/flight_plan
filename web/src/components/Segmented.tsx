import type { ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

/** Two to three choices, all on show: shadcn's ToggleGroup as a
 *  segmented control -- the choice raised out of a muted track, as iOS
 *  draws one, every label in the text's colour at 13 points to a
 *  finger (the unchosen ones were grey, 4.35:1 on the track). Always
 *  one of them: a tap on the one already chosen keeps it rather than
 *  clearing the setting. */
export default function Segmented({ label, value, onChange, options, testId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon?: ReactNode }[];
  testId?: string;
}) {
  return (
    <ToggleGroup
      type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
      aria-label={label} size="sm" spacing={0.5} className="rounded-lg bg-muted p-0.5" data-testid={testId}
    >
      {options.map(o => (
        <ToggleGroupItem
          key={o.value} value={o.value}
          className="h-7 rounded-md px-2.5 text-xs pointer-coarse:text-[0.8125rem] text-foreground data-[state=on]:bg-background data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/30 [&_svg:not([class*='size-'])]:size-3.5"
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
