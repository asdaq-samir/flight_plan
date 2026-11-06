import { cn } from "cn";
import { useInkLook } from "../lib/brand";
import { FLYING_FIGURE, GROUP_HEADING, GROW_FIGURE, TEXT } from "../lib/text";
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
  // In the Chart ink look the figures are the ink canvas's (2026-11-04):
  // 26 bold whatever the sheet's height, their names in the display face's
  // spaced capitals (TEXT.figure, TEXT.label), their units the Flying
  // screen's; in the other looks they grow with the sheet as before.
  const ink = useInkLook();
  const valueType = ink ? TEXT.figure : cn(GROW_FIGURE.value, "font-semibold");
  const unitType = ink ? FLYING_FIGURE.unit : GROW_FIGURE.unit;
  const nameType = ink ? TEXT.label : cn(GROUP_HEADING, GROW_FIGURE.name);
  const { room, shown, sized, fitted, probes } = useFigureFit(figures, rounded, valueType, unitType);
  return (
    <div className="relative">
      <dl className={cn("grid gap-3", shown.length === 3 ? "grid-cols-3" : "grid-cols-4")} data-testid={testId}>
        {shown.map((f, i) => (
          <div key={f.name} className="min-w-0 text-center">
            {/* Its names and units a grey that reads on the pill's glass. */}
            <dt className={cn(nameType, "truncate text-foreground/65")}>{f.name}</dt>
            <dd ref={i === 0 ? room : undefined} className={cn(valueType, "truncate tabular-nums")} data-testid={f.testId}>
              <span style={sized("value")} data-fitted={fitted}>{f.value}</span>
              {f.unit && <span className={cn(unitType, "font-normal text-foreground/65")} style={sized("unit")} data-fitted={fitted}> {f.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {probes}
    </div>
  );
}
