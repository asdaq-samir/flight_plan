import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { BASE_CHARTS, chartLayers, useChartLayers, type BaseChart } from "../lib/map/chartLayers";

/**
 * The map's chart settings: which FAA chart is the base (the sectional,
 * or the IFR low- or high-altitude enroute chart, the way SkyVector
 * offers them), and whether the terminal area chart is drawn over the
 * sectional at every zoom it can be drawn at, wherever one exists
 * (Chicago's covers the first leg out of C81). Past the sectional's own
 * resolution the TAC is drawn regardless (see `createBasemaps`), so the
 * checkbox only decides whether it also replaces the sectional further
 * out; it has no meaning over an IFR chart and is disabled there.
 *
 * Lives in both pages' info popovers -- Plan's `ScoreLegend` and Label's
 * `RatingLegend` -- next to the shortcut list, since that popover is
 * already where the map's own controls are explained. Sectional and no
 * TAC by default: this is a VFR planner, and a TAC is busier than the
 * sectional.
 */
export default function ChartLayers() {
  const { base, tac } = useChartLayers();
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Chart layers</div>
      <div className="flex items-center gap-2">
        <Label htmlFor="base-chart" className="w-24 shrink-0 font-normal">Base chart</Label>
        <Select value={base} onValueChange={value => chartLayers.setBase(value as BaseChart)}>
          <SelectTrigger id="base-chart" size="sm" aria-label="Base chart" className="w-full" data-testid="base-chart-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASE_CHARTS.map(b => <SelectItem key={b.kind} value={b.kind}>{b.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="tac-overlay"
          checked={tac}
          disabled={base !== "sec"}
          onCheckedChange={value => chartLayers.setTac(value === true)}
          data-testid="tac-toggle"
        />
        <Label htmlFor="tac-overlay" className="font-normal">Terminal area chart as soon as it can be drawn</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Past the sectional&rsquo;s own detail the terminal chart is drawn regardless, where one exists.
      </p>
    </div>
  );
}
