import { cn } from "cn";
import { GROUP_HEADING, GROW_FIGURE } from "../lib/text";
import { useFigureFit } from "./useFigureFit";

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
export default function FigureStrip({ figures, rounded = figures, testId }: {
  figures: StripFigure[];
  /** Each figure rounded, for the one too wide for its column, as the
   *  flight's figures are (useFigureFit). */
  rounded?: StripFigure[];
  testId?: string;
}) {
  const { room, shown, sized, fitted, probes } = useFigureFit(figures, rounded, GROW_FIGURE.value, GROW_FIGURE.unit);
  return (
    <div className="relative">
      <dl className={cn("grid gap-3", shown.length === 3 ? "grid-cols-3" : "grid-cols-4")} data-testid={testId}>
        {shown.map((f, i) => (
          <div key={f.name} className="min-w-0 text-center">
            {/* Its names and units a grey that reads on the pill's glass. */}
            <dt className={cn(GROUP_HEADING, GROW_FIGURE.name, "truncate text-foreground/65")}>{f.name}</dt>
            <dd ref={i === 0 ? room : undefined} className={cn(GROW_FIGURE.value, "truncate font-semibold tabular-nums")} data-testid={f.testId}>
              <span style={sized("value")} data-fitted={fitted}>{f.value}</span>
              {f.unit && <span className={cn(GROW_FIGURE.unit, "font-normal text-foreground/65")} style={sized("unit")} data-fitted={fitted}> {f.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {probes}
    </div>
  );
}
