import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { BASE_CHARTS, MARKER_ZOOMS, usePreferences, type BaseChart } from "../lib/preferences";

/**
 * The map's chart settings: which FAA chart is the base (the sectional,
 * or the IFR low- or high-altitude enroute chart, the way SkyVector
 * offers them), and whether the terminal-area sheet that belongs over
 * it -- the TAC over the sectional, the IFR area chart over the IFR
 * charts -- is pinned: drawn at every zoom it can be drawn at,
 * wherever one exists (Chicago's covers the first leg out of C81).
 * The same setting the pin over the map (`OverlayPin`) toggles;
 * unpinned, the base chart is the chart at every zoom.
 *
 * Lives in both pages' layers popover. Sectional and no terminal sheet
 * by default: this is a VFR planner, and a TAC is busier than the
 * sectional.
 */
export default function ChartLayers() {
  const base = usePreferences(s => s.base);
  const tac = usePreferences(s => s.tac);
  const markerZoom = usePreferences(s => s.markerZoom);
  const classB = usePreferences(s => s.classB);
  const setBase = usePreferences(s => s.setBase);
  const setTac = usePreferences(s => s.setTac);
  const setMarkerZoom = usePreferences(s => s.setMarkerZoom);
  const setClassB = usePreferences(s => s.setClassB);
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Chart layers</div>
      <div className="flex items-center gap-2">
        <Label htmlFor="base-chart" className="w-24 shrink-0 font-normal">Base chart</Label>
        <Select value={base} onValueChange={value => setBase(value as BaseChart)}>
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
          onCheckedChange={value => setTac(value === true)}
          data-testid="tac-toggle"
        />
        <Label htmlFor="tac-overlay" className="font-normal">
          {base === "sec" ? "Terminal area chart" : "IFR area chart"} pinned
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Close in over a terminal area a pin appears on the map: tap it to pin that sheet over the base chart,
        or hover it to look. Unpinned, the base chart is the chart at every zoom.
      </p>

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Checkbox
          id="class-b"
          checked={classB}
          onCheckedChange={value => setClassB(value === true)}
          data-testid="class-b-toggle"
        />
        <Label htmlFor="class-b" className="font-normal">Class B airports</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        A marker on each, coloured by what the field is reporting now. Hover one for its METAR and TAF;
        tap it to go there with the terminal area chart drawn over it.
      </p>

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Label htmlFor="marker-zoom" className="w-24 shrink-0 font-normal">Markers from</Label>
        <Select value={String(markerZoom)} onValueChange={value => setMarkerZoom(Number(value))}>
          <SelectTrigger id="marker-zoom" size="sm" aria-label="Markers from" className="w-full" data-testid="marker-zoom-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKER_ZOOMS.map(m => <SelectItem key={m.from} value={String(m.from)}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        How far in the map has to be before the checkpoints and candidates draw. A long route fits the screen
        zoomed a long way out, where a few hundred markers would hide the chart — pick Every zoom to see them anyway.
      </p>
    </div>
  );
}
