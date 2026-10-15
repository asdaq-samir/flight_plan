import { cn } from "cn";
import { GROUP_HEADING, GROW_FIGURE } from "../lib/text";

export interface StripFigure {
  name: string;
  value: string;
  unit?: string;
  testId?: string;
}

/**
 * Four figures pinned at the map panel's foot, as FPL's flight figures are
 * (FlightLine): each its name over its value, centred in its column at the
 * owner's ask ("Can the calculations be center aligned?"), growing with the
 * sheet (GROW_FIGURE). The training page's (how far the rating has got, the
 * model's error) and its performance's, at the owner's pick of the dev
 * page's redesign ("redesign the dev similar way").
 */
export default function FigureStrip({ figures, testId }: { figures: StripFigure[]; testId?: string }) {
  return (
    <dl className={cn("grid gap-3", figures.length === 3 ? "grid-cols-3" : "grid-cols-4")} data-testid={testId}>
      {figures.map(f => (
        <div key={f.name} className="min-w-0 text-center">
          {/* Its names and units a grey that reads on the pill's glass. */}
          <dt className={cn(GROUP_HEADING, GROW_FIGURE.name, "truncate text-foreground/65")}>{f.name}</dt>
          <dd className={cn(GROW_FIGURE.value, "truncate font-semibold tabular-nums")} data-testid={f.testId}>
            {f.value}
            {f.unit && <span className={cn(GROW_FIGURE.unit, "font-normal text-foreground/65")}> {f.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
